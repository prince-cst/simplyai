import { describe, expect, it } from "vitest";
import {
  coerceFreeTierGeminiModel,
  geminiRetryOrder,
  isGeminiFreeTierModel,
  isGeminiQuotaError,
  isGeminiRetryableError,
  isLowDailyQuotaGeminiModel
} from "../src/services/ai/geminiFreeTier.js";

describe("Gemini free-tier models", () => {
  it("defaults to 3.6 Flash and remaps legacy 2.5 models for new keys", () => {
    expect(coerceFreeTierGeminiModel("gemini-3.6-flash")).toBe("gemini-3.6-flash");
    expect(coerceFreeTierGeminiModel("gemini-3-pro-preview")).toBe("gemini-3.6-flash");
    expect(coerceFreeTierGeminiModel("imagen-3")).toBe("gemini-3.6-flash");
    expect(coerceFreeTierGeminiModel("gemini-2.5-flash")).toBe("gemini-3.6-flash");
    expect(coerceFreeTierGeminiModel("gemini-2.5-flash-lite")).toBe("gemini-3.6-flash");
  });

  it("retries other free models after the preferred one, legacy last", () => {
    const order = geminiRetryOrder("gemini-3.6-flash");
    expect(order[0]).toBe("gemini-3.6-flash");
    expect(order).toContain("gemini-2.0-flash");
    expect(order.indexOf("gemini-2.0-flash")).toBeLessThan(order.indexOf("gemini-2.5-flash"));
  });

  it("treats NOT_FOUND / no-longer-available as retryable", () => {
    const gone =
      "NOT_FOUND: This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash";
    expect(isGeminiRetryableError(gone)).toBe(true);
    const quota = "RESOURCE_EXHAUSTED: You exceeded your current quota, limit: 20, model: gemini-3.6-flash";
    expect(isGeminiQuotaError(quota)).toBe(true);
    expect(isGeminiRetryableError(quota)).toBe(true);
    expect(isGeminiRetryableError("API key not valid. Please pass a valid API key.")).toBe(false);
  });

  it("marks 3.6 Flash as a low daily-quota model", () => {
    expect(isLowDailyQuotaGeminiModel("gemini-3.6-flash")).toBe(true);
    expect(isGeminiFreeTierModel("gemini-3.6-flash")).toBe(true);
    expect(isGeminiFreeTierModel("gemini-2.5-flash")).toBe(true);
    expect(isGeminiFreeTierModel("gemini-3-pro-preview")).toBe(false);
  });
});
