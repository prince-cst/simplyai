export type AIProviderName = "ollama" | "gemini" | "groq";

export type FieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "ObjectId"
  | "array"
  | "object"
  | "null"
  | "mixed"
  | "unknown"
  | "decimal"
  | "binary";

export interface FieldSchema {
  path: string;
  type: FieldType;
  typesSeen: FieldType[];
  arrayItemType?: FieldType;
  nestedFields?: FieldSchema[];
  enumSamples: string[];
  isPossibleId: boolean;
  isPossibleDate: boolean;
  isNumeric: boolean;
}

export interface CollectionSchema {
  name: string;
  estimatedCount: number;
  sampleSize: number;
  fields: FieldSchema[];
  sampleDocuments: Record<string, unknown>[];
}

export interface Relationship {
  fromCollection: string;
  fromField: string;
  toCollection: string;
  toField: string;
  confidence: number;
  reason: string;
}

export interface DatabaseSummary {
  collectionCount: number;
  estimatedDocuments: number;
  relationshipCount: number;
  dateFieldCount: number;
  numericFieldCount: number;
}

export interface DatabaseSchema {
  database: string;
  collections: CollectionSchema[];
  relationships: Relationship[];
  introspectedAt: string;
  summary: DatabaseSummary;
}

export interface CompactCollectionSchema {
  name: string;
  estimatedCount: number;
  fields: Record<string, FieldType>;
  dateFields: string[];
  /** Date-like fields stored as strings (typically YYYY-MM-DD). */
  stringDateFields?: string[];
  numericFields: string[];
  possibleIdFields: string[];
}

export interface CompactSchema {
  database: string;
  collections: CompactCollectionSchema[];
  relationships: Relationship[];
  note: string;
}

export type DatabaseEngine = "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
export type QueryOperation = "find" | "aggregate" | "count" | "distinct" | "sql" | "qbo" | "outlook";
export type QueryPlanStatus = "ready" | "needs_clarification" | "insufficient_data";

export type DateRangeKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "january"
  | "february"
  | "march"
  | "april"
  | "may"
  | "june"
  | "july"
  | "august"
  | "september"
  | "october"
  | "november"
  | "december"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days";

export interface DateIntent {
  field: string;
  range: DateRangeKey;
  collection?: string;
}

export interface VisualizationHint {
  type: "bar" | "line" | "pie" | "table" | "metric" | "none";
  xField?: string;
  yField?: string;
  title?: string;
}

export interface QueryPlan {
  status: QueryPlanStatus;
  operation: QueryOperation;
  collection: string;
  filter?: Record<string, unknown>;
  pipeline?: Record<string, unknown>[];
  projection?: Record<string, unknown>;
  sort?: Record<string, number>;
  limit?: number;
  skip?: number;
  distinctField?: string;
  sql?: string;
  /** QuickBooks Online API plan (when operation is "qbo"). */
  qbo?: {
    action: "report" | "query" | "read";
    reportName?: string;
    entity?: string;
    params?: Record<string, string>;
    query?: string;
  };
  /** Outlook / Microsoft Graph mail plan (when operation is "outlook"). */
  outlook?: {
    folder?: "inbox" | "sentitems";
    range?: "today" | "yesterday" | "last_7_days" | "last_30_days" | "all";
    unreadOnly?: boolean;
    includeBody?: boolean;
    search?: string;
  };
  dateIntents?: DateIntent[];
  explanation: string;
  collectionsUsed: string[];
  fieldsUsed: string[];
  assumptions: string[];
  clarificationQuestions?: string[];
  possibleInterpretations?: string[];
  confidence: number;
  visualization?: VisualizationHint;
}

export interface QueryExecutionResult {
  success: boolean;
  operation: QueryOperation;
  collection: string;
  documents: unknown[];
  resultCount: number;
  truncated: boolean;
  executionTimeMs: number;
  warnings: string[];
  /** Plan actually executed (dateIntents already injected into filter/pipeline). */
  executedPlan?: QueryPlan;
}

export interface ResultExplanation {
  answer: string;
  summary: string;
  calculation?: string;
  fieldsUsed: string[];
  collectionsUsed: string[];
  assumptions: string[];
  warnings: string[];
  insufficientData: boolean;
  visualization?: VisualizationHint;
}

export interface ProviderTestResult {
  ok: boolean;
  provider: AIProviderName;
  model?: string;
  latencyMs: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: AIProviderName;
}

export interface SavedConnectionPublic {
  id: string;
  name: string;
  maskedUri: string;
  databaseName?: string;
  server?: string;
  engine?: DatabaseEngine;
  connected: boolean;
  lastUsedAt?: string;
  lastError?: string;
  needsDatabaseSelection?: boolean;
}

export interface ConnectionStatus {
  connected: boolean;
  database?: string;
  server?: string;
  engine?: DatabaseEngine;
  collectionCount?: number;
  maskedUri?: string;
  needsDatabaseSelection?: boolean;
  databases?: string[];
  demoMode: boolean;
  lastError?: string;
  activeConnectionId?: string;
  connectionName?: string;
  connections?: SavedConnectionPublic[];
}

export interface CompactChatTurn {
  role: "user" | "assistant";
  question?: string;
  answer?: string;
  collectionsUsed?: string[];
  fieldsUsed?: string[];
  lastCollection?: string;
  historyId?: string;
  focus?: string;
  sql?: string;
  dateIntents?: DateIntent[];
}

export interface QueryHistoryItem {
  id: string;
  question: string;
  answer?: string;
  timestamp: string;
  provider: AIProviderName;
  model: string;
  collectionsUsed: string[];
  fieldsUsed: string[];
  executionTimeMs: number;
  success: boolean;
  status?: QueryPlanStatus;
  focus?: string;
}

/** Saved chat conversation for Recents sidebar (ChatGPT-style). */
export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  chatTurns: CompactChatTurn[];
}

export interface PendingQuery {
  id: string;
  question: string;
  plan: QueryPlan;
  createdAt: string;
}

export interface OllamaSettings {
  baseUrl: string;
  model: string;
}

export interface GeminiSettings {
  apiKey: string;
  model: string;
}

export interface GroqSettings {
  apiKey: string;
  model: string;
}

export interface RuntimeSettings {
  provider: AIProviderName;
  fallbackProvider?: AIProviderName;
  ollama: OllamaSettings;
  gemini: GeminiSettings;
  groq: GroqSettings;
  requireQueryApproval: boolean;
  developerMode: boolean;
  sampleDocumentsPerCollection: number;
  maxResultDocuments: number;
  maxSampleDocuments: number;
  maxPipelineStages: number;
  queryTimeoutMs: number;
  timezone: string;
}

export interface PublicRuntimeSettings {
  provider: AIProviderName;
  fallbackProvider?: AIProviderName;
  ollama: { baseUrl: string; model: string };
  gemini: { hasApiKey: boolean; model: string };
  groq: { hasApiKey: boolean; model: string };
  requireQueryApproval: boolean;
  developerMode: boolean;
  sampleDocumentsPerCollection: number;
  maxResultDocuments: number;
  maxSampleDocuments: number;
  maxPipelineStages: number;
  queryTimeoutMs: number;
  timezone: string;
  readOnly: true;
}

export type TriggerStatus = "draft" | "active" | "paused";
export type TriggerEngine = "mongodb" | "mysql" | "mssql";
export type TriggerDedupeBucket = "minute" | "hour" | "day" | "week" | "month";

export type TriggerWindowCondition =
  | {
      kind: "daysUntil";
      minDays: number;
      maxDays: number;
    }
  | {
      kind: "onOrBefore";
      /** Inclusive calendar cutoff YYYY-MM-DD. Evaluation is from today through this date (upcoming only). */
      date: string;
    }
  | {
      kind: "onOrAfter";
      date: string;
    }
  | {
      kind: "between";
      /** Inclusive start YYYY-MM-DD (use today's date for "still active / will expire"). */
      fromDate: string;
      /** Inclusive end YYYY-MM-DD. */
      toDate: string;
    }
  | {
      /**
       * Rows whose dateField is newer than the last successful check (insert/update watch).
       * Uses target.dateField as the timestamp (createdAt / updatedAt / created_at).
       */
      kind: "newDocuments";
    };

export interface TriggerWindow {
  id: string;
  label: string;
  condition: TriggerWindowCondition;
  schedule: { cron: string; timezone?: string };
  dedupeBucket?: TriggerDedupeBucket;
}

export interface TriggerTarget {
  engine: TriggerEngine;
  collectionOrTable: string;
  dateField: string;
  /** Mongo filter object or SQL AND fragment (no leading AND). */
  extraFilter?: Record<string, unknown> | string;
}

export interface TriggerEmailConfig {
  to: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  /**
   * Optional fields to highlight in {{rows}} (e.g. shopName, deviceName, totalAmount).
   * User-facing aliases like "shop" / "amount" are accepted.
   */
  displayFields?: string[];
}

export interface TriggerRunLog {
  id: string;
  at: string;
  windowId: string;
  matchCount: number;
  emailed: boolean;
  dryRun?: boolean;
  error?: string;
  sampleIds?: string[];
}

export interface TriggerDefinition {
  id: string;
  name: string;
  connectionId: string;
  status: TriggerStatus;
  userPrompt: string;
  explanation: string;
  target: TriggerTarget;
  windows: TriggerWindow[];
  email: TriggerEmailConfig;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
  recentRuns: TriggerRunLog[];
  /** Fingerprints already notified: `${rowId}:${windowId}:${bucket}` */
  notifiedKeys: string[];
  /**
   * Per-window ISO watermarks for kind "newDocuments".
   * First successful run arms the watch (no email of historical rows).
   */
  watermarks?: Record<string, string>;
}
