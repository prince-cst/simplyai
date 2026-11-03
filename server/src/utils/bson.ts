import { ObjectId, Long, Decimal128, Binary, Double, Int32 } from "mongodb";

export function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Decimal128) return value.toString();
  if (value instanceof Long || value instanceof Double || value instanceof Int32) {
    return value.valueOf();
  }
  if (value instanceof Binary) return `[Binary ${value.length()} bytes]`;
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

export function reviveMongoValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date || value instanceof ObjectId) return value;
  if (value instanceof Decimal128 || value instanceof Long || value instanceof Double || value instanceof Int32) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => reviveMongoValue(item));
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.$oid === "string" && ObjectId.isValid(rec.$oid)) {
      return new ObjectId(rec.$oid);
    }
    if (typeof rec.$date === "string") {
      const d = new Date(rec.$date);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof rec.$date === "number") {
      return new Date(rec.$date);
    }
    if (rec.$date && typeof rec.$date === "object" && "$numberLong" in (rec.$date as object)) {
      const n = Number((rec.$date as { $numberLong: string }).$numberLong);
      if (Number.isFinite(n)) return new Date(n);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = reviveMongoValue(v);
    }
    return out;
  }
  return value;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/;

export function hydrateDatesAndIds(
  value: unknown,
  dateFields: Set<string>,
  objectIdFields: Set<string>,
  path = ""
): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date || value instanceof ObjectId) return value;
  if (Array.isArray(value)) {
    return value.map((item) => hydrateDatesAndIds(item, dateFields, objectIdFields, path));
  }
  if (typeof value === "object") {
    const revived = reviveMongoValue(value);
    if (revived instanceof Date || revived instanceof ObjectId) return revived;
    const rec = revived as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      const childPath = path ? `${path}.${k}` : k;
      if (k.startsWith("$") && typeof v !== "object") {
        out[k] = v;
        continue;
      }
      out[k] = hydrateDatesAndIds(v, dateFields, objectIdFields, childPath);
    }
    return out;
  }
  if (typeof value === "string") {
    const leaf = path.split(".").pop() ?? path;
    const dotted = path;
    if (
      (dateFields.has(leaf) || dateFields.has(dotted) || dateFields.has(path)) &&
      (ISO_DATE_RE.test(value) || !Number.isNaN(Date.parse(value)))
    ) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (
      (objectIdFields.has(leaf) || objectIdFields.has(dotted) || objectIdFields.has("_id") && leaf === "_id") &&
      ObjectId.isValid(value) &&
      value.length === 24
    ) {
      return new ObjectId(value);
    }
  }
  return value;
}
