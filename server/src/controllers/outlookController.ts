import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { buildAuthorizeUrl, isMicrosoftConfigured, newOAuthState } from "../services/outlook/oauth.js";
import { outlookConnectionManager } from "../services/outlook/OutlookConnectionManager.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";
import { executeOutlookPlan } from "../services/outlook/executePlan.js";

const oauthStates = new Map<string, { sessionId: string; expiresAt: number }>();

function pruneStates(): void {
  const now = Date.now();
  for (const [key, value] of oauthStates) {
    if (value.expiresAt < now) oauthStates.delete(key);
  }
}

export function outlookStatus(_req: Request, res: Response): void {
  res.json({
    configured: isMicrosoftConfigured(),
    authority: env.microsoftAuthority,
    redirectUri: env.microsoftRedirectUri
  });
}

export function startOutlookConnect(req: Request, res: Response): void {
  if (!isMicrosoftConfigured()) {
    throw new AppError(
      400,
      "Microsoft not configured",
      "Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to server/.env.",
      [`Redirect URI must be ${env.microsoftRedirectUri}`],
      "MS_NOT_CONFIGURED"
    );
  }
  pruneStates();
  const state = newOAuthState();
  oauthStates.set(state, { sessionId: req.sessionId, expiresAt: Date.now() + 10 * 60_000 });
  const url = buildAuthorizeUrl(state);
  res.json({ url });
}

export async function microsoftAuthCallback(req: Request, res: Response): Promise<void> {
  const frontend = env.microsoftFrontendRedirect.replace(/\/$/, "");
  try {
    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    const errorDescription =
      typeof req.query.error_description === "string" ? req.query.error_description : undefined;
    if (error) {
      res.redirect(
        `${frontend}?outlook=error&message=${encodeURIComponent(errorDescription || error)}`
      );
      return;
    }
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const entry = oauthStates.get(state);
    oauthStates.delete(state);
    if (!entry || entry.expiresAt < Date.now()) {
      res.redirect(
        `${frontend}?outlook=error&message=${encodeURIComponent("OAuth state expired. Try Connect again.")}`
      );
      return;
    }
    if (!code) {
      res.redirect(
        `${frontend}?outlook=error&message=${encodeURIComponent("Authorization code missing.")}`
      );
      return;
    }
    await outlookConnectionManager.connectFromCallback(entry.sessionId, code);
    await mongoConnectionManager.ensureLive(entry.sessionId);
    res.redirect(`${frontend}?outlook=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outlook connect failed";
    res.redirect(`${frontend}?outlook=error&message=${encodeURIComponent(message)}`);
  }
}

/** Convenience inbox peek for debugging (uses active Outlook connection). */
export async function outlookInbox(req: Request, res: Response): Promise<void> {
  const status = await mongoConnectionManager.statusWithDetails(req.sessionId);
  if (!status.connected || status.engine !== "outlook" || !status.activeConnectionId) {
    throw new AppError(401, "Not authenticated", "Connect Outlook first.", [], "NOT_CONNECTED");
  }
  const top = Math.min(Number(req.query.top) || 20, 50);
  const result = await executeOutlookPlan(status.activeConnectionId, {
    status: "ready",
    operation: "outlook",
    collection: "Inbox",
    limit: top,
    explanation: "Direct inbox fetch",
    collectionsUsed: ["Inbox"],
    fieldsUsed: [],
    assumptions: [],
    confidence: 1,
    outlook: {
      folder: "inbox",
      range: typeof req.query.range === "string" ? (req.query.range as "today") : "today",
      unreadOnly: req.query.unread === "1",
      includeBody: req.query.body === "1"
    }
  });
  res.json({
    success: true,
    count: result.resultCount,
    emails: result.documents,
    warnings: result.warnings
  });
}
