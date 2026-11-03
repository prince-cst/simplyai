import { z } from "zod";

export const DateRangeKeySchema = z.enum([
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "q1",
  "q2",
  "q3",
  "q4",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "last_7_days",
  "last_30_days",
  "last_90_days"
]);

export const DateIntentSchema = z.object({
  field: z.string().min(1),
  range: DateRangeKeySchema,
  collection: z.string().optional()
});

export const VisualizationHintSchema = z.object({
  type: z.enum(["bar", "line", "pie", "table", "metric", "none"]),
  xField: z.string().optional(),
  yField: z.string().optional(),
  title: z.string().optional()
});

const mongoDocument = z.record(z.string(), z.unknown());

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeQueryPlanInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  let plan = value;
  for (const key of ["plan", "queryPlan", "query_plan", "query", "result", "data"]) {
    const inner = plan[key];
    if (
      isRecord(inner) &&
      ("operation" in inner || "collection" in inner || "pipeline" in inner || "status" in inner)
    ) {
      plan = inner;
      break;
    }
  }
  const next: Record<string, unknown> = { ...plan };
  const statusRaw = String(next.status ?? "").toLowerCase().trim();
  if (!statusRaw) {
    next.status = next.collection || next.operation ? "ready" : "insufficient_data";
  } else if (["ok", "success", "complete", "completed"].includes(statusRaw)) {
    next.status = "ready";
  } else if (["clarify", "clarification", "need_clarification", "ambiguous"].includes(statusRaw)) {
    next.status = "needs_clarification";
  } else if (["unknown", "cannot", "impossible", "no_data", "error"].includes(statusRaw)) {
    next.status = "insufficient_data";
  }

  if (typeof next.operation === "string") {
    next.operation = next.operation.toLowerCase();
    if (next.operation === "select") next.operation = "sql";
  }
  if (typeof next.confidence === "string") next.confidence = Number(next.confidence);
  if (typeof next.confidence === "number" && Number.isFinite(next.confidence) && next.confidence > 1) {
    next.confidence = Math.min(1, next.confidence / 100);
  }
  if (typeof next.limit === "string") next.limit = Number(next.limit);
  if (typeof next.limit === "number" && next.limit > 100) next.limit = 100;
  if (!Array.isArray(next.collectionsUsed)) {
    next.collectionsUsed = typeof next.collection === "string" && next.collection ? [next.collection] : [];
  }
  if (!Array.isArray(next.fieldsUsed)) next.fieldsUsed = [];
  if (!Array.isArray(next.assumptions)) next.assumptions = [];
  if (typeof next.explanation !== "string") next.explanation = "";
  if (typeof next.pipeline === "string") {
    try {
      next.pipeline = JSON.parse(next.pipeline);
    } catch {
      delete next.pipeline;
    }
  }
  if (typeof next.sql === "string" && next.sql.trim()) {
    next.operation = "sql";
  }
  if (isRecord(next.qbo) || String(next.operation ?? "").toLowerCase() === "qbo") {
    next.operation = "qbo";
  }
  if (isRecord(next.outlook) || String(next.operation ?? "").toLowerCase() === "outlook") {
    next.operation = "outlook";
  }
  if (isRecord(next.visualization)) {
    const t = String(next.visualization.type ?? "none")
      .toLowerCase()
      .replace(/[_\s-]/g, "");
    const map: Record<string, string> = {
      bar: "bar",
      barchart: "bar",
      column: "bar",
      line: "line",
      linechart: "line",
      pie: "pie",
      piechart: "pie",
      table: "table",
      tabular: "table",
      metric: "metric",
      number: "metric",
      kpi: "metric",
      none: "none",
      chart: "bar"
    };
    next.visualization = { ...next.visualization, type: map[t] ?? "none" };
  }
  return next;
}

export const QueryPlanSchema = z.preprocess(
  normalizeQueryPlanInput,
  z.object({
    status: z.enum(["ready", "needs_clarification", "insufficient_data"]).default("ready"),
    operation: z.enum(["find", "aggregate", "count", "distinct", "sql", "qbo", "outlook"]).default("find"),
    collection: z.string().default(""),
    filter: mongoDocument.optional(),
    pipeline: z.array(mongoDocument).optional(),
    projection: mongoDocument.optional(),
    sort: z.record(z.string(), z.number()).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    skip: z.number().int().min(0).max(10000).optional(),
    distinctField: z.string().optional(),
    sql: z.string().optional(),
    qbo: z
      .object({
        action: z.enum(["report", "query", "read"]),
        reportName: z.string().optional(),
        entity: z.string().optional(),
        params: z.record(z.string(), z.string()).optional(),
        query: z.string().optional()
      })
      .optional(),
    outlook: z
      .object({
        folder: z.enum(["inbox", "sentitems"]).optional(),
        range: z.enum(["today", "yesterday", "last_7_days", "last_30_days", "all"]).optional(),
        unreadOnly: z.boolean().optional(),
        includeBody: z.boolean().optional(),
        search: z.string().optional()
      })
      .optional(),
    dateIntents: z.array(DateIntentSchema).optional(),
    explanation: z.string().default(""),
    collectionsUsed: z.array(z.string()).default([]),
    fieldsUsed: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    clarificationQuestions: z.array(z.string()).optional(),
    possibleInterpretations: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).default(0),
    visualization: VisualizationHintSchema.optional()
  })
);

export const QUERY_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    status: { type: "string", enum: ["ready", "needs_clarification", "insufficient_data"] },
    operation: { type: "string", enum: ["find", "aggregate", "count", "distinct", "sql", "qbo", "outlook"] },
    collection: { type: "string" },
    sql: { type: "string" },
    qbo: { type: "object" },
    outlook: { type: "object" },
    filter: { type: "object" },
    pipeline: { type: "array", items: { type: "object" } },
    projection: { type: "object" },
    sort: { type: "object" },
    limit: { type: "integer" },
    distinctField: { type: "string" },
    dateIntents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          range: { type: "string" },
          collection: { type: "string" }
        },
        required: ["field", "range"]
      }
    },
    explanation: { type: "string" },
    collectionsUsed: { type: "array", items: { type: "string" } },
    fieldsUsed: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    possibleInterpretations: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    visualization: {
      type: "object",
      properties: {
        type: { type: "string" },
        xField: { type: "string" },
        yField: { type: "string" },
        title: { type: "string" }
      }
    }
  },
  required: ["status", "operation", "collection"]
} as Record<string, unknown>;

export const ResultExplanationSchema = z.object({
  answer: z.string().default(""),
  summary: z.string().default(""),
  calculation: z.string().optional(),
  fieldsUsed: z.array(z.string()).default([]),
  collectionsUsed: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  insufficientData: z.boolean().default(false),
  visualization: VisualizationHintSchema.optional()
});

export type QueryPlanParsed = z.infer<typeof QueryPlanSchema>;
export type ResultExplanationParsed = z.infer<typeof ResultExplanationSchema>;

export const ConnectBodySchema = z
  .object({
    engine: z.enum(["mongodb", "mysql", "mssql"]).optional(),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    databaseName: z.string().min(1).optional(),
    name: z.string().min(1).max(80).optional()
  })
  .superRefine((value, ctx) => {
    const uri = value.connectionString?.trim() ?? "";
    const mssql =
      value.engine === "mssql" ||
      /^mssql:\/\//i.test(uri) ||
      /^sqlserver:\/\//i.test(uri) ||
      /^jdbc:sqlserver:\/\//i.test(uri) ||
      /\bdata\s*source\s*=/i.test(uri) ||
      /database\.windows\.net/i.test(uri);
    const mysql =
      value.engine === "mysql" ||
      /^mysql:\/\//i.test(uri) ||
      /^jdbc:mysql:\/\//i.test(uri);
    if (mssql) {
      if (!uri && !value.host?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SQL Server connection string or host is required",
          path: ["connectionString"]
        });
      }
      return;
    }
    if (mysql) {
      if (!uri && !value.host?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MySQL host or URI is required", path: ["host"] });
      }
      return;
    }
    if (uri.length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MongoDB connection string is required",
        path: ["connectionString"]
      });
    }
  });

export const SelectDatabaseBodySchema = z.object({
  databaseName: z.string().min(1)
});

export const ActivateConnectionBodySchema = z.object({
  connectionId: z.string().min(1)
});

export const DisconnectBodySchema = z.object({
  connectionId: z.string().min(1).optional(),
  forget: z.boolean().optional()
});

export const AddDatabaseBodySchema = z.object({
  databaseName: z.string().min(1),
  name: z.string().min(1).max(80).optional()
});

export const ChatBodySchema = z.object({
  message: z.string().min(1).max(8000),
  useFallback: z.boolean().optional(),
  executePendingId: z.string().optional(),
  cancelPendingId: z.string().optional()
});

export const ValidateQueryBodySchema = z.object({
  plan: QueryPlanSchema
});

export const ExecuteQueryBodySchema = z.object({
  plan: QueryPlanSchema
});

export const SampleBodySchema = z.object({
  collection: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional()
});

export const AiTestBodySchema = z.object({
  provider: z.enum(["ollama", "gemini", "groq"]).optional()
});

export const SettingsUpdateSchema = z.object({
  provider: z.enum(["ollama", "gemini", "groq"]).optional(),
  fallbackProvider: z.enum(["ollama", "gemini", "groq"]).nullable().optional(),
  ollama: z
    .object({
      baseUrl: z.string().url().optional(),
      model: z.string().min(1).optional()
    })
    .optional(),
  gemini: z
    .object({
      apiKey: z.string().optional(),
      model: z.string().min(1).optional()
    })
    .optional(),
  groq: z
    .object({
      apiKey: z.string().optional(),
      model: z.string().min(1).optional()
    })
    .optional(),
  requireQueryApproval: z.boolean().optional(),
  developerMode: z.boolean().optional(),
  sampleDocumentsPerCollection: z.number().int().min(1).max(50).optional(),
  maxResultDocuments: z.number().int().min(1).max(500).optional(),
  maxSampleDocuments: z.number().int().min(1).max(50).optional(),
  maxPipelineStages: z.number().int().min(1).max(50).optional(),
  queryTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  timezone: z.string().min(1).optional()
});
