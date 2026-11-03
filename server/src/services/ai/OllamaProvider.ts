import { QUERY_PLAN_JSON_SCHEMA } from "../../schemas/queryPlan.js";
import { aiUnavailableError } from "../../utils/errors.js";
import type { ModelInfo, ProviderTestResult, QueryPlan, ResultExplanation } from "../../types/index.js";
import type { AIProvider, QueryPlanningInput, ResultExplanationInput } from "./AIProvider.js";
import { explainFromProvider, planFromProvider } from "./jsonComplete.js";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaChatResponse {
  message?: { content?: string; thinking?: string };
  error?: string;
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama" as const;

  constructor(
    private readonly baseUrl: string,
    public readonly model: string
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(this.url("/api/tags"), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw aiUnavailableError("ollama", `HTTP ${res.status}`);
    }
    const data = (await res.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => {
      const id = m.name || m.model || "unknown";
      return { id, name: id, provider: "ollama" as const };
    });
  }

  async testConnection(): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const models = await this.listModels();
      const available = models.some((m) => m.id === this.model || m.id.startsWith(`${this.model}:`));
      const simple = await this.completeSimpleTest();
      return {
        ok: simple.ok,
        provider: "ollama",
        model: this.model,
        latencyMs: Date.now() - started,
        message: available
          ? "Connected. Model available."
          : `Connected, but model '${this.model}' was not found in /api/tags.`,
        details: {
          models: models.map((m) => m.id),
          modelAvailable: available,
          testReply: simple.text
        }
      };
    } catch (error) {
      return {
        ok: false,
        provider: "ollama",
        model: this.model,
        latencyMs: Date.now() - started,
        message:
          "Cannot connect to Ollama.\n\nMake sure Ollama is installed and running.\n\nExpected:\nhttp://localhost:11434",
        details: {
          error: error instanceof Error ? error.message : "unknown",
          expected: this.baseUrl || "http://localhost:11434"
        }
      };
    }
  }

  async completeSimpleTest(): Promise<{ ok: boolean; text: string; latencyMs: number }> {
    const started = Date.now();
    const text = await this.generate(
      "You are a connection test assistant.",
      "Reply with exactly: AI connection successful",
      false
    );
    const ok = text.toLowerCase().includes("ai connection successful");
    return { ok, text: text.slice(0, 400), latencyMs: Date.now() - started };
  }

  async generateQueryPlan(input: QueryPlanningInput): Promise<QueryPlan> {
    return planFromProvider(
      (system, user, jsonMode) => this.generate(system, user, jsonMode, QUERY_PLAN_JSON_SCHEMA),
      input
    );
  }

  async explainResult(input: ResultExplanationInput): Promise<ResultExplanation> {
    return explainFromProvider(this.generateBound, input);
  }

  async generateText(system: string, user: string, jsonMode = false): Promise<string> {
    return this.generate(system, user, jsonMode);
  }

  private generateBound = (system: string, user: string, jsonMode: boolean): Promise<string> =>
    this.generate(system, user, jsonMode);

  private async generate(
    system: string,
    user: string,
    jsonMode: boolean,
    jsonSchema?: Record<string, unknown>
  ): Promise<string> {
    let res: Response;
    try {
      res = await fetch(this.url("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(240000),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format: jsonMode ? (jsonSchema ?? "json") : undefined,
          options: { temperature: 0 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      if (message.toLowerCase().includes("abort") || message.toLowerCase().includes("timeout")) {
        throw aiUnavailableError(
          "ollama",
          `The model took too long to respond. Try a smaller/faster model. Current model: ${this.model}`
        );
      }
      throw aiUnavailableError("ollama", message);
    }
    if (!res.ok) {
      const body = await res.text();
      throw aiUnavailableError("ollama", `HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) {
      throw aiUnavailableError("ollama", data.error);
    }
    const content = data.message?.content?.trim() || data.message?.thinking?.trim() || "";
    return content;
  }
}
