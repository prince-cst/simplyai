import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import type { MicrosoftTokens } from "./types.js";

const GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Mail.Read"
];

export function isMicrosoftConfigured(): boolean {
  return Boolean(env.microsoftClientId && env.microsoftClientSecret && env.microsoftRedirectUri);
}

function authorityBase(): string {
  return env.microsoftAuthority.replace(/\/$/, "");
}

export function microsoftScopes(): string[] {
  return [...GRAPH_SCOPES];
}

export function buildAuthorizeUrl(state: string): string {
  if (!isMicrosoftConfigured()) {
    throw new AppError(
      400,
      "Microsoft not configured",
      "Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_REDIRECT_URI in server/.env.",
      [`Redirect URI must be ${env.microsoftRedirectUri}`],
      "MS_NOT_CONFIGURED"
    );
  }
  const params = new URLSearchParams({
    client_id: env.microsoftClientId,
    response_type: "code",
    redirect_uri: env.microsoftRedirectUri,
    response_mode: "query",
    scope: GRAPH_SCOPES.join(" "),
    state,
    prompt: "select_account"
  });
  return `${authorityBase()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}

async function tokenRequest(body: Record<string, string>): Promise<MicrosoftTokens> {
  const response = await fetch(`${authorityBase()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new AppError(
      400,
      "Microsoft OAuth failed",
      json.error_description || json.error || "Token exchange failed",
      [],
      "MS_OAUTH"
    );
  }
  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || "",
    expiresAt: now + Number(json.expires_in || 3600) * 1000 - 60_000,
    tokenType: json.token_type,
    scope: json.scope
  };
}

export async function exchangeAuthorizationCode(code: string): Promise<MicrosoftTokens> {
  if (!isMicrosoftConfigured()) {
    throw new AppError(400, "Microsoft not configured", "Missing Microsoft env vars.", [], "MS_NOT_CONFIGURED");
  }
  const tokens = await tokenRequest({
    client_id: env.microsoftClientId,
    client_secret: env.microsoftClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.microsoftRedirectUri,
    scope: GRAPH_SCOPES.join(" ")
  });
  if (!tokens.refreshToken) {
    throw new AppError(
      400,
      "Missing refresh token",
      "Microsoft did not return a refresh token. Ensure offline_access is granted.",
      [],
      "MS_OAUTH"
    );
  }
  return tokens;
}

export async function refreshAccessToken(tokens: MicrosoftTokens): Promise<MicrosoftTokens> {
  if (!isMicrosoftConfigured()) {
    throw new AppError(400, "Microsoft not configured", "Missing Microsoft env vars.", [], "MS_NOT_CONFIGURED");
  }
  if (!tokens.refreshToken) {
    throw new AppError(401, "Reconnect required", "Microsoft refresh token missing. Connect Outlook again.", [], "MS_NO_REFRESH");
  }
  const next = await tokenRequest({
    client_id: env.microsoftClientId,
    client_secret: env.microsoftClientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    scope: GRAPH_SCOPES.join(" ")
  });
  return {
    ...tokens,
    accessToken: next.accessToken,
    refreshToken: next.refreshToken || tokens.refreshToken,
    expiresAt: next.expiresAt,
    tokenType: next.tokenType || tokens.tokenType,
    scope: next.scope || tokens.scope
  };
}

export async function fetchGraphProfile(accessToken: string): Promise<{
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Graph /me failed (${response.status})`);
  }
  return (await response.json()) as {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
}

/** Stable id for saved connection matching (not a secret). */
export function outlookAccountKey(email: string, graphUserId: string): string {
  const raw = `${email.toLowerCase()}|${graphUserId}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}
