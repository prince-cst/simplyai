import type { NextFunction, Request, Response } from "express";
import { v4 as uuid } from "uuid";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.header("x-request-id");
  const id = existing && existing.trim() ? existing.trim() : uuid();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      sessionId: string;
    }
  }
}
