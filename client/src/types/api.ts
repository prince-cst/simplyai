export type AIProviderName = "ollama" | "gemini" | "groq";

export interface SavedConnection {
  id: string;
  name: string;
  maskedUri: string;
  databaseName?: string;
  server?: string;
  engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  connected: boolean;
  lastUsedAt?: string;
  lastError?: string;
  needsDatabaseSelection?: boolean;
}

export interface ConnectionStatus {
  connected: boolean;
  database?: string;
  server?: string;
  engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  collectionCount?: number;
  maskedUri?: string;
  needsDatabaseSelection?: boolean;
  databases?: string[];
  demoMode: boolean;
  schemaSummary?: DatabaseSummary;
  introspectedAt?: string;
  activeConnectionId?: string;
  connectionName?: string;
  connections?: SavedConnection[];
  lastError?: string;
}

export interface DatabaseSummary {
  collectionCount: number;
  estimatedDocuments: number;
  relationshipCount: number;
  dateFieldCount: number;
  numericFieldCount: number;
}

export interface FieldSchema {
  path: string;
  type: string;
  typesSeen: string[];
  arrayItemType?: string;
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

export interface DatabaseSchema {
  database: string;
  collections: CollectionSchema[];
  relationships: Relationship[];
  introspectedAt: string;
  summary: DatabaseSummary;
}

export interface CompactSchema {
  database: string;
  collections: Array<{
    name: string;
    estimatedCount: number;
    fields: Record<string, string>;
  }>;
  relationships: Relationship[];
}

export interface QueryPlan {
  status: "ready" | "needs_clarification" | "insufficient_data";
  operation: string;
  collection: string;
  filter?: Record<string, unknown>;
  pipeline?: Record<string, unknown>[];
  projection?: Record<string, unknown>;
  sort?: Record<string, number>;
  limit?: number;
  distinctField?: string;
  sql?: string;
  dateIntents?: Array<{ field: string; range: string }>;
  explanation: string;
  collectionsUsed: string[];
  fieldsUsed: string[];
  assumptions: string[];
  clarificationQuestions?: string[];
  possibleInterpretations?: string[];
  confidence: number;
  visualization?: {
    type: "bar" | "line" | "pie" | "table" | "metric" | "none";
    xField?: string;
    yField?: string;
    title?: string;
  };
}

export interface QueryExecutionResult {
  success: boolean;
  operation: string;
  collection: string;
  documents: unknown[];
  resultCount: number;
  truncated: boolean;
  executionTimeMs: number;
  warnings: string[];
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
  visualization?: QueryPlan["visualization"];
}

export interface ChatResponse {
  status: "answered" | "needs_clarification" | "insufficient_data" | "pending_approval" | "cancelled" | "error";
  question: string;
  answer?: string;
  explanation?: ResultExplanation;
  result?: QueryExecutionResult;
  queryPlan?: QueryPlan;
  validation?: { ok: boolean; reasons: string[] };
  pendingId?: string;
  provider: AIProviderName;
  model: string;
  usedFallback: boolean;
  canFallback: boolean;
  rotatedFromModel?: string;
  retryable?: boolean;
  failedModel?: string;
  suggestedModel?: string;
  errorCode?: string;
  developer?: Record<string, unknown>;
}

export interface PublicSettings {
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

export interface CompactChatTurn {
  role: "user" | "assistant";
  question?: string;
  answer?: string;
  collectionsUsed?: string[];
  fieldsUsed?: string[];
  lastCollection?: string;
  historyId?: string;
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
  status?: string;
}

export interface SessionHistoryResponse {
  history: QueryHistoryItem[];
  chat: CompactChatTurn[];
  threads?: ChatThreadSummary[];
  activeThreadId?: string | null;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

export type TriggerStatus = "draft" | "active" | "paused";
export type TriggerEngine = "mongodb" | "mysql" | "mssql";
export type TriggerDedupeBucket = "minute" | "hour" | "day" | "week" | "month";

export type TriggerWindowCondition =
  | { kind: "daysUntil"; minDays: number; maxDays: number }
  | { kind: "onOrBefore"; date: string }
  | { kind: "onOrAfter"; date: string }
  | { kind: "between"; fromDate: string; toDate: string }
  | { kind: "newDocuments" };

export interface TriggerWindow {
  id: string;
  label: string;
  condition: TriggerWindowCondition;
  schedule: { cron: string; timezone?: string };
  dedupeBucket?: TriggerDedupeBucket;
}

export interface TriggerDefinition {
  id: string;
  name: string;
  connectionId: string;
  /** Present on list/get responses — which saved DB this trigger runs against. */
  connectionName?: string;
  databaseName?: string;
  connectionEngine?: TriggerEngine | "quickbooks" | "outlook";
  connectionMissing?: boolean;
  status: TriggerStatus;
  userPrompt: string;
  explanation: string;
  target: {
    engine: TriggerEngine;
    collectionOrTable: string;
    dateField: string;
    extraFilter?: Record<string, unknown> | string;
  };
  windows: TriggerWindow[];
  email: {
    to: string[];
    subjectTemplate: string;
    bodyTemplate: string;
    displayFields?: string[];
  };
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
  recentRuns: Array<{
    id: string;
    at: string;
    windowId: string;
    matchCount: number;
    emailed: boolean;
    dryRun?: boolean;
    error?: string;
    sampleIds?: string[];
  }>;
}

export interface TriggerProposal {
  name: string;
  explanation: string;
  connectionId: string;
  userPrompt: string;
  target: TriggerDefinition["target"];
  windows: TriggerWindow[];
  email: TriggerDefinition["email"];
}

export interface TestResult {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public hints: string[] = [],
    public requestId?: string,
    public code?: string,
    public retryable = false,
    public failedModel?: string,
    public suggestedModel?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
