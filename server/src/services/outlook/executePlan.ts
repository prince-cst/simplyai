import type { QueryExecutionResult, QueryPlan } from "../../types/index.js";
import { AppError } from "../../utils/errors.js";
import { env } from "../../config/env.js";
import { getAppStore } from "../../config/appStore.js";
import { addDays, startOfDayInTimeZone } from "./dates.js";
import { outlookConnectionManager } from "./OutlookConnectionManager.js";
import type { OutlookDateRange, OutlookFolder, OutlookPlanPayload } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFolder(value?: string): OutlookFolder {
  const v = (value || "inbox").toLowerCase();
  if (v === "sentitems" || v === "sent" || v === "sent items") return "sentitems";
  return "inbox";
}

function normalizeRange(value?: string): OutlookDateRange {
  const v = (value || "today").toLowerCase().replace(/\s+/g, "_");
  if (v === "yesterday") return "yesterday";
  if (v === "last_7_days" || v === "last7days" || v === "week") return "last_7_days";
  if (v === "last_30_days" || v === "last30days" || v === "month") return "last_30_days";
  if (v === "all" || v === "any") return "all";
  return "today";
}

function rangeStartIso(range: OutlookDateRange): string | undefined {
  const tz = env.timezone || "Asia/Kolkata";
  const todayStart = startOfDayInTimeZone(tz);
  if (range === "all") return undefined;
  if (range === "today") return todayStart.toISOString();
  if (range === "yesterday") return addDays(todayStart, -1).toISOString();
  if (range === "last_7_days") return addDays(todayStart, -6).toISOString();
  if (range === "last_30_days") return addDays(todayStart, -29).toISOString();
  return todayStart.toISOString();
}

function rangeEndExclusiveIso(range: OutlookDateRange): string | undefined {
  const tz = env.timezone || "Asia/Kolkata";
  const todayStart = startOfDayInTimeZone(tz);
  if (range === "yesterday") return todayStart.toISOString();
  return undefined;
}

export function extractOutlookPayload(plan: QueryPlan): OutlookPlanPayload {
  const fromField = asRecord(plan.outlook as unknown);
  if (fromField) {
    return {
      folder: normalizeFolder(typeof fromField.folder === "string" ? fromField.folder : plan.collection),
      range: normalizeRange(typeof fromField.range === "string" ? fromField.range : undefined),
      unreadOnly: Boolean(fromField.unreadOnly),
      includeBody: Boolean(fromField.includeBody),
      search: typeof fromField.search === "string" ? fromField.search.trim() : undefined
    };
  }

  const filter = asRecord(plan.filter) ?? {};
  return {
    folder: normalizeFolder(plan.collection === "SentItems" ? "sentitems" : "inbox"),
    range: normalizeRange(typeof filter.range === "string" ? filter.range : "today"),
    unreadOnly: Boolean(filter.unreadOnly ?? filter.isRead === false),
    includeBody: Boolean(filter.includeBody),
    search: typeof filter.search === "string" ? String(filter.search).trim() : undefined
  };
}

function mapMessage(raw: unknown, includeBody: boolean): Record<string, unknown> {
  const m = asRecord(raw) ?? {};
  const from = asRecord(m.from);
  const emailAddress = asRecord(from?.emailAddress);
  const body = asRecord(m.body);
  const contentType = typeof body?.contentType === "string" ? body.contentType.toLowerCase() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  const bodyText =
    includeBody && content
      ? contentType === "html"
        ? htmlToText(content).slice(0, 4000)
        : content.slice(0, 4000)
      : undefined;

  return {
    id: m.id,
    subject: m.subject ?? "(No subject)",
    from: emailAddress?.name ?? emailAddress?.address ?? "",
    fromAddress: emailAddress?.address ?? "",
    receivedDateTime: m.receivedDateTime,
    bodyPreview: m.bodyPreview ?? "",
    body: bodyText,
    isRead: Boolean(m.isRead),
    hasAttachments: Boolean(m.hasAttachments),
    importance: m.importance ?? "normal"
  };
}

export async function executeOutlookPlan(
  connectionId: string,
  plan: QueryPlan
): Promise<QueryExecutionResult> {
  const started = Date.now();
  let active = outlookConnectionManager.getLive(connectionId);
  if (!active) {
    const saved = getAppStore().connections.find((c) => c.id === connectionId);
    if (!saved) {
      throw new AppError(400, "Not connected", "Outlook is not connected.", [], "NOT_CONNECTED");
    }
    active = await outlookConnectionManager.open(saved);
  }

  const payload = extractOutlookPayload(plan);
  const limit = Math.min(plan.limit ?? env.maxResultDocuments, env.maxResultDocuments);
  const folder = payload.folder;
  const select = [
    "id",
    "subject",
    "from",
    "receivedDateTime",
    "bodyPreview",
    "isRead",
    "hasAttachments",
    "importance",
    ...(payload.includeBody ? ["body"] : [])
  ].join(",");

  const filters: string[] = [];
  const startIso = rangeStartIso(payload.range);
  const endIso = rangeEndExclusiveIso(payload.range);
  if (startIso) filters.push(`receivedDateTime ge ${startIso}`);
  if (endIso) filters.push(`receivedDateTime lt ${endIso}`);
  if (payload.unreadOnly) filters.push("isRead eq false");

  const params = new URLSearchParams();
  params.set("$select", select);
  params.set("$orderby", "receivedDateTime DESC");
  params.set("$top", String(Math.min(Math.max(limit, 1), 100)));
  if (filters.length) params.set("$filter", filters.join(" and "));
  if (payload.search) params.set("$search", `"${payload.search.replace(/"/g, "")}"`);

  // $search cannot be combined with $filter/$orderby in some Graph cases — prefer filter when both present.
  if (payload.search && filters.length) {
    params.delete("$search");
  }

  const path = `/me/mailFolders/${folder}/messages?${params.toString()}`;
  const json = await outlookConnectionManager.graphGet(connectionId, path);
  const root = asRecord(json);
  const value = Array.isArray(root?.value) ? root!.value : [];
  const documents = value.slice(0, limit).map((row) => mapMessage(row, Boolean(payload.includeBody)));
  const warnings: string[] = [];
  if (root?.["@odata.nextLink"]) {
    warnings.push("More messages are available; result is limited to the first page.");
  }
  warnings.push(`Fetched ${documents.length} message(s) from ${folder} (${payload.range}).`);

  return {
    success: true,
    operation: "outlook",
    collection: plan.collection || (folder === "sentitems" ? "SentItems" : "Inbox"),
    documents,
    resultCount: documents.length,
    truncated: documents.length >= limit || Boolean(root?.["@odata.nextLink"]),
    executionTimeMs: Date.now() - started,
    warnings
  };
}

export function validateOutlookPlan(plan: QueryPlan): { ok: boolean; reasons: string[]; plan: QueryPlan } {
  const reasons: string[] = [];
  try {
    extractOutlookPayload({ ...plan, operation: "outlook" });
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Invalid Outlook plan");
  }
  const normalized: QueryPlan = {
    ...plan,
    operation: "outlook",
    limit: Math.min(plan.limit ?? 40, 100),
    outlook: {
      ...extractOutlookPayload({ ...plan, operation: "outlook" })
    },
    visualization: { type: "none", title: plan.visualization?.title }
  };
  return { ok: reasons.length === 0, reasons, plan: normalized };
}
