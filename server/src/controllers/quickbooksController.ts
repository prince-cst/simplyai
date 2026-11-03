import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { buildAuthorizeUrl, isQuickBooksConfigured } from "../services/quickbooks/oauth.js";
import { quickBooksConnectionManager } from "../services/quickbooks/QuickBooksConnectionManager.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";

const oauthStates = new Map<string, { sessionId: string; expiresAt: number }>();

function pruneStates(): void {
  const now = Date.now();
  for (const [key, value] of oauthStates) {
    if (value.expiresAt < now) oauthStates.delete(key);
  }
}

export function quickbooksStatus(_req: Request, res: Response): void {
  res.json({
    configured: isQuickBooksConfigured(),
    environment: env.quickbooksEnvironment,
    redirectUri: env.quickbooksRedirectUri
  });
}

export function startQuickBooksConnect(req: Request, res: Response): void {
  if (!isQuickBooksConfigured()) {
    throw new AppError(
      400,
      "QuickBooks not configured",
      "Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET to server/.env.",
      [`Redirect URI must be ${env.quickbooksRedirectUri}`],
      "QB_NOT_CONFIGURED"
    );
  }
  pruneStates();
  const state = randomBytes(16).toString("hex");
  oauthStates.set(state, { sessionId: req.sessionId, expiresAt: Date.now() + 10 * 60_000 });
  const url = buildAuthorizeUrl(state);
  res.json({ url });
}

export async function quickBooksCallback(req: Request, res: Response): Promise<void> {
  const frontend = env.quickbooksFrontendRedirect.replace(/\/$/, "");
  try {
    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    if (error) {
      res.redirect(`${frontend}?qb=error&message=${encodeURIComponent(error)}`);
      return;
    }
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const entry = oauthStates.get(state);
    oauthStates.delete(state);
    if (!entry || entry.expiresAt < Date.now()) {
      res.redirect(`${frontend}?qb=error&message=${encodeURIComponent("OAuth state expired. Try Connect again.")}`);
      return;
    }
    // Intuit redirects to our redirectUri with code + realmId; pass full URL to token exchange.
    const proto = req.protocol;
    const host = req.get("host") ?? "localhost:4000";
    const redirectUrl = `${proto}://${host}${req.originalUrl}`;
    await quickBooksConnectionManager.connectFromCallback(entry.sessionId, redirectUrl);
    // Ensure session/status managers agree on active connection.
    await mongoConnectionManager.ensureLive(entry.sessionId);
    res.redirect(`${frontend}?qb=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks connect failed";
    res.redirect(`${frontend}?qb=error&message=${encodeURIComponent(message)}`);
  }
}
