import type { QueryExecutionResult, QueryPlan } from "../../types/index.js";
import { AppError } from "../../utils/errors.js";
import { env } from "../../config/env.js";
import { getAppStore } from "../../config/appStore.js";
import { quickBooksConnectionManager } from "./QuickBooksConnectionManager.js";
import { QBO_ENTITIES, QBO_REPORTS, type QboPlanPayload, type QboReportName } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function extractQboPayload(plan: QueryPlan): QboPlanPayload {
  const fromField = asRecord(plan.qbo as unknown);
  if (fromField && typeof fromField.action === "string") {
    return {
      action: fromField.action as QboPlanPayload["action"],
      reportName: fromField.reportName as QboPlanPayload["reportName"],
      entity: fromField.entity as QboPlanPayload["entity"],
      params: asRecord(fromField.params) as Record<string, string> | undefined,
      query: typeof fromField.query === "string" ? fromField.query : undefined
    };
  }

  const collection = plan.collection;
  if ((QBO_REPORTS as string[]).includes(collection)) {
    const params: Record<string, string> = {};
    const filter = plan.filter ?? {};
    for (const [k, v] of Object.entries(filter)) {
      if (v != null && typeof v !== "object") params[k] = String(v);
    }
    return { action: "report", reportName: collection as QboReportName, params };
  }

  if ((QBO_ENTITIES as string[]).includes(collection)) {
    const query =
      typeof plan.sql === "string" && plan.sql.trim()
        ? plan.sql.trim()
        : `SELECT * FROM ${collection} MAXRESULTS ${Math.min(plan.limit ?? 20, 100)}`;
    return { action: "query", entity: collection as QboPlanPayload["entity"], query };
  }

  throw new AppError(
    400,
    "Invalid QuickBooks plan",
    "Plan must target a known QuickBooks report or entity.",
    [],
    "QB_PLAN"
  );
}

function flattenReportRows(payload: unknown, limit: number): unknown[] {
  const root = asRecord(payload);
  const rowsContainer = asRecord(root?.Rows);
  const rows = rowsContainer?.Row;
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const out: unknown[] = [];

  const walk = (row: unknown, depth: number): void => {
    if (out.length >= limit) return;
    const r = asRecord(row);
    if (!r) return;
    const nested = r.Rows ? asRecord(r.Rows)?.Row : undefined;
    if (nested) {
      const children = Array.isArray(nested) ? nested : [nested];
      for (const child of children) walk(child, depth + 1);
      return;
    }
    const cols = r.ColData;
    if (Array.isArray(cols)) {
      const obj: Record<string, unknown> = { depth };
      cols.forEach((col, i) => {
        const c = asRecord(col);
        obj[`col${i}`] = c?.value ?? c;
        if (typeof c?.id === "string") obj[`col${i}_id`] = c.id;
      });
      if (typeof r.group === "string") obj.group = r.group;
      if (typeof r.type === "string") obj.type = r.type;
      out.push(obj);
    } else {
      out.push(r);
    }
  };

  for (const row of list) walk(row, 0);
  if (out.length === 0 && root) {
    out.push({ summary: root.Header ?? root });
  }
  return out.slice(0, limit);
}

function entityDocuments(payload: unknown, entity: string, limit: number): unknown[] {
  const root = asRecord(payload);
  const queryResponse = asRecord(root?.QueryResponse) ?? root;
  if (!queryResponse) return [];
  const raw = queryResponse[entity] ?? queryResponse[entity.replace(/Info$/, "")];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.slice(0, limit);
}

export async function executeQboPlan(
  connectionId: string,
  plan: QueryPlan
): Promise<QueryExecutionResult> {
  const started = Date.now();
  let active = quickBooksConnectionManager.getLive(connectionId);
  if (!active) {
    const saved = getAppStore().connections.find((c) => c.id === connectionId);
    if (!saved) {
      throw new AppError(400, "Not connected", "QuickBooks is not connected.", [], "NOT_CONNECTED");
    }
    active = await quickBooksConnectionManager.open(saved);
  }

  const payload = extractQboPayload(plan);
  const limit = Math.min(plan.limit ?? env.maxResultDocuments, env.maxResultDocuments);
  let documents: unknown[] = [];
  const warnings: string[] = [];

  if (payload.action === "report") {
    const reportName = payload.reportName || (plan.collection as QboReportName);
    if (!(QBO_REPORTS as string[]).includes(reportName)) {
      throw new AppError(400, "Unknown report", `Report ${reportName} is not allowed.`, [], "QB_REPORT");
    }
    const params = new URLSearchParams(payload.params ?? {});
    if (!params.has("date_macro") && !params.has("start_date") && !params.has("end_date")) {
      if (reportName.startsWith("Aged")) {
        params.set("date_macro", "Today");
      } else {
        params.set("date_macro", "This Fiscal Year-to-date");
      }
    }
    const qs = params.toString();
    const path = `/v3/company/${active.realmId}/reports/${reportName}${qs ? `?${qs}` : ""}`;
    const json = await quickBooksConnectionManager.apiGet(connectionId, path);
    documents = flattenReportRows(json, limit);
    warnings.push("Report rows are flattened from QuickBooks report JSON for chat answers.");
  } else if (payload.action === "query" || payload.action === "read") {
    const query =
      payload.query?.trim() ||
      `SELECT * FROM ${payload.entity || plan.collection} MAXRESULTS ${limit}`;
    if (!/^select\s+/i.test(query)) {
      throw new AppError(400, "Invalid query", "Only SELECT queries are allowed against QuickBooks.", [], "QB_QUERY");
    }
    const path = `/v3/company/${active.realmId}/query?query=${encodeURIComponent(query)}`;
    const json = await quickBooksConnectionManager.apiGet(connectionId, path);
    const entityGuess =
      payload.entity ||
      (/from\s+(\w+)/i.exec(query)?.[1] as string) ||
      plan.collection;
    documents = entityDocuments(json, entityGuess, limit);
    if (documents.length === 0) {
      documents = [json];
      warnings.push("Could not unwrap entity list; returning raw QueryResponse.");
    }
  } else {
    throw new AppError(400, "Unsupported action", "Unsupported QuickBooks action.", [], "QB_ACTION");
  }

  return {
    success: true,
    operation: "qbo",
    collection: plan.collection,
    documents,
    resultCount: documents.length,
    truncated: documents.length >= limit,
    executionTimeMs: Date.now() - started,
    warnings
  };
}

export function validateQboPlan(plan: QueryPlan): { ok: boolean; reasons: string[]; plan: QueryPlan } {
  const reasons: string[] = [];
  try {
    const payload = extractQboPayload({ ...plan, operation: "qbo" });
    if (payload.action === "report" && payload.reportName && !(QBO_REPORTS as string[]).includes(payload.reportName)) {
      reasons.push(`Unknown report: ${payload.reportName}`);
    }
    if (payload.action === "query" && payload.query && !/^select\s+/i.test(payload.query)) {
      reasons.push("QuickBooks query must be SELECT-only.");
    }
    if (payload.entity && !(QBO_ENTITIES as string[]).includes(payload.entity)) {
      reasons.push(`Unknown entity: ${payload.entity}`);
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Invalid QuickBooks plan");
  }

  const normalized: QueryPlan = {
    ...plan,
    operation: "qbo",
    limit: Math.min(plan.limit ?? 40, 100)
  };
  return { ok: reasons.length === 0, reasons, plan: normalized };
}
