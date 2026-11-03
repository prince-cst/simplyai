import type { ConnectionPool } from "mssql";
import type { QueryExecutionResult, QueryPlan } from "../../types/index.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import { quoteMssqlIdent } from "./MssqlIntrospectionService.js";

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

export function applyMssqlRowLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const withoutMysqlLimit = trimmed.replace(/\s+limit\s+\d+\s*$/i, "");
  if (/\b(top\s*\(|top\s+\d+|fetch\s+(next|first))\b/i.test(withoutMysqlLimit)) {
    return withoutMysqlLimit;
  }
  if (/^\s*select\s+distinct\s+/i.test(withoutMysqlLimit)) {
    return withoutMysqlLimit.replace(/^\s*select\s+distinct\s+/i, `SELECT DISTINCT TOP (${limit}) `);
  }
  if (/^\s*select\s+/i.test(withoutMysqlLimit)) {
    return withoutMysqlLimit.replace(/^\s*select\s+/i, `SELECT TOP (${limit}) `);
  }
  return `SELECT TOP (${limit}) * FROM (${withoutMysqlLimit}) AS _limited`;
}

export async function executeMssqlQueryPlan(pool: ConnectionPool, plan: QueryPlan): Promise<QueryExecutionResult> {
  const settings = getRuntimeSettings();
  const started = Date.now();
  const warnings: string[] = [];
  const sql = applyMssqlRowLimit(String(plan.sql ?? ""), settings.maxResultDocuments);
  const result = await pool.request().query(sql);
  const list = (result.recordset ?? []).map(serializeRow);
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

export async function sampleMssqlTable(
  pool: ConnectionPool,
  table: string,
  limit: number
): Promise<Record<string, unknown>[]> {
  if (!/^[A-Za-z0-9_\.]+$/.test(table)) {
    throw new Error("Invalid table name");
  }
  const safe = Math.min(Math.max(limit, 1), 20);
  const result = await pool.request().query(`SELECT TOP (${safe}) * FROM ${quoteMssqlIdent(table)}`);
  return (result.recordset ?? []).map(serializeRow);
}
