import type { Pool } from "mysql2/promise";
import type { QueryExecutionResult, QueryPlan } from "../../types/index.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";

function serializeCell(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return { value: row };
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, serializeCell(v)]));
}

export async function executeSqlQueryPlan(pool: Pool, plan: QueryPlan): Promise<QueryExecutionResult> {
  const settings = getRuntimeSettings();
  const started = Date.now();
  const warnings: string[] = [];
  let sql = String(plan.sql ?? "").trim().replace(/;+\s*$/, "");
  if (!/\blimit\b/i.test(sql)) {
    sql = `${sql} LIMIT ${settings.maxResultDocuments}`;
  }
  const [rows] = await pool.query(sql);
  const list = Array.isArray(rows) ? rows.map(serializeRow) : [];
  const truncated = list.length > settings.maxResultDocuments;
  const documents = truncated ? list.slice(0, settings.maxResultDocuments) : list;
  if (truncated) warnings.push(`Result truncated to ${settings.maxResultDocuments} rows`);
  return {
    success: true,
    operation: "sql",
    collection: plan.collection,
    documents,
    resultCount: documents.length,
    truncated,
    executionTimeMs: Date.now() - started,
    warnings
  };
}

export async function sampleSqlTable(pool: Pool, table: string, limit: number): Promise<Record<string, unknown>[]> {
  if (!/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error("Invalid table name");
  }
  const safe = Math.min(Math.max(limit, 1), 20);
  const [rows] = await pool.query(`SELECT * FROM \`${table}\` LIMIT ${safe}`);
  return Array.isArray(rows) ? rows.map(serializeRow) : [];
}
