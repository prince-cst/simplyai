import type { Db, Document } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  DatabaseSchema,
  FieldSchema,
  QueryExecutionResult,
  QueryPlan
} from "../../types/index.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import { hydrateDatesAndIds, toJsonSafe } from "../../utils/bson.js";
import {
  bsonDateFilter,
  resolveDateBoundStorage,
  resolveDateRange,
  sampleValuesForField
} from "../../utils/dates.js";
import { AppError, queryRejectedError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { validateQueryPlan } from "./QueryValidator.js";

function schemaTypeSets(schema: DatabaseSchema): { dates: Set<string>; ids: Set<string> } {
  const dates = new Set<string>();
  const ids = new Set<string>();
  for (const c of schema.collections) {
    for (const f of c.fields) {
      const leaf = f.path.split(".").pop() ?? f.path;
      // Only hydrate into BSON Date when the field is actually stored as date.
      // String "YYYY-MM-DD" date fields must stay strings or queries match nothing.
      if (f.type === "date" && !f.typesSeen.includes("string")) {
        dates.add(f.path);
        dates.add(leaf);
      }
      if (f.type === "ObjectId" || f.path === "_id" || leaf === "_id") {
        ids.add(f.path);
        ids.add(leaf);
      }
    }
  }
  ids.add("_id");
  return { dates, ids };
}

function findFieldSchema(
  schema: DatabaseSchema,
  collection: string,
  fieldPath: string
): { field?: FieldSchema; samples: unknown[] } {
  const col = schema.collections.find((c) => c.name === collection);
  if (!col) return { samples: [] };
  const field =
    col.fields.find((f) => f.path === fieldPath) ??
    col.fields.find((f) => f.path.split(".").pop() === fieldPath);
  const path = field?.path ?? fieldPath;
  return {
    field,
    samples: sampleValuesForField(col.sampleDocuments, path)
  };
}

function dateClauseForIntent(
  schema: DatabaseSchema,
  plan: QueryPlan,
  field: string,
  rangeKey: Parameters<typeof resolveDateRange>[0],
  timezone: string
): Record<string, unknown> {
  const range = resolveDateRange(rangeKey, timezone);
  const { field: meta, samples } = findFieldSchema(schema, plan.collection, field);
  const storage = resolveDateBoundStorage({
    fieldType: meta?.type,
    typesSeen: meta?.typesSeen,
    isPossibleDate: meta?.isPossibleDate,
    enumSamples: meta?.enumSamples,
    sampleValues: samples
  });
  return { [field]: bsonDateFilter(range, storage, timezone) };
}

/** MongoDB-only: inject dateIntents into filter / first $match using bounds that match field storage type.
 * MySQL/MSSQL never call this — they require date predicates inside the generated SQL string.
 */
export function applyDateIntents(
  plan: QueryPlan,
  timezone: string,
  schema?: DatabaseSchema
): QueryPlan {
  if (!plan.dateIntents?.length) return plan;
  const next: QueryPlan = {
    ...plan,
    filter: plan.filter ? { ...plan.filter } : {},
    pipeline: plan.pipeline ? [...plan.pipeline] : []
  };

  for (const intent of plan.dateIntents) {
    const clause = schema
      ? dateClauseForIntent(schema, plan, intent.field, intent.range, timezone)
      : {
          [intent.field]: bsonDateFilter(resolveDateRange(intent.range, timezone), "bsonDate", timezone)
        };
    if (plan.operation === "aggregate") {
      const first = next.pipeline?.[0];
      if (first && "$match" in first && first.$match && typeof first.$match === "object") {
        next.pipeline![0] = {
          $match: {
            ...(first.$match as Record<string, unknown>),
            ...clause
          }
        };
      } else {
        next.pipeline = [{ $match: clause }, ...(next.pipeline ?? [])];
      }
    } else {
      next.filter = { ...(next.filter ?? {}), ...clause };
    }
  }
  return next;
}

function jsonSafePlan(plan: QueryPlan): QueryPlan {
  return toJsonSafe(plan) as QueryPlan;
}

function hydratePlan(plan: QueryPlan, schema: DatabaseSchema): QueryPlan {
  const { dates, ids } = schemaTypeSets(schema);
  return {
    ...plan,
    filter: plan.filter
      ? (hydrateDatesAndIds(plan.filter, dates, ids) as Record<string, unknown>)
      : undefined,
    pipeline: plan.pipeline
      ? (hydrateDatesAndIds(plan.pipeline, dates, ids) as Record<string, unknown>[])
      : undefined,
    projection: plan.projection
      ? (hydrateDatesAndIds(plan.projection, dates, ids) as Record<string, unknown>)
      : undefined
  };
}

export async function executeQueryPlan(
  db: Db,
  schema: DatabaseSchema,
  rawPlan: QueryPlan
): Promise<QueryExecutionResult> {
  const settings = getRuntimeSettings();
  const withDates = applyDateIntents(rawPlan, settings.timezone, schema);
  const validation = validateQueryPlan(withDates, schema);
  if (!validation.ok) {
    throw queryRejectedError(validation.reasons);
  }
  // Plan shown to the user should include injected date bounds (not only dateIntents metadata).
  const displayPlan = jsonSafePlan(validation.plan);
  const plan = hydratePlan(validation.plan, schema);
  const started = Date.now();
  const timeout = settings.queryTimeoutMs;
  const maxDocs = settings.maxResultDocuments;
  const col = db.collection(plan.collection);
  const warnings: string[] = [];
  let documents: unknown[] = [];
  let truncated = false;

  try {
    switch (plan.operation) {
      case "find": {
        let cursor = col.find(plan.filter ?? {}).maxTimeMS(timeout);
        if (plan.projection) cursor = cursor.project(plan.projection as Document);
        if (plan.sort) cursor = cursor.sort(plan.sort as Document);
        if (plan.skip) cursor = cursor.skip(plan.skip);
        const limit = plan.limit ?? Math.min(50, maxDocs);
        const extra = await cursor.limit(limit + 1).toArray();
        if (extra.length > limit) {
          truncated = true;
          warnings.push("Result truncated. The query returned more data than the configured limit.");
        }
        documents = extra.slice(0, limit);
        break;
      }
      case "aggregate": {
        const pipeline = (plan.pipeline ?? []) as Document[];
        const extra = await col
          .aggregate(pipeline, { maxTimeMS: timeout, allowDiskUse: false })
          .toArray();
        if (extra.length > maxDocs) {
          truncated = true;
          warnings.push("Result truncated. The query returned more data than the configured limit.");
          documents = extra.slice(0, maxDocs);
        } else {
          documents = extra;
        }
        break;
      }
      case "count": {
        const n = await col.countDocuments(plan.filter ?? {}, { maxTimeMS: timeout });
        documents = [{ count: n }];
        break;
      }
      case "distinct": {
        const values = await col.distinct(plan.distinctField!, plan.filter ?? {}, {
          maxTimeMS: timeout
        });
        if (values.length > maxDocs) {
          truncated = true;
          warnings.push("Result truncated. The query returned more data than the configured limit.");
        }
        documents = values.slice(0, maxDocs).map((value) => ({ value }));
        break;
      }
      default:
        throw new AppError(400, "Unsupported operation", "Unsupported MongoDB operation.", [], "BAD_OP");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Query failed";
    throw new AppError(
      400,
      message,
      "MongoDB rejected the generated query.",
      [message.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[redacted]")],
      "MONGO_QUERY"
    );
  }

  const executionTimeMs = Date.now() - started;
  logger.info(
    {
      operation: plan.operation,
      collection: plan.collection,
      executionTimeMs,
      resultCount: documents.length
    },
    "Executed read-only MongoDB query"
  );

  return {
    success: true,
    operation: plan.operation,
    collection: plan.collection,
    documents: documents.map((d) => toJsonSafe(d)),
    resultCount: documents.length,
    truncated,
    executionTimeMs,
    warnings,
    executedPlan: displayPlan
  };
}

export function isObjectIdString(value: string): boolean {
  return ObjectId.isValid(value) && value.length === 24;
}
