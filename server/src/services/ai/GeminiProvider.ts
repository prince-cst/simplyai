import { GoogleGenAI } from "@google/genai";
import { getRuntimeSettings, updateRuntimeSettings } from "../../config/runtimeSettings.js";
import { aiQuotaError, aiUnavailableError } from "../../utils/errors.js";
import { describeAiError, geminiUserHints } from "../../utils/aiErrors.js";
import { logger } from "../../utils/logger.js";
import type { ModelInfo, ProviderTestResult, QueryPlan, ResultExplanation } from "../../types/index.js";
import type { AIProvider, QueryPlanningInput, ResultExplanationInput } from "./AIProvider.js";
import {
  coerceFreeTierGeminiModel,
  extractGeminiModelFromError,
  geminiFreeTierModelInfos,
  geminiRetryOrder,
  isGeminiQuotaError,
  isGeminiRetryableError,
  isLowDailyQuotaGeminiModel,
  suggestedGeminiModelAfterQuota
} from "./geminiFreeTier.js";
import { explainFromProvider, planFromProvider } from "./jsonComplete.js";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  quotaRotatedFrom?: string;
  private readonly client: GoogleGenAI;
  private activeModel: string;

  constructor(
    apiKey: string,
    model: string
  ) {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw aiUnavailableError("gemini", "API key is missing");
    }
    this.activeModel = coerceFreeTierGeminiModel(model);
    this.client = new GoogleGenAI({
      apiKey: trimmed,
      vertexai: false
    });
  }

  get model(): string {
    return this.activeModel;
  }

  async listModels(): Promise<ModelInfo[]> {
    return geminiFreeTierModelInfos();
  }

  async testConnection(): Promise<ProviderTestResult> {
    const started = Date.now();
    const requested = this.activeModel;
    try {
      const simple = await this.completeSimpleTest();
      const switched = this.quotaRotatedFrom
        ? ` Free-tier quota hit on ${this.quotaRotatedFrom}; continued with ${this.activeModel}.`
        : "";
      return {
        ok: simple.ok,
        provider: "gemini",
        model: this.activeModel,
        latencyMs: Date.now() - started,
        message: simple.ok
          ? `API key valid. Using free-tier model ${this.activeModel}.${switched}`
          : "Gemini responded but the test phrase was missing.",
        details: {
          testReply: simple.text,
          requestedModel: requested,
          model: this.activeModel,
          rotatedFrom: this.quotaRotatedFrom
        }
      };
    } catch (error) {
      const detail = describeAiError(error);
      logger.warn({ provider: "gemini", model: this.activeModel, errorType: "GEMINI_TEST" }, detail);
      return {
        ok: false,
        provider: "gemini",
        model: this.activeModel,
        latencyMs: Date.now() - started,
        message: detail,
        details: {
          error: detail,
          hints: geminiUserHints(detail)
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
    const order = geminiRetryOrder(this.activeModel);
    let lastDetail = "";
    for (const model of order) {
      try {
        const response = await this.client.models.generateContent({
          model,
          contents: `${system}\n\n${user}`,
          config: {
            temperature: 0,
            ...(jsonMode ? { responseMimeType: "application/json" as const } : {})
          }
        });
        if (model !== this.activeModel) {
          this.rememberRotation(this.activeModel, model);
        }
        return response.text ?? "";
      } catch (error) {
        lastDetail = describeAiError(error);
        if (isGeminiRetryableError(lastDetail)) {
          logger.warn(
            { provider: "gemini", model, errorType: "GEMINI_QUOTA_ROTATE" },
            lastDetail
          );
          if (isLowDailyQuotaGeminiModel(model) && isGeminiQuotaError(lastDetail)) {
            throw aiQuotaError({
              detail: lastDetail,
              failedModel: model,
              suggestedModel: suggestedGeminiModelAfterQuota(model)
            });
          }
          continue;
        }
        throw aiUnavailableError("gemini", lastDetail);
      }
    }
    const failedModel = extractGeminiModelFromError(lastDetail) || this.activeModel;
    if (isGeminiRetryableError(lastDetail)) {
      throw aiQuotaError({
        detail: lastDetail,
        failedModel,
        suggestedModel: suggestedGeminiModelAfterQuota(failedModel)
      });
    }
    throw aiUnavailableError(
      "gemini",
      lastDetail || "All free-tier Gemini models are exhausted. Change the model in Chat and retry."
    );
  }

  private rememberRotation(from: string, to: string): void {
    this.quotaRotatedFrom = this.quotaRotatedFrom ?? from;
    this.activeModel = to;
    try {
      if (getRuntimeSettings().gemini.model !== to) {
        updateRuntimeSettings({ gemini: { model: to } });
      }
    } catch {
      /* settings persist is best-effort */
    }
    logger.info({ from, to, operation: "gemini-model-rotate" }, "Continued on another free-tier Gemini model");
  }
}
