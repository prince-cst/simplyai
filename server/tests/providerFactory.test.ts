import { describe, expect, it } from "vitest";
import { createAIProvider } from "../src/services/ai/AIProviderFactory.js";
import { OllamaProvider } from "../src/services/ai/OllamaProvider.js";
import { GeminiProvider } from "../src/services/ai/GeminiProvider.js";
import { GroqProvider } from "../src/services/ai/GroqProvider.js";
import type { RuntimeSettings } from "../src/types/index.js";

const base: RuntimeSettings = {
  provider: "ollama",
  ollama: { baseUrl: "http://localhost:11434", model: "qwen3" },
  gemini: { apiKey: "test-key", model: "gemini-2.5-flash" },
  groq: { apiKey: "test-key", model: "llama-3.3-70b-versatile" },
  requireQueryApproval: false,
  developerMode: false,
  sampleDocumentsPerCollection: 10,
  maxResultDocuments: 100,
  maxSampleDocuments: 10,
  maxPipelineStages: 30,
  queryTimeoutMs: 15000,
  timezone: "Asia/Kolkata"
};

describe("AI provider factory", () => {
  it("creates OllamaProvider", () => {
    const p = createAIProvider(base, "ollama");
    expect(p).toBeInstanceOf(OllamaProvider);
    expect(p.name).toBe("ollama");
  });

  it("creates GeminiProvider", () => {
    const p = createAIProvider(base, "gemini");
    expect(p).toBeInstanceOf(GeminiProvider);
    expect(p.name).toBe("gemini");
  });

  it("creates GroqProvider", () => {
    const p = createAIProvider(base, "groq");
    expect(p).toBeInstanceOf(GroqProvider);
    expect(p.name).toBe("groq");
  });

  it("requires API keys for cloud providers", () => {
    expect(() =>
      createAIProvider({ ...base, gemini: { apiKey: "", model: "x" } }, "gemini")
    ).toThrow();
    expect(() => createAIProvider({ ...base, groq: { apiKey: "", model: "x" } }, "groq")).toThrow();
  });
});
