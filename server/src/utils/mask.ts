export function maskConnectionString(uri: string): string {
  return uri
    .replace(/\/\/([^:/@]+):([^@]+)@/g, "//$1:********@")
    .replace(/((?:password|pwd)\s*=\s*)("[^"]*"|'[^']*'|[^;]*)/gi, "$1********");
}

export function extractDatabaseName(uri: string): string | undefined {
  const withoutProtocol = uri.replace(/^mongodb(\+srv)?:\/\//i, "");
  const atIdx = withoutProtocol.lastIndexOf("@");
  const hostAndPath = atIdx >= 0 ? withoutProtocol.slice(atIdx + 1) : withoutProtocol;
  const slashIdx = hostAndPath.indexOf("/");
  if (slashIdx === -1) return undefined;
  const afterSlash = hostAndPath.slice(slashIdx + 1);
  const db = afterSlash.split("?")[0]?.split("/")[0];
  return db ? decodeURIComponent(db) : undefined;
}

export function isSystemDatabase(name: string): boolean {
  return name === "admin" || name === "local" || name === "config";
}

export function sanitizeMongoError(message: string): string {
  return message
    .replace(/\/\/([^:/@]+):([^@]+)@/g, "//$1:********@")
    .replace(/((?:password|pwd)\s*=\s*)("[^"]*"|'[^']*'|[^;]*)/gi, "$1********")
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, "[connection string redacted]");
}
