import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AIProviderName } from "../types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEnv = path.resolve(here, "../../.env");
dotenv.config({ path: serverEnv });
dotenv.config();

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function providerEnv(name: string, fallback: AIProviderName): AIProviderName {
  const raw = (process.env[name] ?? fallback).toLowerCase();
  if (raw === "ollama" || raw === "gemini" || raw === "groq") return raw;
  return fallback;
}

function optionalProvider(name: string): AIProviderName | undefined {
  const raw = (process.env[name] ?? "").toLowerCase().trim();
  if (raw === "ollama" || raw === "gemini" || raw === "groq") return raw;
  return undefined;
}

export const env = {
  port: intEnv("PORT", 4000),
  timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
  defaultAiProvider: providerEnv("DEFAULT_AI_PROVIDER", "ollama"),
  fallbackAiProvider: optionalProvider("AI_FALLBACK_PROVIDER"),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  maxResultDocuments: intEnv("MAX_RESULT_DOCUMENTS", 100),
  maxSampleDocuments: intEnv("MAX_SAMPLE_DOCUMENTS", 10),
  maxPipelineStages: intEnv("MAX_PIPELINE_STAGES", 30),
  queryTimeoutMs: intEnv("QUERY_TIMEOUT_MS", 15000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
  testDatabaseName: process.env.TEST_DATABASE_NAME || "test_shop_db",
  nodeEnv: process.env.NODE_ENV || "development",
  quickbooksClientId: process.env.QUICKBOOKS_CLIENT_ID || "",
  quickbooksClientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || "",
  quickbooksRedirectUri:
    process.env.QUICKBOOKS_REDIRECT_URI || "http://localhost:4000/api/quickbooks/callback",
  quickbooksEnvironment:
    (process.env.QUICKBOOKS_ENVIRONMENT || "sandbox").toLowerCase() === "production"
      ? ("production" as const)
      : ("sandbox" as const),
  quickbooksFrontendRedirect:
    process.env.QUICKBOOKS_FRONTEND_REDIRECT || "http://localhost:5173/connections",
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || "",
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
  microsoftRedirectUri:
    process.env.MICROSOFT_REDIRECT_URI || "http://localhost:4000/api/auth/microsoft/callback",
  /** Work/school + personal Microsoft accounts. Use organizations for work-only. */
  microsoftAuthority:
    process.env.MICROSOFT_AUTHORITY || "https://login.microsoftonline.com/common",
  microsoftFrontendRedirect:
    process.env.MICROSOFT_FRONTEND_REDIRECT || "http://localhost:5173/connections",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: intEnv("SMTP_PORT", 465),
  smtpSecure: (process.env.SMTP_SECURE || "true").toLowerCase() !== "false",
  smtpUser: process.env.SMTP_USER || process.env.SMTP_MAIL || "",
  smtpPassword: process.env.SMTP_PASSWORD || "",
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.SMTP_MAIL || ""
};
