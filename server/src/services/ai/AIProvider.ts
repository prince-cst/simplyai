import type {
  AIProviderName,
  ModelInfo,
  ProviderTestResult,
  QueryPlan,
  ResultExplanation
} from "../../types/index.js";
import type { CompactSchema } from "../../types/index.js";
import type { CompactChatTurn } from "../../types/index.js";

export interface QueryPlanningInput {
  question: string;
  schema: CompactSchema;
  dateContext: Record<string, unknown>;
  conversation: CompactChatTurn[];
  engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
}

export interface ResultExplanationInput {
  question: string;
  plan: QueryPlan;
  result: unknown;
  truncated: boolean;
  previousAnswer?: string;
  engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
}

export interface AIProvider {
  readonly name: AIProviderName;
  readonly model: string;
  quotaRotatedFrom?: string;
  testConnection(): Promise<ProviderTestResult>;
  listModels(): Promise<ModelInfo[]>;
  generateQueryPlan(input: QueryPlanningInput): Promise<QueryPlan>;
  explainResult(input: ResultExplanationInput): Promise<ResultExplanation>;
  completeSimpleTest(): Promise<{ ok: boolean; text: string; latencyMs: number }>;
  /** Generic LLM completion used by non-query features (e.g. trigger proposals). */
  generateText(system: string, user: string, jsonMode?: boolean): Promise<string>;
}
