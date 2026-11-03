declare module "intuit-oauth" {
  interface OAuthToken {
    token_type?: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
    realmId?: string;
    id_token?: string;
  }

  interface AuthResponse {
    getToken(): OAuthToken;
    getJson(): unknown;
  }

  class OAuthClient {
    static scopes: {
      Accounting: string;
      OpenId: string;
      Profile: string;
      Email: string;
      Phone: string;
      Address: string;
    };

    constructor(options: {
      clientId: string;
      clientSecret: string;
      environment: "sandbox" | "production";
      redirectUri: string;
      logging?: boolean;
    });

    authorizeUri(options: { scope: string[]; state?: string }): string;
    createToken(uri: string): Promise<AuthResponse>;
    setToken(token: Partial<OAuthToken> & { access_token: string; refresh_token: string }): void;
    refreshUsingToken(refreshToken: string): Promise<AuthResponse>;
    isAccessTokenValid(): boolean;
    makeApiCall(options: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }): Promise<{ getJson(): unknown; json?: unknown; text?: string }>;
  }

  export = OAuthClient;
}
