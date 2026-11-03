import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import type { QuickBooksTokens } from "./types.js";

// intuit-oauth is CommonJS; default import works with esModuleInterop.
import OAuthClient from "intuit-oauth";

export function isQuickBooksConfigured(): boolean {
  return Boolean(env.quickbooksClientId && env.quickbooksClientSecret && env.quickbooksRedirectUri);
}

export function createOAuthClient(): InstanceType<typeof OAuthClient> {
  if (!isQuickBooksConfigured()) {
    throw new AppError(
      400,
      "QuickBooks not configured",
      "Set QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_REDIRECT_URI in server/.env.",
      ["Add the same redirect URI in Intuit Developer → Settings"],
      "QB_NOT_CONFIGURED"
    );
  }
  return new OAuthClient({
    clientId: env.quickbooksClientId,
    clientSecret: env.quickbooksClientSecret,
    environment: env.quickbooksEnvironment,
    redirectUri: env.quickbooksRedirectUri,
    logging: false
  });
}

export function buildAuthorizeUrl(state: string): string {
  const client = createOAuthClient();
  return client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state
  });
}

export async function exchangeAuthorizationCode(redirectUrl: string): Promise<{
  tokens: QuickBooksTokens;
  realmId: string;
}> {
  const client = createOAuthClient();
  const authResponse = await client.createToken(redirectUrl);
  const token = authResponse.getToken() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
    token_type?: string;
    realmId?: string;
  };
  const realmId = String(token.realmId ?? "").trim();
  if (!realmId || !token.access_token || !token.refresh_token) {
    throw new AppError(400, "OAuth failed", "QuickBooks did not return tokens or company id.", [], "QB_OAUTH");
  }
  const now = Date.now();
  return {
    realmId,
    tokens: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: now + Number(token.expires_in || 3600) * 1000 - 60_000,
      refreshExpiresAt: token.x_refresh_token_expires_in
        ? now + Number(token.x_refresh_token_expires_in) * 1000
        : undefined,
      realmId,
      tokenType: token.token_type
    }
  };
}

export async function refreshAccessToken(tokens: QuickBooksTokens): Promise<QuickBooksTokens> {
  const client = createOAuthClient();
  client.setToken({
    token_type: tokens.tokenType || "bearer",
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: Math.max(1, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
    x_refresh_token_expires_in: tokens.refreshExpiresAt
      ? Math.max(1, Math.floor((tokens.refreshExpiresAt - Date.now()) / 1000))
      : undefined,
    realmId: tokens.realmId
  });
  const authResponse = await client.refreshUsingToken(tokens.refreshToken);
  const token = authResponse.getToken() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
    token_type?: string;
  };
  const now = Date.now();
  return {
    ...tokens,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || tokens.refreshToken,
    expiresAt: now + Number(token.expires_in || 3600) * 1000 - 60_000,
    refreshExpiresAt: token.x_refresh_token_expires_in
      ? now + Number(token.x_refresh_token_expires_in) * 1000
      : tokens.refreshExpiresAt,
    tokenType: token.token_type || tokens.tokenType
  };
}

export function apiBaseUrl(): string {
  return env.quickbooksEnvironment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}
