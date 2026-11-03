import { ApiError } from "@/types/api";

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as {
      userMessage?: string;
      error?: string;
      hints?: string[];
      requestId?: string;
      retryable?: boolean;
      failedModel?: string;
      suggestedModel?: string;
    };
    return new ApiError(
      body.userMessage || body.error || res.statusText,
      body.hints ?? [],
      body.requestId,
      body.error,
      Boolean(body.retryable || body.error === "AI_QUOTA"),
      typeof body.failedModel === "string" ? body.failedModel : undefined,
      typeof body.suggestedModel === "string" ? body.suggestedModel : undefined
    );
  } catch {
    return new ApiError(res.statusText || "Request failed");
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "include"
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
