import type { DatabaseSchema, QueryPlan } from "../../types/index.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import { collectionExists } from "./SchemaInferenceService.js";

export const ALLOWED_OPERATIONS = new Set(["find", "aggregate", "count", "distinct"]);

export const ALLOWED_STAGES = new Set([
  "$match",
  "$group",
  "$project",
  "$set",
  "$addFields",
  "$unset",
  "$sort",
  "$limit",
  "$skip",
  "$unwind",
  "$count",
  "$lookup",
  "$facet",
  "$bucket",
  "$bucketAuto",
  "$sortByCount",
  "$replaceRoot",
  "$replaceWith",
  "$unionWith"
]);

export const FORBIDDEN_OPERATORS = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$out",
  "$merge",
  "$currentOp",
  "$indexStats",
  "$collStats",
  "$planCacheStats",
  "$listSessions",
  "$listLocalSessions",
  "$changeStream",
  "$mergeObjectsJs"
]);

const FORBIDDEN_WORDS = [
  "insert",
  "insertmany",
  "update",
  "updatemany",
  "replaceone",
  "delete",
  "deletemany",
  "drop",
  "dropdatabase",
  "renamecollection",
  "createindex",
  "dropindex",
  "mapreduce"
];

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
  plan: QueryPlan;
}

function collectKeys(value: unknown, keys: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    keys.add(k);
    collectKeys(v, keys);
  }
}

function lookupCollections(value: unknown, found: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) lookupCollections(item, found);
    return;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.$lookup === "object" && rec.$lookup) {
    const from = (rec.$lookup as Record<string, unknown>).from;
    if (typeof from === "string") found.push(from);
  }
  if (typeof rec.$unionWith === "string") found.push(rec.$unionWith);
  if (typeof rec.$unionWith === "object" && rec.$unionWith) {
    const coll = (rec.$unionWith as Record<string, unknown>).coll;
    if (typeof coll === "string") found.push(coll);
  }
  for (const v of Object.values(rec)) lookupCollections(v, found);
}

export function validateQueryPlan(plan: QueryPlan, schema: DatabaseSchema): ValidationResult {
  const settings = getRuntimeSettings();
  const reasons: string[] = [];
  const next: QueryPlan = {
    ...plan,
    filter: plan.filter ? { ...plan.filter } : undefined,
    pipeline: plan.pipeline ? [...plan.pipeline] : undefined
  };

  if (plan.status !== "ready") {
    return { ok: false, reasons: ["Query plan is not ready for execution"], plan: next };
  }

  if (!ALLOWED_OPERATIONS.has(plan.operation)) {
    reasons.push(`Operation '${plan.operation}' is not allowed. Only find, aggregate, count, and distinct are permitted.`);
  }

  if (!plan.collection) {
    reasons.push("Collection is required");
  } else if (!collectionExists(schema, plan.collection)) {
    reasons.push(`Unknown collection '${plan.collection}'. Queries may only target discovered collections.`);
  }

  const opLower = plan.operation.toLowerCase();
  if (FORBIDDEN_WORDS.some((w) => opLower.includes(w))) {
    reasons.push("Write or administrative operations are not allowed. This application is read-only.");
  }

  const allKeys = new Set<string>();
  collectKeys(plan.filter, allKeys);
  collectKeys(plan.pipeline, allKeys);
  collectKeys(plan.projection, allKeys);

  for (const key of allKeys) {
    if (FORBIDDEN_OPERATORS.has(key)) {
      reasons.push(`Forbidden operator '${key}' is not allowed.`);
    }
  }

  if (plan.operation === "aggregate") {
    const pipeline = plan.pipeline ?? [];
    if (pipeline.length === 0) {
      reasons.push("Aggregation pipeline is required for aggregate operations.");
    }
    if (pipeline.length > settings.maxPipelineStages) {
      reasons.push(`Pipeline exceeds MAX_PIPELINE_STAGES (${settings.maxPipelineStages}).`);
    }
    for (const stage of pipeline) {
      const stageKeys = Object.keys(stage);
      if (stageKeys.length !== 1) {
        reasons.push("Each aggregation stage must contain exactly one operator.");
        continue;
      }
      const stageName = stageKeys[0]!;
      if (!ALLOWED_STAGES.has(stageName)) {
        reasons.push(`Aggregation stage '${stageName}' is not allowed.`);
      }
    }
  }

  if (plan.operation === "distinct" && !plan.distinctField) {
    reasons.push("distinctField is required for distinct operations.");
  }

  const lookedUp: string[] = [];
  lookupCollections(plan.pipeline, lookedUp);
  for (const name of lookedUp) {
    if (!collectionExists(schema, name)) {
      reasons.push(`$lookup/$unionWith targets unknown collection '${name}'.`);
    }
  }

  if (plan.limit && plan.limit > settings.maxResultDocuments) {
    next.limit = settings.maxResultDocuments;
  }

  if (plan.operation === "find") {
    if (!next.limit) next.limit = Math.min(50, settings.maxResultDocuments);
    next.limit = Math.min(next.limit, settings.maxResultDocuments);
  }

  if (plan.operation === "aggregate" && next.pipeline) {
    const hasLimit = next.pipeline.some((s) => "$limit" in s || "$count" in s || "$group" in s || "$facet" in s);
    if (!hasLimit) {
      next.pipeline = [...next.pipeline, { $limit: settings.maxResultDocuments }];
    }
  }

  const knownCollections = new Set(schema.collections.map((c) => c.name));
  for (const used of plan.collectionsUsed) {
    if (!knownCollections.has(used)) {
      reasons.push(`collectionsUsed contains unknown collection '${used}'.`);
    }
  }

  return { ok: reasons.length === 0, reasons, plan: next };
}
