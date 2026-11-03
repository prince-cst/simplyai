export function isQuotaFailure(text: string, code?: string): boolean {
  if (code === "AI_QUOTA") return true;
  const lower = text.toLowerCase();
  return lower.includes("quota") || lower.includes("resource_exhausted") || lower.includes("rate limit");
}

export function extractFailedModel(text: string): string | undefined {
  const match = text.match(/model:\s*([a-z0-9._-]+)/i);
  return match?.[1];
}

export function quotaToast(options: { failedModel?: string; suggestedModel?: string; hints: string[] }): {
  title: string;
  description: string;
} {
  const failed = options.failedModel || "this Gemini model";
  const suggested = options.suggestedModel || "gemini-2.5-flash";
  return {
    title: `Free quota finished for ${failed}`,
    description:
      options.hints.filter(Boolean).slice(0, 2).join(" ") ||
      `Switch Chat model to ${suggested}, then click Retry on this message.`
  };
}
