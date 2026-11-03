import { AppError } from "../../utils/errors.js";
import type { AIProviderName, RuntimeSettings } from "../../types/index.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import type { AIProvider } from "./AIProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { GroqProvider } from "./GroqProvider.js";
import { OllamaProvider } from "./OllamaProvider.js";

export function createAIProvider(
  config: RuntimeSettings = getRuntimeSettings(),
  override?: AIProviderName
): AIProvider {
  const provider = override ?? config.provider;
  switch (provider) {
    case "ollama":
      return new OllamaProvider(config.ollama.baseUrl, config.ollama.model);
    case "gemini":
      if (!config.gemini.apiKey) {
        throw new AppError(
          400,
          "Gemini API key missing",
          "AI provider unavailable.",
          ["Paste a Gemini API key in Settings"],
          "AI_UNAVAILABLE"
        );
      }
      return new GeminiProvider(config.gemini.apiKey, config.gemini.model);
    case "groq":
      if (!config.groq.apiKey) {
        throw new AppError(
          400,
          "Groq API key missing",
          "AI provider unavailable.",
          ["Paste a Groq API key in Settings"],
          "AI_UNAVAILABLE"
        );
      }
      return new GroqProvider(config.groq.apiKey, config.groq.model);
    default: {
      const _never: never = provider;
      throw new AppError(400, `Unknown provider ${_never}`, "Unknown AI provider.", [], "AI_UNAVAILABLE");
    }
  }
}

export function providerDisplayName(name: AIProviderName): string {
  switch (name) {
    case "ollama":
      return "Ollama";
    case "gemini":
      return "Google Gemini";
    case "groq":
      return "Groq";
    default:
      return name;
  }
}
