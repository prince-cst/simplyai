import { v4 as uuid } from "uuid";
import {
  getTrigger,
  listTriggers,
  removeTrigger,
  upsertTrigger,
  getAppStore
} from "../../config/appStore.js";
import { env } from "../../config/env.js";
import type {
  TriggerDefinition,
  TriggerDedupeBucket,
  TriggerRunLog,
  TriggerStatus,
  TriggerWindow
} from "../../types/index.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { sendAlertEmail, isSmtpConfigured } from "./EmailService.js";
import { evaluateTriggerWindow, ensureTriggerConnection } from "./TriggerEvaluator.js";
import { formatRowsPreview, renderTemplate, rowIdentity } from "./triggerTemplates.js";
import { enrichMongoRowsForEmail } from "./triggerRowEnrichment.js";
import { mongoConnectionManager } from "../mongodb/MongoConnectionManager.js";

function normalizeWindows(windows: Array<Omit<TriggerWindow, "id"> & { id?: string }>): TriggerWindow[] {
  return windows.map((w) => ({
    id: w.id || uuid(),
    label: w.label,
    condition: w.condition,
    schedule: {
      cron: w.schedule.cron.trim(),
      timezone: w.schedule.timezone || env.timezone
    },
    dedupeBucket: w.dedupeBucket ?? inferDedupeBucket(w.schedule.cron)
  }));
}

export function inferDedupeBucket(cron: string): TriggerDedupeBucket {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return "day";
  const [minute, hour, dom, , dow] = parts;
  if (minute.startsWith("*/") || minute.includes(",")) return "minute";
  if (hour === "*" || hour.startsWith("*/")) return "hour";
  if (dom !== "*" || dow !== "*") {
    if (dom !== "*" && dom !== "?" && !dom.includes("*")) return "month";
  }
  return "day";
}

export function currentBucketKey(bucket: TriggerDedupeBucket, at = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const h = String(at.getUTCHours()).padStart(2, "0");
  const min = String(at.getUTCMinutes()).padStart(2, "0");
  switch (bucket) {
    case "minute":
      return `${y}-${m}-${d}T${h}:${min}`;
    case "hour":
      return `${y}-${m}-${d}T${h}`;
    case "week": {
      const day = at.getUTCDay();
      const start = new Date(Date.UTC(y, at.getUTCMonth(), at.getUTCDate() - day));
      return `${start.getUTCFullYear()}-W${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
    }
    case "month":
      return `${y}-${m}`;
    case "day":
    default:
      return `${y}-${m}-${d}`;
  }
}

function assertConnectionExists(connectionId: string): void {
  const saved = getAppStore().connections.find((c) => c.id === connectionId);
  if (!saved) {
    throw new AppError(404, "Connection not found", "Saved connection not found.", [], "NO_CONNECTION");
  }
  if (saved.engine === "quickbooks" || saved.engine === "outlook") {
    throw new AppError(
      400,
      "Unsupported engine",
      "Triggers do not support QuickBooks or Outlook yet.",
      [],
      "UNSUPPORTED_ENGINE"
    );
  }
}

export function listAllTriggers(): TriggerDefinition[] {
  return listTriggers();
}

export function getTriggerOrThrow(id: string): TriggerDefinition {
  const t = getTrigger(id);
  if (!t) throw new AppError(404, "Trigger not found", "Trigger not found.", [], "TRIGGER_NOT_FOUND");
  return t;
}

export function createTrigger(input: {
  name: string;
  connectionId: string;
  userPrompt: string;
  explanation: string;
  target: TriggerDefinition["target"];
  windows: Array<Omit<TriggerWindow, "id"> & { id?: string }>;
  email: TriggerDefinition["email"];
  status?: TriggerStatus;
}): TriggerDefinition {
  assertConnectionExists(input.connectionId);
  const now = new Date().toISOString();
  const trigger: TriggerDefinition = {
    id: uuid(),
    name: input.name,
    connectionId: input.connectionId,
    status: input.status ?? "draft",
    userPrompt: input.userPrompt,
    explanation: input.explanation,
    target: input.target,
    windows: normalizeWindows(input.windows),
    email: {
      to: input.email.to.map((e) => e.trim().toLowerCase()),
      subjectTemplate: input.email.subjectTemplate,
      bodyTemplate: input.email.bodyTemplate,
      displayFields: input.email.displayFields?.map((f) => f.trim()).filter(Boolean)
    },
    createdAt: now,
    updatedAt: now,
    recentRuns: [],
    notifiedKeys: [],
    watermarks: {}
  };
  upsertTrigger(trigger);
  return trigger;
}

export function patchTrigger(
  id: string,
  patch: Partial<{
    name: string;
    explanation: string;
    target: TriggerDefinition["target"];
    windows: Array<Omit<TriggerWindow, "id"> & { id?: string }>;
    email: TriggerDefinition["email"];
    status: TriggerStatus;
  }>
): TriggerDefinition {
  const current = getTriggerOrThrow(id);
  const next: TriggerDefinition = {
    ...current,
    name: patch.name ?? current.name,
    explanation: patch.explanation ?? current.explanation,
    target: patch.target ?? current.target,
    windows: patch.windows ? normalizeWindows(patch.windows) : current.windows,
    email: patch.email
      ? {
          to: patch.email.to.map((e) => e.trim().toLowerCase()),
          subjectTemplate: patch.email.subjectTemplate,
          bodyTemplate: patch.email.bodyTemplate,
          displayFields: patch.email.displayFields?.map((f) => f.trim()).filter(Boolean)
        }
      : current.email,
    status: patch.status ?? current.status,
    updatedAt: new Date().toISOString()
  };
  upsertTrigger(next);
  return next;
}

export function approveTrigger(id: string): TriggerDefinition {
  return patchTrigger(id, { status: "active" });
}

export function deleteTrigger(id: string): void {
  if (!removeTrigger(id)) {
    throw new AppError(404, "Trigger not found", "Trigger not found.", [], "TRIGGER_NOT_FOUND");
  }
}

export async function runTriggerWindow(input: {
  triggerId: string;
  windowId?: string;
  sendEmail?: boolean;
  dryRun?: boolean;
}): Promise<{ trigger: TriggerDefinition; run: TriggerRunLog }> {
  const trigger = getTriggerOrThrow(input.triggerId);
  const window =
    (input.windowId ? trigger.windows.find((w) => w.id === input.windowId) : undefined) ??
    trigger.windows[0];
  if (!window) {
    throw new AppError(400, "No window", "Trigger has no schedule windows.", [], "NO_WINDOW");
  }

  const dryRun = input.dryRun ?? false;
  const sendEmail = dryRun ? false : (input.sendEmail ?? true);
  const runId = uuid();
  const at = new Date().toISOString();

  try {
    await ensureTriggerConnection(trigger.connectionId);
    const { rows, truncated, nextWatermark } = await evaluateTriggerWindow(trigger, window, {
      dryRun
    });
    const isNewDocs = window.condition.kind === "newDocuments";
    const bucket = window.dedupeBucket ?? inferDedupeBucket(window.schedule.cron);
    const period = currentBucketKey(bucket);
    const notified = new Set(trigger.notifiedKeys);
    // newDocuments: each row notified once (no time bucket). Other kinds keep schedule buckets.
    const fresh = dryRun
      ? rows
      : rows.filter((row) => {
          const key = isNewDocs
            ? `${rowIdentity(row)}:${window.id}:once`
            : `${rowIdentity(row)}:${window.id}:${period}`;
          return !notified.has(key);
        });

    let emailed = false;
    if (fresh.length && sendEmail) {
      if (!isSmtpConfigured()) {
        throw new AppError(
          503,
          "SMTP not configured",
          "Configure SMTP_HOST / SMTP_USER / SMTP_PASSWORD in server/.env to send alert emails.",
          [],
          "SMTP_MISSING"
        );
      }
      let emailRows = fresh;
      if (trigger.target.engine === "mongodb") {
        try {
          const db = mongoConnectionManager.getDbForConnection(trigger.connectionId);
          emailRows = await enrichMongoRowsForEmail(
            db,
            trigger.target.collectionOrTable,
            fresh
          );
        } catch (enrichErr) {
          logger.warn(
            { err: enrichErr, triggerId: trigger.id },
            "Trigger row enrichment failed; sending raw fields"
          );
        }
      }
      const vars = {
        name: trigger.name,
        matchCount: fresh.length,
        windowLabel: window.label,
        rows: formatRowsPreview(emailRows, {
          displayFields: trigger.email.displayFields
        }),
        truncated: truncated ? "yes" : "no"
      };
      await sendAlertEmail({
        to: trigger.email.to,
        subject: renderTemplate(trigger.email.subjectTemplate, vars),
        text: renderTemplate(trigger.email.bodyTemplate, vars)
      });
      emailed = true;
      for (const row of fresh) {
        notified.add(
          isNewDocs
            ? `${rowIdentity(row)}:${window.id}:once`
            : `${rowIdentity(row)}:${window.id}:${period}`
        );
      }
    }

    const run: TriggerRunLog = {
      id: runId,
      at,
      windowId: window.id,
      matchCount: fresh.length,
      emailed,
      dryRun,
      sampleIds: fresh.slice(0, 10).map(rowIdentity)
    };

    const watermarks = { ...(trigger.watermarks ?? {}) };
    if (nextWatermark && !dryRun) {
      watermarks[window.id] = nextWatermark;
    }

    const updated: TriggerDefinition = {
      ...trigger,
      lastRunAt: at,
      lastError: undefined,
      notifiedKeys: [...notified].slice(-2000),
      watermarks,
      recentRuns: [run, ...trigger.recentRuns].slice(0, 20),
      updatedAt: at
    };
    upsertTrigger(updated);
    return { trigger: updated, run };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trigger run failed";
    const run: TriggerRunLog = {
      id: runId,
      at,
      windowId: window.id,
      matchCount: 0,
      emailed: false,
      dryRun,
      error: message
    };
    const updated: TriggerDefinition = {
      ...trigger,
      lastRunAt: at,
      lastError: message,
      recentRuns: [run, ...trigger.recentRuns].slice(0, 20),
      updatedAt: at
    };
    upsertTrigger(updated);
    logger.warn({ triggerId: trigger.id, windowId: window.id, message }, "Trigger run failed");
    throw error instanceof AppError
      ? error
      : new AppError(500, message, "Trigger evaluation failed.", [], "TRIGGER_RUN_FAILED");
  }
}
