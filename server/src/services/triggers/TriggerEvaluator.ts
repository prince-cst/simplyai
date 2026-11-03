import type { Db } from "mongodb";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import { getAppStore } from "../../config/appStore.js";
import type {
  TriggerDefinition,
  TriggerEngine,
  TriggerWindow,
  TriggerWindowCondition
} from "../../types/index.js";
import { AppError } from "../../utils/errors.js";
import { getZonedParts, startOfZonedDay } from "../../utils/dates.js";
import { mongoConnectionManager } from "../mongodb/MongoConnectionManager.js";
import { sqlConnectionManager } from "../sql/SqlConnectionManager.js";
import { mssqlConnectionManager } from "../sql/MssqlConnectionManager.js";
import { connectionEngineOf } from "../sql/mysqlUri.js";
import { executeSqlQueryPlan } from "../sql/SqlQueryExecutionService.js";
import { executeMssqlQueryPlan } from "../sql/MssqlQueryExecutionService.js";
import { quoteMssqlIdent } from "../sql/MssqlIntrospectionService.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MONGO_FIELD = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function assertIdent(name: string, label: string): string {
  if (!IDENT.test(name)) {
    throw new AppError(400, `Invalid ${label}`, `Invalid ${label} name.`, [], "INVALID_IDENT");
  }
  return name;
}

function assertMongoField(path: string): string {
  if (!MONGO_FIELD.test(path)) {
    throw new AppError(400, "Invalid date field", "Invalid date field path.", [], "INVALID_FIELD");
  }
  return path;
}

function assertDateOnly(value: string): string {
  if (!DATE_ONLY.test(value)) {
    throw new AppError(
      400,
      "Invalid date",
      "Absolute trigger dates must be YYYY-MM-DD.",
      [],
      "INVALID_DATE"
    );
  }
  return value;
}

function todayDateOnly(timezone: string): string {
  const p = getZonedParts(new Date(), timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Coerce string YYYY-MM-DD / ISO / BSON Date into a date for $dateDiff and comparisons. */
function asDateExprMongo(dateField: string): Record<string, unknown> {
  return {
    $convert: {
      input: `$${dateField}`,
      to: "date",
      onError: null,
      onNull: null
    }
  };
}

function daysUntilExprMongo(dateField: string): Record<string, unknown> {
  return {
    $dateDiff: {
      startDate: "$$NOW",
      endDate: asDateExprMongo(dateField),
      unit: "day"
    }
  };
}

/** Inclusive end-of-day UTC instant for YYYY-MM-DD (calendar date, not timezone-shifted). */
function endOfDateUtc(dateOnly: string): Date {
  return new Date(`${assertDateOnly(dateOnly)}T23:59:59.999Z`);
}

function startOfDateUtc(dateOnly: string): Date {
  return new Date(`${assertDateOnly(dateOnly)}T00:00:00.000Z`);
}

export async function ensureTriggerConnection(connectionId: string): Promise<{
  engine: TriggerEngine;
  savedName: string;
}> {
  const saved = getAppStore().connections.find((c) => c.id === connectionId);
  if (!saved) {
    throw new AppError(404, "Connection not found", "Saved connection not found.", [], "NO_CONNECTION");
  }
  const engine = connectionEngineOf(saved);
  if (engine === "quickbooks" || engine === "outlook") {
    throw new AppError(
      400,
      "Unsupported engine",
      "Triggers do not support QuickBooks or Outlook yet. Use MongoDB, MySQL, or SQL Server.",
      [],
      "UNSUPPORTED_ENGINE"
    );
  }
  await mongoConnectionManager.ensureLiveForConnection(connectionId);
  return { engine: engine as TriggerEngine, savedName: saved.name };
}

export async function evaluateTriggerWindow(
  trigger: TriggerDefinition,
  window: TriggerWindow,
  options?: { dryRun?: boolean }
): Promise<{
  rows: Record<string, unknown>[];
  truncated: boolean;
  executionTimeMs: number;
  /** When set, persist on the trigger after a successful run (newDocuments watches). */
  nextWatermark?: string;
}> {
  const { engine } = await ensureTriggerConnection(trigger.connectionId);
  const settings = getRuntimeSettings();
  // Triggers email the full match set — use a higher cap than chat query previews.
  const limit = Math.max(settings.maxResultDocuments, 2000);
  const started = Date.now();
  const dryRun = options?.dryRun ?? false;

  if (engine === "mongodb") {
    const db = mongoConnectionManager.getDbForConnection(trigger.connectionId);
    const { rows, nextWatermark } = await evaluateMongo(db, trigger, window, limit, dryRun);
    return {
      rows,
      truncated: rows.length >= limit,
      executionTimeMs: Date.now() - started,
      nextWatermark
    };
  }

  if (engine === "mssql") {
    const pool = mssqlConnectionManager.getPool(trigger.connectionId);
    const table = assertIdent(trigger.target.collectionOrTable, "table");
    const dateField = assertIdent(
      trigger.target.dateField.split(".").pop() ?? trigger.target.dateField,
      "column"
    );
    const extra =
      typeof trigger.target.extraFilter === "string" && trigger.target.extraFilter.trim()
        ? ` AND (${trigger.target.extraFilter.trim()})`
        : "";
    const { clause, nextWatermark, primed } = sqlCondition(
      "mssql",
      dateField,
      window.condition,
      settings.timezone,
      trigger,
      window,
      dryRun
    );
    if (primed) {
      return { rows: [], truncated: false, executionTimeMs: Date.now() - started, nextWatermark };
    }
    const sql = `SELECT TOP (${limit}) * FROM ${quoteMssqlIdent(table)} WHERE ${clause}${extra}`;
    const result = await executeMssqlQueryPlan(pool, {
      status: "ready",
      operation: "sql",
      collection: table,
      sql,
      explanation: "trigger window",
      collectionsUsed: [table],
      fieldsUsed: [dateField],
      assumptions: [],
      confidence: 1
    });
    return {
      rows: result.documents as Record<string, unknown>[],
      truncated: result.truncated,
      executionTimeMs: Date.now() - started,
      nextWatermark
    };
  }

  const pool = sqlConnectionManager.getPool(trigger.connectionId);
  const table = assertIdent(trigger.target.collectionOrTable, "table");
  const dateField = assertIdent(
    trigger.target.dateField.split(".").pop() ?? trigger.target.dateField,
    "column"
  );
  const extra =
    typeof trigger.target.extraFilter === "string" && trigger.target.extraFilter.trim()
      ? ` AND (${trigger.target.extraFilter.trim()})`
      : "";
  const { clause, nextWatermark, primed } = sqlCondition(
    "mysql",
    dateField,
    window.condition,
    settings.timezone,
    trigger,
    window,
    dryRun
  );
  if (primed) {
    return { rows: [], truncated: false, executionTimeMs: Date.now() - started, nextWatermark };
  }
  const sql = `SELECT * FROM \`${table}\` WHERE ${clause}${extra} LIMIT ${limit}`;
  const result = await executeSqlQueryPlan(pool, {
    status: "ready",
    operation: "sql",
    collection: table,
    sql,
    explanation: "trigger window",
    collectionsUsed: [table],
    fieldsUsed: [dateField],
    assumptions: [],
    confidence: 1
  });
  return {
    rows: result.documents as Record<string, unknown>[],
    truncated: result.truncated,
    executionTimeMs: Date.now() - started,
    nextWatermark
  };
}

function sqlCondition(
  dialect: "mysql" | "mssql",
  dateField: string,
  condition: TriggerWindowCondition,
  timezone: string,
  trigger: TriggerDefinition,
  window: TriggerWindow,
  dryRun: boolean
): { clause: string; nextWatermark?: string; primed?: boolean } {
  const col =
    dialect === "mssql" ? quoteMssqlIdent(dateField) : `\`${dateField}\``;
  if (condition.kind === "onOrBefore") {
    const today = todayDateOnly(timezone);
    const d = assertDateOnly(condition.date);
    return { clause: `${col} >= '${today}' AND ${col} <= '${d}'` };
  }
  if (condition.kind === "onOrAfter") {
    const d = assertDateOnly(condition.date);
    return { clause: `${col} >= '${d}'` };
  }
  if (condition.kind === "between") {
    const from = assertDateOnly(condition.fromDate);
    const to = assertDateOnly(condition.toDate);
    return { clause: `${col} >= '${from}' AND ${col} <= '${to}'` };
  }
  if (condition.kind === "newDocuments") {
    const nowIso = new Date().toISOString();
    const existing = trigger.watermarks?.[window.id];
    if (!existing && !dryRun) {
      // Arm the watch: do not dump historical rows on first activation.
      return { clause: "1=0", nextWatermark: nowIso, primed: true };
    }
    const since = existing
      ? new Date(existing)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString().slice(0, 19).replace("T", " ");
    return {
      clause: `${col} > '${sinceIso}'`,
      nextWatermark: nowIso
    };
  }
  if (dialect === "mssql") {
    return {
      clause: `DATEDIFF(day, GETUTCDATE(), ${col}) >= ${condition.minDays} AND DATEDIFF(day, GETUTCDATE(), ${col}) <= ${condition.maxDays}`
    };
  }
  return {
    clause: `DATEDIFF(${col}, UTC_TIMESTAMP()) >= ${condition.minDays} AND DATEDIFF(${col}, UTC_TIMESTAMP()) <= ${condition.maxDays}`
  };
}

async function evaluateMongo(
  db: Db,
  trigger: TriggerDefinition,
  window: TriggerWindow,
  limit: number,
  dryRun: boolean
): Promise<{ rows: Record<string, unknown>[]; nextWatermark?: string }> {
  const collection = assertIdent(trigger.target.collectionOrTable, "collection");
  const dateField = assertMongoField(trigger.target.dateField);
  const extra =
    trigger.target.extraFilter && typeof trigger.target.extraFilter === "object"
      ? trigger.target.extraFilter
      : {};
  const condition = window.condition;

  const pipeline: Record<string, unknown>[] = [
    {
      $match: {
        ...extra,
        [dateField]: { $exists: true, $ne: null }
      }
    }
  ];

  let nextWatermark: string | undefined;

  if (condition.kind === "daysUntil") {
    pipeline.push(
      {
        $addFields: {
          __daysUntil: daysUntilExprMongo(dateField)
        }
      },
      {
        $match: {
          __daysUntil: { $gte: condition.minDays, $lte: condition.maxDays }
        }
      },
      { $limit: limit },
      { $project: { __daysUntil: 0 } }
    );
  } else if (condition.kind === "onOrBefore" || condition.kind === "onOrAfter") {
    const timezone = getRuntimeSettings().timezone;
    if (condition.kind === "onOrBefore") {
      const from = startOfZonedDay(new Date(), timezone);
      const to = endOfDateUtc(condition.date);
      pipeline.push(
        {
          $addFields: {
            __asDate: asDateExprMongo(dateField)
          }
        },
        {
          $match: {
            __asDate: { $ne: null, $gte: from, $lte: to }
          }
        },
        { $limit: limit },
        { $project: { __asDate: 0 } }
      );
    } else {
      const bound = startOfDateUtc(condition.date);
      pipeline.push(
        {
          $addFields: {
            __asDate: asDateExprMongo(dateField)
          }
        },
        {
          $match: {
            __asDate: { $ne: null, $gte: bound }
          }
        },
        { $limit: limit },
        { $project: { __asDate: 0 } }
      );
    }
  } else if (condition.kind === "between") {
    const from = startOfDateUtc(condition.fromDate);
    const to = endOfDateUtc(condition.toDate);
    pipeline.push(
      {
        $addFields: {
          __asDate: asDateExprMongo(dateField)
        }
      },
      {
        $match: {
          __asDate: { $ne: null, $gte: from, $lte: to }
        }
      },
      { $limit: limit },
      { $project: { __asDate: 0 } }
    );
  } else if (condition.kind === "newDocuments") {
    const nowIso = new Date().toISOString();
    nextWatermark = nowIso;
    const existing = trigger.watermarks?.[window.id];
    if (!existing && !dryRun) {
      return { rows: [], nextWatermark };
    }
    const since = existing
      ? new Date(existing)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    pipeline.push(
      {
        $addFields: {
          __asDate: asDateExprMongo(dateField)
        }
      },
      {
        $match: {
          __asDate: { $ne: null, $gt: since }
        }
      },
      { $sort: { [dateField]: 1 } },
      { $limit: limit },
      { $project: { __asDate: 0 } }
    );
  } else {
    const _exhaustive: never = condition;
    throw new AppError(
      400,
      "Unsupported condition",
      `Unsupported trigger condition: ${String((_exhaustive as TriggerWindowCondition).kind)}`,
      [],
      "BAD_CONDITION"
    );
  }

  const cursor = db.collection(collection).aggregate(pipeline);
  const docs = await cursor.toArray();
  return {
    rows: docs.map((d) => {
      const copy = { ...d } as Record<string, unknown>;
      if (copy._id !== undefined) copy._id = String(copy._id);
      return copy;
    }),
    nextWatermark
  };
}
