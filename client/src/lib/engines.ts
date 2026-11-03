export type ClientEngine = "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";

export function isSqlEngine(engine?: string): engine is "mysql" | "mssql" {
  return engine === "mysql" || engine === "mssql";
}

export function isQuickBooksEngine(engine?: string): engine is "quickbooks" {
  return engine === "quickbooks";
}

export function isOutlookEngine(engine?: string): engine is "outlook" {
  return engine === "outlook";
}

export function isExternalAppEngine(engine?: string): boolean {
  return engine === "quickbooks" || engine === "outlook";
}

export function engineLabel(engine?: string): string {
  if (engine === "mssql") return "SQL Server";
  if (engine === "mysql") return "MySQL";
  if (engine === "quickbooks") return "QuickBooks";
  if (engine === "outlook") return "Outlook";
  return "MongoDB";
}
