export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt?: number;
  realmId: string;
  companyName?: string;
  tokenType?: string;
}

export type QboReportName =
  | "BalanceSheet"
  | "ProfitAndLoss"
  | "CashFlow"
  | "TrialBalance"
  | "AgedReceivables"
  | "AgedReceivableDetail"
  | "AgedPayables"
  | "AgedPayableDetail"
  | "CustomerBalance"
  | "CustomerBalanceDetail";

export type QboEntityName =
  | "Account"
  | "Customer"
  | "Vendor"
  | "Invoice"
  | "Bill"
  | "Payment"
  | "Item"
  | "CompanyInfo";

export interface QboPlanPayload {
  action: "report" | "query" | "read";
  reportName?: QboReportName;
  entity?: QboEntityName;
  params?: Record<string, string>;
  /** QuickBooks query language, e.g. SELECT * FROM Invoice MAXRESULTS 20 */
  query?: string;
}

export const QBO_REPORTS: QboReportName[] = [
  "BalanceSheet",
  "ProfitAndLoss",
  "CashFlow",
  "TrialBalance",
  "AgedReceivables",
  "AgedReceivableDetail",
  "AgedPayables",
  "AgedPayableDetail",
  "CustomerBalance",
  "CustomerBalanceDetail"
];

export const QBO_ENTITIES: QboEntityName[] = [
  "Account",
  "Customer",
  "Vendor",
  "Invoice",
  "Bill",
  "Payment",
  "Item",
  "CompanyInfo"
];
