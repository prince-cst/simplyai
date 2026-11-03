import type { Request, Response } from "express";
import { AiTestBodySchema, SettingsUpdateSchema } from "../schemas/queryPlan.js";
import {
  getPublicRuntimeSettings,
  getRuntimeSettings,
  updateRuntimeSettings
} from "../config/runtimeSettings.js";
import { createAIProvider } from "../services/ai/AIProviderFactory.js";
import { geminiFreeTierModelInfos } from "../services/ai/geminiFreeTier.js";
import type { AIProviderName } from "../types/index.js";

export function listProviders(_req: Request, res: Response): void {
  const settings = getPublicRuntimeSettings();
  res.json({
    providers: [
      { id: "ollama", name: "Ollama", requiresApiKey: false },
      { id: "gemini", name: "Google Gemini", requiresApiKey: true },
      { id: "groq", name: "Groq", requiresApiKey: true }
    ],
    current: settings.provider,
    fallback: settings.fallbackProvider,
    settings
  });
}

export function getSettings(_req: Request, res: Response): void {
  res.json(getPublicRuntimeSettings());
}

export function updateSettings(req: Request, res: Response): void {
  const body = SettingsUpdateSchema.parse(req.body);
  updateRuntimeSettings({
    ...body,
    fallbackProvider: body.fallbackProvider === null ? undefined : body.fallbackProvider,
    ollama: body.ollama,
    gemini: body.gemini,
    groq: body.groq
  });
  res.json(getPublicRuntimeSettings());
}

export async function testAi(req: Request, res: Response): Promise<void> {
  const body = AiTestBodySchema.parse(req.body ?? {});
  const providerName = (body.provider ?? getRuntimeSettings().provider) as AIProviderName;
  const provider = createAIProvider(getRuntimeSettings(), providerName);
  const result = await provider.testConnection();
  res.json(result);
}

export async function listAiModels(req: Request, res: Response): Promise<void> {
  const providerName = (String(req.query.provider || getRuntimeSettings().provider) as AIProviderName);
  if (providerName === "gemini") {
    res.json({ provider: "gemini", models: geminiFreeTierModelInfos() });
    return;
  }
  const provider = createAIProvider(getRuntimeSettings(), providerName);
  const models = await provider.listModels();
  res.json({ provider: providerName, models });
}
