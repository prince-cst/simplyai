import type {
  QueryPlan,
  ResultExplanation
} from "../../types/index.js";
import type { AIProvider, QueryPlanningInput, ResultExplanationInput } from "./AIProvider.js";

/**
 * Deterministic provider used by automated tests. Never used by the UI factory.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "ollama" as const;
  readonly model = "mock";

  constructor(private readonly planFactory?: (input: QueryPlanningInput) => QueryPlan) {}

  async testConnection() {
    return {
      ok: true,
      provider: this.name,
      model: this.model,
      latencyMs: 1,
      message: "Mock provider"
    };
  }

  async listModels() {
    return [{ id: "mock", name: "mock", provider: this.name }];
  }

  async completeSimpleTest() {
    return { ok: true, text: "AI connection successful", latencyMs: 1 };
  }

  async generateQueryPlan(input: QueryPlanningInput): Promise<QueryPlan> {
    if (this.planFactory) return this.planFactory(input);
    const collections = input.schema.collections;
    const first = collections[0];
    if (!first) {
      return {
        status: "insufficient_data",
        operation: "find",
        collection: "",
        explanation: "No collections",
        collectionsUsed: [],
        fieldsUsed: [],
        assumptions: [],
        confidence: 0
      };
    }
    return {
      status: "ready",
      operation: "count",
      collection: first.name,
      explanation: "Count documents in the first collection",
      collectionsUsed: [first.name],
      fieldsUsed: ["_id"],
      assumptions: ["Mock plan"],
      confidence: 1,
      visualization: { type: "metric" }
    };
  }

  async explainResult(input: ResultExplanationInput): Promise<ResultExplanation> {
    return {
      answer: `Result contains ${Array.isArray(input.result) ? input.result.length : 1} item(s).`,
      summary: "Mock explanation based only on the provided result.",
      fieldsUsed: input.plan.fieldsUsed,
      collectionsUsed: input.plan.collectionsUsed,
      assumptions: ["Mock explainer"],
      warnings: [],
      insufficientData: false
    };
  }

  async generateText(_system: string, _user: string, _jsonMode = false): Promise<string> {
    return JSON.stringify({
      name: "Mock expiry alert",
      explanation: "Mock trigger proposal for tests",
      target: {
        engine: "mongodb",
        collectionOrTable: "documents",
        dateField: "expiresAt"
      },
      windows: [
        {
          label: "90-60 days monthly",
          condition: { kind: "daysUntil", minDays: 60, maxDays: 90 },
          schedule: { cron: "0 9 1 * *" },
          dedupeBucket: "month"
        }
      ],
      email: {
        subjectTemplate: "Alert: {{name}} ({{matchCount}})",
        bodyTemplate: "{{rows}}"
      }
    });
  }
}
