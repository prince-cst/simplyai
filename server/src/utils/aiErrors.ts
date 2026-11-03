export function redactSecrets(text: string): string {
  return text
    .replace(/AQ\.[A-Za-z0-9_\-]+/g, "AQ.***")
    .replace(/AIza[A-Za-z0-9_\-]+/g, "AIza***")
    .replace(/gsk_[A-Za-z0-9]+/g, "gsk_***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***");
}

export function describeAiError(error: unknown): string {
  if (!error) return "Unknown error";
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactSecrets(raw);
  const jsonStart = redacted.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(redacted.slice(jsonStart)) as {
        error?: { message?: string; status?: string; code?: number };
      };
      const inner = parsed.error;
      if (inner?.message) {
        const code = inner.status ?? inner.code;
        return code ? `${code}: ${inner.message}` : inner.message;
      }
    } catch {
      /* keep fallback */
    }
  }
  return redacted.replace(/^AI provider unavailable:\s*/i, "").slice(0, 800);
}

export function geminiUserHints(detail: string): string[] {
  const lower = detail.toLowerCase();
  const hints: string[] = [];
  if (lower.includes("api key not valid") || lower.includes("invalid api key") || lower.includes("unauthenticated")) {
    hints.push("Re-copy the full key from Google AI Studio (new keys start with AQ.).");
    hints.push("Click Save API key, then Test Gemini. Do not test an unsaved paste.");
    hints.push("The key field in AI Studio can look truncated — use Copy key, not a partial select.");
  }
  if (lower.includes("not found") || lower.includes("not_found") || lower.includes("no longer available") || lower.includes("is not found")) {
    hints.push("That Gemini model is unavailable for this API key. The app will automatically try another free-tier model (e.g. gemini-3.6-flash).");
  }
  if (lower.includes("permission") || lower.includes("has not been used") || lower.includes("disabled")) {
    hints.push("Enable the Generative Language API for the Google Cloud project attached to this key.");
  }
  if (lower.includes("quota") || lower.includes("resource_exhausted")) {
    hints.push("That Gemini model’s free-tier quota is used up. The app switches to another free model and continues.");
    hints.push("Gemini 3.6 Flash has a smaller daily free limit — if it fails, try Gemini 2.0 Flash or set a fallback provider (Groq/Ollama) in Settings.");
  }
  if (!hints.length) {
    hints.push("Check API key, model name, and that Generative Language API is enabled.");
  }
  return hints;
}
