import type { DatabaseEngine } from "../../types/index.js";
import { looksLikeMssql } from "./mssqlUri.js";

export type { DatabaseEngine };

export interface MysqlTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  ssl: boolean;
}

export function connectionEngineOf(saved?: { engine?: string; uri?: string }): DatabaseEngine {
  if (saved?.engine === "quickbooks") return "quickbooks";
  if (saved?.uri?.startsWith("quickbooks://")) return "quickbooks";
  if (saved?.engine === "outlook") return "outlook";
  if (saved?.uri?.startsWith("outlook://")) return "outlook";
  if (saved?.engine === "mysql") return "mysql";
  if (saved?.engine === "mssql") return "mssql";
  if (saved?.uri && looksLikeMssql(saved.uri)) return "mssql";
  if (saved?.uri && looksLikeMysql(saved.uri)) return "mysql";
  return "mongodb";
}

export function looksLikeMysql(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("mysql://") || v.startsWith("jdbc:mysql://") || v.startsWith("mysql:mysql://");
}

export function parseMysqlTarget(input: {
  connectionString?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  databaseName?: string;
  ssl?: boolean;
}): MysqlTarget {
  const raw = input.connectionString?.trim() ?? "";
  if (raw) {
    const fromUri = parseMysqlUri(raw);
    return {
      host: input.host?.trim() || fromUri.host,
      port: input.port || fromUri.port,
      user: input.username?.trim() || fromUri.user,
      password: input.password ?? fromUri.password,
      database: input.databaseName?.trim() || fromUri.database,
      ssl: input.ssl ?? fromUri.ssl
    };
  }
  const host = input.host?.trim();
  if (!host) {
    throw new Error("MySQL host or URI is required");
  }
  return {
    host,
    port: input.port || 3306,
    user: input.username?.trim() || "root",
    password: input.password ?? "",
    database: input.databaseName?.trim() || undefined,
    ssl: input.ssl ?? true
  };
}

export function parseMysqlUri(uri: string): MysqlTarget {
  const trimmed = uri.trim();
  const normalized = trimmed
    .replace(/^jdbc:mysql:\/\//i, "mysql://")
    .replace(/^mysql:mysql:\/\//i, "mysql://");
  const withScheme = /^mysql:\/\//i.test(normalized) ? normalized : `mysql://${normalized}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Invalid MySQL connection URI");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("/")[0] || undefined;
  const sslMode = (parsed.searchParams.get("sslMode") || parsed.searchParams.get("ssl") || "").toLowerCase();
  const ssl = sslMode === "false" || sslMode === "disable" || sslMode === "disabled" ? false : true;
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
    user: decodeURIComponent(parsed.username || "root"),
    password: decodeURIComponent(parsed.password || ""),
    database: database || undefined,
    ssl
  };
}

export function toMysqlUri(target: MysqlTarget): string {
  const user = encodeURIComponent(target.user);
  const pass = encodeURIComponent(target.password);
  const db = target.database ? `/${encodeURIComponent(target.database)}` : "";
  const ssl = target.ssl ? "preferred" : "disable";
  return `mysql://${user}:${pass}@${target.host}:${target.port}${db}?sslMode=${ssl}`;
}

export function mysqlDisplayHost(target: MysqlTarget): string {
  return `${target.host}:${target.port}`;
}

export function pickDefaultMysqlDatabase(connectionName: string, databases: string[]): string | undefined {
  if (!databases.length) return undefined;
  if (databases.length === 1) return databases[0];
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = norm(connectionName);
  if (!needle) return undefined;
  const exact = databases.find((name) => norm(name) === needle);
  if (exact) return exact;
  return databases.find((name) => {
    const id = norm(name);
    return Boolean(id) && (needle.includes(id) || id.includes(needle));
  });
}
