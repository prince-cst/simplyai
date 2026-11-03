import { Db, ObjectId } from "mongodb";

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const SKIP_REF_FIELDS = new Set([
  "_id",
  "id",
  "createdBy",
  "updatedBy",
  "upload",
  "generatedImage",
  "signatureImage",
  "payment",
  "websiteDetail",
  "termsConditionIds"
]);

/** Field → likely target collection names (checked in order). */
const FIELD_COLLECTION_HINTS: Record<string, string[]> = {
  branch: ["organizationbranches", "branches", "shops", "outlets"],
  shop: ["organizationbranches", "branches", "shops"],
  shopname: ["organizationbranches", "branches", "shops"],
  shopName: ["organizationbranches", "branches", "shops"],
  deviceName: ["devices"],
  device: ["devices"],
  modelName: ["models"],
  model: ["models"],
  organization: ["organizations"],
  categoryName: ["categories"],
  capacityName: ["capacities"],
  color: ["colors"]
};

const DISPLAY_NAME_FIELDS = [
  "branchName",
  "shopName",
  "shopname",
  "deviceName",
  "modelName",
  "categoryName",
  "capacityName",
  "displayName",
  "fullName",
  "label",
  "title",
  "name"
];

function isObjectIdLike(value: unknown): boolean {
  if (value instanceof ObjectId) return true;
  if (typeof value === "string" && OBJECT_ID_RE.test(value)) return true;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toHexString?: unknown }).toHexString === "function"
  ) {
    return true;
  }
  return false;
}

function toIdString(value: unknown): string | null {
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === "string" && OBJECT_ID_RE.test(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toHexString?: () => string }).toHexString === "function"
  ) {
    try {
      return (value as { toHexString: () => string }).toHexString();
    } catch {
      return null;
    }
  }
  return null;
}

function toObjectId(value: unknown): ObjectId | null {
  const id = toIdString(value);
  if (!id) return null;
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
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
  return leaf.replace(/_?[Ii][Dd]$/, "").replace(/ID$/, "").replace(/Name$/i, "");
}

function pickDisplayName(doc: Record<string, unknown>): string | null {
  for (const key of DISPLAY_NAME_FIELDS) {
    const v = doc[key];
    if (typeof v === "string" && v.trim() && !OBJECT_ID_RE.test(v.trim())) {
      return v.trim();
    }
  }
  return null;
}

function resolveTargetCollection(
  field: string,
  collectionsByLower: Map<string, string>
): string | null {
  const hints = FIELD_COLLECTION_HINTS[field] ?? FIELD_COLLECTION_HINTS[field.toLowerCase()];
  if (hints) {
    for (const h of hints) {
      const hit = collectionsByLower.get(h.toLowerCase());
      if (hit) return hit;
    }
  }

  const base = stripIdSuffix(field).toLowerCase();
  if (!base) return null;
  const candidates = [
    base,
    pluralize(base),
    singularize(base),
    `${base}s`,
    `${base}es`,
    `organization${pluralize(base)}`,
    `organization${base}`
  ];
  for (const cand of candidates) {
    const hit = collectionsByLower.get(cand);
    if (hit) return hit;
  }

  // Soft contains match (e.g. branch → organizationbranches)
  if (base.length >= 4) {
    for (const [lower, actual] of collectionsByLower) {
      if (lower.includes(base) || base.includes(lower)) return actual;
    }
  }
  return null;
}

/**
 * Resolve ObjectId foreign keys on matched rows into human-readable names
 * so alert emails show Shop / Device / etc. instead of opaque ids.
 */
export async function enrichMongoRowsForEmail(
  db: Db,
  _collectionName: string,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;

  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  const collectionsByLower = new Map(listed.map((c) => [c.name.toLowerCase(), c.name]));

  const fieldsToResolve = new Map<string, string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (SKIP_REF_FIELDS.has(key) || fieldsToResolve.has(key)) continue;
      if (!isObjectIdLike(value)) continue;
      const target = resolveTargetCollection(key, collectionsByLower);
      if (target) fieldsToResolve.set(key, target);
    }
  }

  if (!fieldsToResolve.size) return rows;

  const nameByFieldId = new Map<string, Map<string, string>>();
  for (const [field, targetCol] of fieldsToResolve) {
    const ids = [
      ...new Set(
        rows
          .map((r) => toObjectId(r[field]))
          .filter((id): id is ObjectId => Boolean(id))
      )
    ];
    if (!ids.length) continue;
    const docs = await db
      .collection(targetCol)
      .find({ _id: { $in: ids } })
      .project(
        Object.fromEntries([...DISPLAY_NAME_FIELDS, "_id"].map((k) => [k, 1]))
      )
      .toArray();
    const map = new Map<string, string>();
    for (const doc of docs) {
      const name = pickDisplayName(doc as Record<string, unknown>);
      if (name) map.set(String(doc._id), name);
    }
    nameByFieldId.set(field, map);
  }

  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [field, map] of nameByFieldId) {
      const id = toIdString(row[field]);
      if (!id) continue;
      const name = map.get(id);
      if (!name) continue;
      out[field] = name;
      // Friendly aliases for common stock/shop wording
      if (/^branch$/i.test(field)) {
        out.shopName = name;
        out.shopname = name;
        out.branchName = name;
      }
      if (/^deviceName$/i.test(field) || /^device$/i.test(field)) {
        out.device = name;
      }
    }
    return out;
  });
}
