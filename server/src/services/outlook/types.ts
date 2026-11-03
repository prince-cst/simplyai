export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
  accountEmail?: string;
  accountName?: string;
  homeAccountId?: string;
}

export type OutlookFolder = "inbox" | "sentitems";

export type OutlookDateRange =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "all";

export interface OutlookPlanPayload {
  folder: OutlookFolder;
  range: OutlookDateRange;
  unreadOnly?: boolean;
  includeBody?: boolean;
  search?: string;
}

export const OUTLOOK_FOLDERS = ["Inbox", "SentItems"] as const;
