export interface GeminiFreeTierModel {
  id: string;
  name: string;
}

/**
 * Google AI Studio free-tier text models, preferred first.
 * Prefer Gemini 3.x — 2.5 Flash is often unavailable to new API keys ("no longer available to new users").
 */
export const GEMINI_FREE_TIER_MODELS: GeminiFreeTierModel[] = [
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
  { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite preview" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (legacy)" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (legacy)" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (legacy)" }
];

export const DEFAULT_GEMINI_FREE_MODEL = "gemini-3.6-flash";

/** Models Google often rejects for new AI Studio keys — coerce away from these as defaults. */
const LEGACY_UNAVAILABLE_FOR_NEW_USERS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro"
]);

const LOW_DAILY_QUOTA_PREFIXES = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.0-flash"];

const PAID_OR_NON_TEXT = [
  "imagen",
  "veo",
  "lyria",
  "computer-use",
  "native-audio",
  "tts",
  "image",
  "ultra",
  "embedding",
  "gemini-3-pro",
  "gemini-3.0-pro",
  "gemini-3.1-pro"
];

export function normalizeGeminiModelId(id: string): string {
  return id.trim().toLowerCase().replace(/^models\//, "");
}

function canonicalFreeTierId(id: string): string | undefined {
  const n = normalizeGeminiModelId(id);
  const exact = GEMINI_FREE_TIER_MODELS.find((m) => m.id === n);
  if (exact) return exact.id;
  const byPrefix = [...GEMINI_FREE_TIER_MODELS]
    .sort((a, b) => b.id.length - a.id.length)
    .find((m) => n.startsWith(`${m.id}-`));
  return byPrefix?.id;
}

export function isLowDailyQuotaGeminiModel(id: string): boolean {
  const n = normalizeGeminiModelId(id);
  return LOW_DAILY_QUOTA_PREFIXES.some((prefix) => n === prefix || n.startsWith(`${prefix}-`));
}

export function isGeminiFreeTierModel(id: string): boolean {
  const n = normalizeGeminiModelId(id);
  if (!n || PAID_OR_NON_TEXT.some((part) => n.includes(part))) return false;
  return Boolean(canonicalFreeTierId(n));
}

export function coerceFreeTierGeminiModel(id: string | undefined): string {
  const n = normalizeGeminiModelId(id ?? "");
  if (!n) return DEFAULT_GEMINI_FREE_MODEL;
  const canonical = canonicalFreeTierId(n);
  if (!canonical) return DEFAULT_GEMINI_FREE_MODEL;
  // New Google AI Studio keys cannot use 2.5 Flash family — map them to the current default.
  if (LEGACY_UNAVAILABLE_FOR_NEW_USERS.has(canonical)) return DEFAULT_GEMINI_FREE_MODEL;
  return canonical;
}

export function extractGeminiModelFromError(detail: string): string | undefined {
  const match =
    detail.match(/models\/([a-z0-9._-]+)/i) ??
    detail.match(/model:\s*([a-z0-9._-]+)/i) ??
    detail.match(/model\s+([a-z0-9._-]+)\s+is no longer available/i);
  return match?.[1];
}

export function suggestedGeminiModelAfterQuota(failedModel?: string): string {
  const failed = normalizeGeminiModelId(failedModel ?? "");
  const order = geminiRetryOrder(DEFAULT_GEMINI_FREE_MODEL);
  const next = order.find((id) => id !== failed && !isLowDailyQuotaGeminiModel(id));
  return next ?? "gemini-2.0-flash";
}

export function geminiRetryOrder(preferred: string): string[] {
  const start = coerceFreeTierGeminiModel(preferred);
  const ids = GEMINI_FREE_TIER_MODELS.map((m) => m.id);
  // Prefer current models first; try legacy 2.5 last (often rejected for new keys).
  const preferredFirst = [start, ...ids.filter((id) => id !== start)];
  const current = preferredFirst.filter((id) => !LEGACY_UNAVAILABLE_FOR_NEW_USERS.has(id));
  const legacy = preferredFirst.filter((id) => LEGACY_UNAVAILABLE_FOR_NEW_USERS.has(id));
  return [...current, ...legacy];
}

export function isGeminiAuthError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes("api key not valid") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthenticated") ||
    lower.includes("permission_denied") ||
    lower.includes("api_key_invalid")
  );
}

export function isGeminiQuotaError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    /\b429\b/.test(lower)
  );
}

export function isGeminiRetryableError(detail: string): boolean {
  if (isGeminiAuthError(detail)) return false;
  const lower = detail.toLowerCase();
  return (
    isGeminiQuotaError(detail) ||
    lower.includes("not found") ||
    lower.includes("not_found") ||
    lower.includes("no longer available") ||
    lower.includes("is not found") ||
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("high demand") ||
    lower.includes("try again")
  );
}

export function geminiFreeTierModelInfos(): { id: string; name: string; provider: "gemini" }[] {
  const seen = new Set<string>();
  return GEMINI_FREE_TIER_MODELS.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).map((m) => ({ id: m.id, name: m.name, provider: "gemini" as const }));
}
