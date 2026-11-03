import type { NextFunction, Request, Response } from "express";
import { getOrCreateSession } from "../services/session/SessionStore.js";

const COOKIE = "mba_session";

export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const fromCookie = req.cookies?.[COOKIE] as string | undefined;
  const fromHeader = req.header("x-session-id");
  const session = getOrCreateSession(fromHeader || fromCookie);
  req.sessionId = session.id;
  res.cookie(COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  next();
}
