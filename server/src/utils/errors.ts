export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly userMessage: string,
    public readonly hints: string[] = [],
    public readonly code: string = "APP_ERROR",
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function mongoConnectError(cause?: unknown): AppError {
  const detail = cause instanceof Error ? cause.message : "Unknown error";
  return new AppError(
    400,
    `MongoDB connection failed: ${detail}`,
    "Unable to connect to MongoDB.",
    [
      "connection string",
      "username/password",
      "network access",
      "IP whitelist",
      "database name"
    ],
    "MONGO_CONNECT"
  );
}

export function aiUnavailableError(provider: string, detail?: string): AppError {
  const extra = detail ? [`Details: ${detail}`] : [];
  if (provider === "ollama") {
    return new AppError(
      503,
      `Ollama unavailable: ${detail ?? "connection failed"}`,
      "Cannot connect to Ollama.",
      [
        "Make sure Ollama is installed and running.",
        "Expected: http://localhost:11434",
        ...extra
      ],
      "AI_OLLAMA"
    );
  }
  return new AppError(
    503,
    `AI provider unavailable: ${detail ?? provider}`,
    "AI provider unavailable.",
    ["provider configuration", "API key", "model", "Ollama running status", ...extra],
    "AI_UNAVAILABLE"
  );
}

export function aiQuotaError(options: {
  detail: string;
  failedModel?: string;
  suggestedModel: string;
}): AppError {
  const failed = options.failedModel || "this Gemini model";
  const suggested = options.suggestedModel;
  return new AppError(
    429,
    `Gemini quota exhausted: ${options.detail}`,
    `Free-tier quota is used up for ${failed}. Switch to ${suggested} in Chat, then click Retry.`,
    [
      `${failed} has a small daily free limit (Gemini 3.6 Flash is about 20 requests per day).`,
      `Open the model menu in Chat and choose ${suggested}.`,
      "Click Retry on this message to run the same question again."
    ],
    "AI_QUOTA",
    {
      retryable: true,
      failedModel: options.failedModel,
      suggestedModel: suggested
    }
  );
}

export function queryRejectedError(reasons: string[]): AppError {
  return new AppError(
    400,
    `Query rejected: ${reasons.join("; ")}`,
    "The AI generated a query that was rejected by the safety validator.",
    reasons,
    "QUERY_REJECTED"
  );
}

export function insufficientDataError(detail?: string): AppError {
  return new AppError(
    422,
    detail ?? "Insufficient data",
    "The database does not contain enough information to answer this question reliably.",
    [],
    "INSUFFICIENT_DATA"
  );
}
