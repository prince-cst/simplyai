import Groq from "groq-sdk";
import { aiUnavailableError } from "../../utils/errors.js";
import type { ModelInfo, ProviderTestResult, QueryPlan, ResultExplanation } from "../../types/index.js";
import type { AIProvider, QueryPlanningInput, ResultExplanationInput } from "./AIProvider.js";
import { explainFromProvider, planFromProvider } from "./jsonComplete.js";

const FALLBACK_GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3-32b",
  "moonshotai/kimi-k2-instruct-0905"
];

export class GroqProvider implements AIProvider {
  readonly name = "groq" as const;
  private readonly client: Groq;

  constructor(
    private readonly apiKey: string,
    public readonly model: string
  ) {
    if (!apiKey) {
      throw aiUnavailableError("groq", "API key is missing");
    }
    this.client = new Groq({ apiKey });
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const listed = await this.client.models.list();
      return listed.data.map((m) => ({
        id: m.id,
        name: m.id,
        provider: "groq" as const
      }));
    } catch {
      return FALLBACK_GROQ_MODELS.map((id) => ({ id, name: id, provider: "groq" as const }));
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const simple = await this.completeSimpleTest();
      return {
        ok: simple.ok,
        provider: "groq",
        model: this.model,
        latencyMs: Date.now() - started,
        message: simple.ok ? "API key valid. Model available." : "Groq responded but the test phrase was missing.",
        details: { testReply: simple.text }
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      return {
        ok: false,
        provider: "groq",
        model: this.model,
        latencyMs: Date.now() - started,
        message: detail,
        details: { error: detail }
      };
    }
  }

  async completeSimpleTest(): Promise<{ ok: boolean; text: string; latencyMs: number }> {
    const started = Date.now();
    const text = await this.generate(
      "You are a connection test assistant. Always reply in JSON when asked.",
      'Reply with JSON: {"text":"AI connection successful"}',
      true
    );
    return {
      ok: text.toLowerCase().includes("ai connection successful"),
      text: text.slice(0, 400),
      latencyMs: Date.now() - started
    };
  }

  async generateQueryPlan(input: QueryPlanningInput): Promise<QueryPlan> {
    return planFromProvider(this.generateBound, input);
  }

  async explainResult(input: ResultExplanationInput): Promise<ResultExplanation> {
    return explainFromProvider(this.generateBound, input);
  }

  async generateText(system: string, user: string, jsonMode = false): Promise<string> {
    return this.generate(system, user, jsonMode);
  }

  private generateBound = (system: string, user: string, jsonMode: boolean): Promise<string> =>
    this.generate(system, user, jsonMode);

  private async generate(system: string, user: string, jsonMode: boolean): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: jsonMode ? { type: "json_object" } : undefined,
        messages: [
          {
            role: "system",
            content: jsonMode ? `${system}\nAlways respond with valid JSON.` : system
          },
          { role: "user", content: user }
        ]
      });
      return completion.choices[0]?.message?.content ?? "";
    } catch (error) {
      throw aiUnavailableError("groq", error instanceof Error ? error.message : "Groq request failed");
    }
  }
}
