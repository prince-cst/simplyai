import { env } from "./env.js";
import { loadAppStore, setStoreSettings } from "./appStore.js";
import { coerceFreeTierGeminiModel } from "../services/ai/geminiFreeTier.js";
import type { AIProviderName, PublicRuntimeSettings, RuntimeSettings } from "../types/index.js";

let settings: RuntimeSettings = createDefaultSettings();

function createDefaultSettings(): RuntimeSettings {
  return {
    provider: env.defaultAiProvider,
    fallbackProvider: env.fallbackAiProvider,
    ollama: {
      baseUrl: env.ollamaBaseUrl.replace(/\/$/, ""),
      model: env.ollamaModel
    },
    gemini: {
      apiKey: env.geminiApiKey,
      model: coerceFreeTierGeminiModel(env.geminiModel)
    },
    groq: {
      apiKey: env.groqApiKey,
      model: env.groqModel
    },
    requireQueryApproval: false,
    developerMode: false,
    sampleDocumentsPerCollection: env.maxSampleDocuments,
    maxResultDocuments: env.maxResultDocuments,
    maxSampleDocuments: env.maxSampleDocuments,
    maxPipelineStages: env.maxPipelineStages,
    queryTimeoutMs: env.queryTimeoutMs,
    timezone: env.timezone
  };
}

export function getRuntimeSettings(): RuntimeSettings {
  return settings;
}

export function getPublicRuntimeSettings(): PublicRuntimeSettings {
  return {
    provider: settings.provider,
    fallbackProvider: settings.fallbackProvider,
    ollama: {
      baseUrl: settings.ollama.baseUrl,
      model: settings.ollama.model
    },
    gemini: {
      hasApiKey: Boolean(settings.gemini.apiKey),
      model: coerceFreeTierGeminiModel(settings.gemini.model)
    },
    groq: {
      hasApiKey: Boolean(settings.groq.apiKey),
      model: settings.groq.model
    },
    requireQueryApproval: settings.requireQueryApproval,
    developerMode: settings.developerMode,
    sampleDocumentsPerCollection: settings.sampleDocumentsPerCollection,
    maxResultDocuments: settings.maxResultDocuments,
    maxSampleDocuments: settings.maxSampleDocuments,
    maxPipelineStages: settings.maxPipelineStages,
    queryTimeoutMs: settings.queryTimeoutMs,
    timezone: settings.timezone,
    readOnly: true
  };
}

export interface SettingsPatch {
  provider?: AIProviderName;
  fallbackProvider?: AIProviderName;
  ollama?: { baseUrl?: string; model?: string };
  gemini?: { apiKey?: string; model?: string };
  groq?: { apiKey?: string; model?: string };
  requireQueryApproval?: boolean;
  developerMode?: boolean;
  sampleDocumentsPerCollection?: number;
  maxResultDocuments?: number;
  maxSampleDocuments?: number;
  maxPipelineStages?: number;
  queryTimeoutMs?: number;
  timezone?: string;
}

export function updateRuntimeSettings(patch: SettingsPatch): RuntimeSettings {
  settings = {
    ...settings,
    provider: patch.provider ?? settings.provider,
    fallbackProvider: Object.prototype.hasOwnProperty.call(patch, "fallbackProvider")
      ? patch.fallbackProvider
      : settings.fallbackProvider,
    requireQueryApproval: patch.requireQueryApproval ?? settings.requireQueryApproval,
    developerMode: patch.developerMode ?? settings.developerMode,
    sampleDocumentsPerCollection: patch.sampleDocumentsPerCollection ?? settings.sampleDocumentsPerCollection,
    maxResultDocuments: patch.maxResultDocuments ?? settings.maxResultDocuments,
    maxSampleDocuments: patch.maxSampleDocuments ?? settings.maxSampleDocuments,
    maxPipelineStages: patch.maxPipelineStages ?? settings.maxPipelineStages,
    queryTimeoutMs: patch.queryTimeoutMs ?? settings.queryTimeoutMs,
    timezone: patch.timezone ?? settings.timezone,
    ollama: { ...settings.ollama, ...patch.ollama },
    gemini: {
      ...settings.gemini,
      ...patch.gemini,
      apiKey:
        patch.gemini?.apiKey === "" || patch.gemini?.apiKey
          ? (patch.gemini.apiKey ?? settings.gemini.apiKey).trim()
          : settings.gemini.apiKey,
      model: coerceFreeTierGeminiModel(patch.gemini?.model ?? settings.gemini.model)
    },
    groq: {
      ...settings.groq,
      ...patch.groq,
      apiKey:
        patch.groq?.apiKey === "" || patch.groq?.apiKey
          ? (patch.groq.apiKey ?? settings.groq.apiKey).trim()
          : settings.groq.apiKey
    }
  };
  if (settings.ollama.baseUrl) {
    settings.ollama.baseUrl = settings.ollama.baseUrl.replace(/\/$/, "");
  }
  persistRuntimeSettings();
  return settings;
}

export function resetRuntimeSettings(): RuntimeSettings {
  settings = createDefaultSettings();
  persistRuntimeSettings();
  return settings;
}

function persistRuntimeSettings(): void {
  try {
    setStoreSettings(settings);
  } catch {
    // store is best-effort
  }
}

export function hydrateRuntimeSettingsFromStore(): void {
  const stored = loadAppStore().settings;
  if (!stored) return;
  const defaults = createDefaultSettings();
  settings = {
    ...defaults,
    ...stored,
    ollama: { ...defaults.ollama, ...stored.ollama },
    gemini: {
      model: coerceFreeTierGeminiModel(stored.gemini?.model || defaults.gemini.model),
      apiKey: stored.gemini?.apiKey || defaults.gemini.apiKey
    },
    groq: {
      model: stored.groq?.model || defaults.groq.model,
      apiKey: stored.groq?.apiKey || defaults.groq.apiKey
    }
  };
}
