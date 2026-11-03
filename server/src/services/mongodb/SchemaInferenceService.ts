import { Binary, Decimal128, Double, Int32, Long, ObjectId } from "mongodb";
import type {
  CompactSchema,
  CollectionSchema,
  DatabaseSchema,
  DatabaseSummary,
  FieldSchema,
  FieldType,
  Relationship
} from "../../types/index.js";

export function inferBsonType(value: unknown): FieldType {
  if (value === null) return "null";
  if (value === undefined) return "unknown";
  if (value instanceof ObjectId) return "ObjectId";
  if (value instanceof Date) return "date";
  if (value instanceof Decimal128) return "decimal";
  if (value instanceof Binary) return "binary";
  if (value instanceof Long || value instanceof Int32) return "integer";
  if (value instanceof Double) return "number";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return "date";
    if (ObjectId.isValid(value) && value.length === 24) return "ObjectId";
    return "string";
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.$oid === "string") return "ObjectId";
    if (rec.$date !== undefined) return "date";
    return "object";
  }
  return "unknown";
}

function mergeTypes(types: FieldType[]): FieldType {
  const unique = [...new Set(types.filter((t) => t !== "null" && t !== "unknown"))];
  if (unique.length === 0) return types.includes("null") ? "null" : "unknown";
  if (unique.length === 1) return unique[0]!;
  if (unique.every((t) => t === "number" || t === "integer" || t === "decimal")) return "number";
  return "mixed";
}

interface AccField {
  path: string;
  types: FieldType[];
  arrayItemTypes: FieldType[];
  enumSamples: Set<string>;
  children: Map<string, AccField>;
}

function ensure(map: Map<string, AccField>, path: string): AccField {
  let node = map.get(path);
  if (!node) {
    node = {
      path,
      types: [],
      arrayItemTypes: [],
      enumSamples: new Set(),
      children: new Map()
    };
    map.set(path, node);
  }
  return node;
}

function walk(value: unknown, path: string, acc: Map<string, AccField>): void {
  const field = ensure(acc, path || "(root)");
  const type = inferBsonType(value);
  field.types.push(type);

  if (typeof value === "string" && field.enumSamples.size < 8) {
    field.enumSamples.add(value.slice(0, 80));
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const itemType = inferBsonType(item);
      field.arrayItemTypes.push(itemType);
      const itemPath = `${path}[]`;
      walk(item, itemPath, acc);
    }
    return;
  }

  if (type === "object" && value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      walk(v, childPath, acc);
    }
  }
}

function toFieldSchema(node: AccField): FieldSchema {
  const type = mergeTypes(node.types);
  const arrayItemType = node.arrayItemTypes.length
    ? mergeTypes(node.arrayItemTypes)
    : undefined;
  const isPossibleId =
    /(^id$|_id$|Id$|ID$)/.test(node.path.split(".").pop() ?? "") || type === "ObjectId";
  const isPossibleDate = type === "date" || node.path.toLowerCase().includes("date") || /At$/.test(node.path);
  const isNumeric = type === "number" || type === "integer" || type === "decimal";
  return {
    path: node.path,
    type,
    typesSeen: [...new Set(node.types)],
    arrayItemType,
    enumSamples: [...node.enumSamples].slice(0, 5),
    isPossibleId,
    isPossibleDate,
    isNumeric
  };
}

export function inferFieldsFromDocuments(documents: unknown[]): FieldSchema[] {
  const acc = new Map<string, AccField>();
  for (const doc of documents) {
    if (!doc || typeof doc !== "object") continue;
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      walk(v, k, acc);
    }
  }
  return [...acc.values()]
    .map(toFieldSchema)
    .filter((f) => f.path !== "(root)")
    .sort((a, b) => a.path.localeCompare(b.path));
}

function singularize(name: string): string {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("ses")) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}

function pluralize(name: string): string {
  if (name.endsWith("y") && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (name.endsWith("s")) return name;
  return `${name}s`;
}

function stripIdSuffix(field: string): string {
  const leaf = field.split(".").pop() ?? field;
  return leaf.replace(/_?[Ii][Dd]$/, "").replace(/ID$/, "");
}

function collectionNameCandidates(fieldPath: string): string[] {
  const base = stripIdSuffix(fieldPath);
  if (!base) return [];
  const lower = base.toLowerCase();
  return [...new Set([lower, pluralize(lower), singularize(lower), `${lower}s`, `${lower}es`])];
}

function sampledIds(collection: CollectionSchema): Set<string> {
  const ids = new Set<string>();
  for (const doc of collection.sampleDocuments) {
    const id = doc._id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

function sampledFieldValues(collection: CollectionSchema, field: string): string[] {
  const values: string[] = [];
  const leaf = field.includes(".") ? field : field;
  for (const doc of collection.sampleDocuments) {
    const v = getPath(doc, leaf);
    if (typeof v === "string") values.push(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") values.push(item);
        if (item && typeof item === "object" && typeof (item as { _id?: unknown })._id === "string") {
          values.push((item as { _id: string })._id);
        }
      }
    }
  }
  return values;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[\]/g, "").split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function inferRelationships(collections: CollectionSchema[]): Relationship[] {
  const byName = new Map(collections.map((c) => [c.name.toLowerCase(), c]));
  const relationships: Relationship[] = [];

  for (const from of collections) {
    for (const field of from.fields) {
      const leaf = field.path.split(".").pop() ?? field.path;
      if (leaf === "_id") continue;
      if (!field.isPossibleId && field.type !== "ObjectId") continue;
      if (!/id$/i.test(leaf.replace(/\[\]/g, ""))) continue;

      const candidates = collectionNameCandidates(field.path);
      let target: CollectionSchema | undefined;
      for (const cand of candidates) {
        const hit = byName.get(cand);
        if (hit && hit.name !== from.name) {
          target = hit;
          break;
        }
      }
      if (!target) continue;

      const fromValues = sampledFieldValues(from, field.path.replace(/\[\]/g, ""));
      const targetIds = sampledIds(target);
      const overlap = fromValues.filter((v) => targetIds.has(v)).length;
      let confidence = 0.55;
      let reason = `Field name '${field.path}' looks like a reference to '${target.name}._id'`;
      if (field.type === "ObjectId") {
        confidence += 0.15;
        reason += ". Field type is ObjectId";
      }
      if (fromValues.length > 0 && overlap > 0) {
        confidence += 0.2;
        reason += `. ${overlap} sampled value(s) match ${target.name}._id`;
      } else if (fromValues.length > 0 && targetIds.size > 0) {
        confidence -= 0.1;
        reason += ". Sampled values did not overlap with target _id samples";
      }
      confidence = Math.max(0.4, Math.min(0.95, confidence));

      relationships.push({
        fromCollection: from.name,
        fromField: field.path,
        toCollection: target.name,
        toField: "_id",
        confidence: Number(confidence.toFixed(2)),
        reason: `${reason}. This is an inferred relationship, not a guaranteed foreign key.`
      });
    }
  }

  const seen = new Set<string>();
  return relationships.filter((r) => {
    const key = `${r.fromCollection}.${r.fromField}->${r.toCollection}.${r.toField}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildDatabaseSchema(
  database: string,
  collections: CollectionSchema[]
): DatabaseSchema {
  const relationships = inferRelationships(collections);
  const dateFieldCount = collections.reduce(
    (n, c) => n + c.fields.filter((f) => f.type === "date").length,
    0
  );
  const numericFieldCount = collections.reduce(
    (n, c) => n + c.fields.filter((f) => f.isNumeric).length,
    0
  );
  const summary: DatabaseSummary = {
    collectionCount: collections.length,
    estimatedDocuments: collections.reduce((n, c) => n + c.estimatedCount, 0),
    relationshipCount: relationships.length,
    dateFieldCount,
    numericFieldCount
  };
  return {
    database,
    collections,
    relationships,
    introspectedAt: new Date().toISOString(),
    summary
  };
}

export function toCompactSchema(
  schema: DatabaseSchema,
  engine: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook" = "mongodb"
): CompactSchema {
  const isMongo = engine === "mongodb" || engine === "quickbooks" || engine === "outlook";
  return {
    database: schema.database,
    collections: schema.collections.map((c) => {
      const base = {
        name: c.name,
        estimatedCount: c.estimatedCount,
        fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type])),
        dateFields: c.fields.filter((f) => f.type === "date").map((f) => f.path),
        numericFields: c.fields.filter((f) => f.isNumeric).map((f) => f.path),
        possibleIdFields: c.fields.filter((f) => f.isPossibleId).map((f) => f.path)
      };
      // Mongo-only: string-stored dates need different comparison than BSON Date.
      // MySQL/MSSQL native DATE/DATETIME columns stay in dateFields only.
      if (!isMongo) return base;
      const stringDateFields = c.fields
        .filter((f) => f.type === "string" && f.isPossibleDate)
        .map((f) => f.path);
      return stringDateFields.length ? { ...base, stringDateFields } : base;
    }),
    relationships: schema.relationships,
    note: isMongo
      ? "Relationships are inferred from field names and sampled values. They are not guaranteed. Fields in stringDateFields are stored as strings (usually YYYY-MM-DD); dateIntents still work — the MongoDB backend injects matching string bounds."
      : "Relationships may include declared foreign keys. dateFields are native SQL date/datetime columns — put date filters directly in the SQL WHERE clause."
  };
}

export function collectionExists(schema: DatabaseSchema, name: string): boolean {
  return schema.collections.some((c) => c.name === name);
}

export function fieldIndex(schema: DatabaseSchema): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of schema.collections) {
    map.set(c.name, new Set(c.fields.map((f) => f.path)));
  }
  return map;
}
