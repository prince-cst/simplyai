export type DatabaseEngine = "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
export type SqlDialect = "mysql" | "mssql";

export function isSqlEngine(engine?: string): engine is SqlDialect {
  return engine === "mysql" || engine === "mssql";
}

export function isQuickBooksEngine(engine?: string): engine is "quickbooks" {
  return engine === "quickbooks";
}

export function isOutlookEngine(engine?: string): engine is "outlook" {
  return engine === "outlook";
}

/** QuickBooks / Outlook — OAuth apps, not SQL/Mongo databases. */
export function isExternalAppEngine(engine?: string): boolean {
  return engine === "quickbooks" || engine === "outlook";
}

export function sqlProductLabel(engine?: string): string {
  if (engine === "mssql") return "SQL Server";
  if (engine === "mysql") return "MySQL";
  if (engine === "mongodb") return "MongoDB";
  if (engine === "quickbooks") return "QuickBooks";
  if (engine === "outlook") return "Outlook";
  return "database";
}
