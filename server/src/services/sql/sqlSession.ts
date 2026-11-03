import type { QueryExecutionResult, QueryPlan, DatabaseSchema } from "../../types/index.js";
import { AppError } from "../../utils/errors.js";
import type { SessionState } from "../session/SessionStore.js";
import { validateSqlQueryPlan } from "./SqlQueryValidator.js";
import { executeSqlQueryPlan, sampleSqlTable } from "./SqlQueryExecutionService.js";
import { executeMssqlQueryPlan, sampleMssqlTable } from "./MssqlQueryExecutionService.js";
import { sqlConnectionManager } from "./SqlConnectionManager.js";
import { mssqlConnectionManager } from "./MssqlConnectionManager.js";
import { isSqlEngine } from "./sqlEngine.js";

export function validateSessionSql(plan: QueryPlan, schema: DatabaseSchema, engine?: string) {
  return validateSqlQueryPlan(plan, schema, engine === "mssql" ? "mssql" : "mysql");
}

export async function executeSessionSql(session: SessionState, plan: QueryPlan): Promise<QueryExecutionResult> {
  if (!isSqlEngine(session.engine) || !session.activeConnectionId) {
    throw new AppError(400, "Not connected", "Not connected to SQL.", [], "NOT_CONNECTED");
  }
  if (session.engine === "mssql") {
    return executeMssqlQueryPlan(mssqlConnectionManager.getPool(session.activeConnectionId), plan);
  }
  return executeSqlQueryPlan(sqlConnectionManager.getPool(session.activeConnectionId), plan);
}

export async function sampleSessionSql(
  session: SessionState,
  table: string,
  limit: number
): Promise<Record<string, unknown>[]> {
  if (!isSqlEngine(session.engine) || !session.activeConnectionId) {
    throw new AppError(400, "Not connected", "Not connected to SQL.", [], "NOT_CONNECTED");
  }
  if (session.engine === "mssql") {
    return sampleMssqlTable(mssqlConnectionManager.getPool(session.activeConnectionId), table, limit);
  }
  return sampleSqlTable(sqlConnectionManager.getPool(session.activeConnectionId), table, limit);
}
