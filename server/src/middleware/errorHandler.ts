import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";
import { sanitizeMongoError } from "../utils/mask.js";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      userMessage: "The request was invalid.",
      hints: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      requestId: req.requestId
    });
    return;
  }

  if (err instanceof AppError) {
    logger.warn(
      {
        requestId: req.requestId,
        code: err.code,
        errorType: err.name
      },
      err.message
    );
    res.status(err.statusCode).json({
      error: err.code,
      userMessage: err.userMessage,
      hints: err.hints,
      requestId: req.requestId,
      retryable: err.details.retryable === true,
      failedModel: err.details.failedModel,
      suggestedModel: err.details.suggestedModel
    });
    return;
  }

  const raw = err instanceof Error ? err.message : "Unexpected error";
  const message = sanitizeMongoError(raw);
  logger.error({ requestId: req.requestId, errorType: "Unhandled" }, message);
  res.status(500).json({
    error: "INTERNAL",
    userMessage: "Something went wrong while processing the request.",
    hints: ["Retry the action", "Check application logs (credentials are never logged)"],
    requestId: req.requestId
  });
}
