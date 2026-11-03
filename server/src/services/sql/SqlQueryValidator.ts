import type { DatabaseSchema, QueryPlan } from "../../types/index.js";
import { collectionExists } from "../mongodb/SchemaInferenceService.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import type { SqlDialect } from "./sqlEngine.js";

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|truncate|grant|revoke|rename|handler|lock\s+tables|unlock|load\s+data|outfile|dumpfile|into\s+outfile|into\s+dumpfile|benchmark\s*\(|sleep\s*\(|prepare|deallocate|execute\s+|exec\s+|call\s+|do\s+|set\s+|start\s+transaction|commit|rollback|shutdown|kill|waitfor|dbcc|openrowset|opendatasource|bulk\s+insert|xp_|sp_configure)\b/i;

export interface SqlValidationResult {
  ok: boolean;
  reasons: string[];
  plan: QueryPlan;
}

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/#[^\n]*/g, " ");
}

export function sqlTableExists(schema: DatabaseSchema, name: string): boolean {
  const norm = (value: string) =>
    value
      .replace(/[\[\]]/g, "")
      .replace(/^dbo\./i, "")
      .toLowerCase();
  const needle = norm(name);
  return schema.collections.some((c) => c.name === name || norm(c.name) === needle);
}

export function validateSqlQueryPlan(
  plan: QueryPlan,
  schema: DatabaseSchema,
  _dialect: SqlDialect = "mysql"
): SqlValidationResult {
  const reasons: string[] = [];
  const sql = stripSqlComments(String(plan.sql ?? "")).trim().replace(/;+\s*$/, "");
  if (!sql) {
    reasons.push("SQL statement is required");
  }
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    reasons.push("Only a single SELECT statement is allowed");
  }
  const body = statements[0] ?? "";
  if (body && !/^\s*(select|with)\b/i.test(body)) {
    reasons.push("Only SELECT / WITH (read-only) queries are allowed");
  }
  if (body && FORBIDDEN.test(body)) {
    reasons.push("Write or administrative SQL is not allowed");
  }
  const tables = plan.collectionsUsed.length ? plan.collectionsUsed : plan.collection ? [plan.collection] : [];
  for (const name of tables) {
    if (name && !sqlTableExists(schema, name) && !collectionExists(schema, name)) {
      reasons.push(`Unknown table '${name}'`);
    }
  }
  const next: QueryPlan = {
    ...plan,
    operation: "sql",
    sql: body,
    collection: plan.collection || tables[0] || "",
    collectionsUsed: tables,
    limit: Math.min(plan.limit ?? getRuntimeSettings().maxResultDocuments, getRuntimeSettings().maxResultDocuments)
  };
  return { ok: reasons.length === 0, reasons, plan: next };
}
