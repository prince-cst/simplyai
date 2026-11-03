export interface MssqlTarget {
  host: string;
  port: number;
  instance?: string;
  user: string;
  password: string;
  database?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export function looksLikeMssql(value: string): boolean {
  const v = value.trim();
  const lower = v.toLowerCase();
  if (
    lower.startsWith("mssql://") ||
    lower.startsWith("sqlserver://") ||
    lower.startsWith("jdbc:sqlserver://")
  ) {
    return true;
  }
  if (/database\.windows\.net/i.test(v)) return true;
  if (/\bdata\s*source\s*=/i.test(v) || /^\s*server\s*=/i.test(v)) return true;
  if (/\binitial\s*catalog\s*=/i.test(v) && /\b(user\s*id|uid)\s*=/i.test(v)) return true;
  return false;
}

export function isMaskedSecret(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^[●•*]+$/.test(v) || /^(your)?password$/i.test(v);
}

export function parseMssqlTarget(input: {
  connectionString?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  databaseName?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}): MssqlTarget {
  const raw = input.connectionString?.trim() ?? "";
  const fromString = raw ? parseMssqlConnectionString(raw) : undefined;
  const host = input.host?.trim() || fromString?.host;
  if (!host) {
    throw new Error("SQL Server Data Source / host or connection string is required");
  }
  const passwordFromForm = input.password ?? "";
  const passwordFromString = fromString?.password ?? "";
  let password = passwordFromForm || passwordFromString;
  if (isMaskedSecret(passwordFromString) && !passwordFromForm.trim()) {
    throw new Error(
      "The connection string has a masked password. Enter the real SQL password in the Password field."
    );
  }
  if (isMaskedSecret(password)) {
    throw new Error("Enter the real SQL Server password (not ●●●●●●).");
  }
  const azure = /database\.windows\.net/i.test(host);
  const encrypt = azure ? true : (input.encrypt ?? fromString?.encrypt ?? true);
  const trustServerCertificate =
    input.trustServerCertificate ?? fromString?.trustServerCertificate ?? azure;
  return {
    host,
    port: input.port || fromString?.port || 1433,
    instance: fromString?.instance,
    user: input.username?.trim() || fromString?.user || "",
    password,
    database: input.databaseName?.trim() || fromString?.database,
    encrypt,
    trustServerCertificate
  };
}

export function parseMssqlConnectionString(raw: string): MssqlTarget {
  const trimmed = raw.trim();
  if (/^(mssql|sqlserver):\/\//i.test(trimmed)) {
    return parseMssqlUri(trimmed);
  }
  if (/^jdbc:sqlserver:\/\//i.test(trimmed)) {
    return parseJdbcSqlServer(trimmed);
  }
  return parseAdoNetSqlServer(trimmed);
}

export function parseMssqlUri(uri: string): MssqlTarget {
  const normalized = uri.trim().replace(/^sqlserver:\/\//i, "mssql://");
  const withScheme = /^mssql:\/\//i.test(normalized) ? normalized : `mssql://${normalized}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Invalid SQL Server connection URI");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("/")[0] || undefined;
  const encrypt = parseBool(parsed.searchParams.get("encrypt"), true);
  const trust = parseBool(parsed.searchParams.get("trustServerCertificate"), encrypt);
  const instance = parsed.searchParams.get("instance") || undefined;
  const azure = /database\.windows\.net/i.test(parsed.hostname);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 1433,
    instance,
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database: database || undefined,
    encrypt: azure ? true : encrypt,
    trustServerCertificate: parsed.searchParams.has("trustServerCertificate") ? trust : azure
  };
}

export function toMssqlUri(target: MssqlTarget): string {
  const user = encodeURIComponent(target.user);
  const pass = encodeURIComponent(target.password);
  const db = target.database ? `/${encodeURIComponent(target.database)}` : "";
  const params = new URLSearchParams({
    encrypt: target.encrypt ? "true" : "false",
    trustServerCertificate: target.trustServerCertificate ? "true" : "false"
  });
  if (target.instance) params.set("instance", target.instance);
  return `mssql://${user}:${pass}@${target.host}:${target.port}${db}?${params.toString()}`;
}

export function mssqlDisplayHost(target: MssqlTarget): string {
  return target.instance ? `${target.host}\\${target.instance}` : `${target.host}:${target.port}`;
}

function parseJdbcSqlServer(raw: string): MssqlTarget {
  const rest = raw.replace(/^jdbc:sqlserver:\/\//i, "");
  const semi = rest.indexOf(";");
  const hostPart = semi >= 0 ? rest.slice(0, semi) : rest;
  const props = semi >= 0 ? parseAdoNetPairs(rest.slice(semi + 1)) : {};
  const parsedHost = parseDataSource(hostPart);
  return targetFromPairs(props, parsedHost);
}

function parseAdoNetSqlServer(raw: string): MssqlTarget {
  const props = parseAdoNetPairs(raw);
  const source = props["data source"] || props.server || props.address || props.addr || props["network address"];
  if (!source) {
    throw new Error("SQL Server connection string needs Data Source or Server");
  }
  return targetFromPairs(props, parseDataSource(source));
}

function targetFromPairs(props: Record<string, string>, parsedHost: { host: string; port: number; instance?: string }): MssqlTarget {
  const azure = /database\.windows\.net/i.test(parsedHost.host);
  const encrypt = parseBool(props.encrypt, true);
  const trust = parseBool(
    props["trust server certificate"] || props.trustservercertificate,
    azure
  );
  return {
    host: parsedHost.host,
    port: parsedHost.port,
    instance: parsedHost.instance,
    user: props["user id"] || props.uid || props.user || props["user name"] || "",
    password: props.password || props.pwd || "",
    database: props["initial catalog"] || props.database || props.databasename || undefined,
    encrypt: azure ? true : encrypt,
    trustServerCertificate: trust
  };
}

export function parseAdoNetPairs(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  let i = 0;
  const text = raw.trim();
  while (i < text.length) {
    while (i < text.length && (text[i] === ";" || /\s/.test(text[i] ?? ""))) i += 1;
    if (i >= text.length) break;
    const eq = text.indexOf("=", i);
    if (eq < 0) break;
    const key = text.slice(i, eq).trim().toLowerCase().replace(/\s+/g, " ");
    i = eq + 1;
    while (i < text.length && text[i] === " ") i += 1;
    let value = "";
    if (text[i] === '"') {
      i += 1;
      const end = text.indexOf('"', i);
      value = end >= 0 ? text.slice(i, end) : text.slice(i);
      i = end >= 0 ? end + 1 : text.length;
    } else {
      const semi = text.indexOf(";", i);
      value = (semi >= 0 ? text.slice(i, semi) : text.slice(i)).trim();
      i = semi >= 0 ? semi + 1 : text.length;
    }
    if (key) map[key] = value;
  }
  return map;
}

export function parseDataSource(value: string): { host: string; port: number; instance?: string } {
  let v = value.trim().replace(/^tcp:/i, "");
  let port = 1433;
  let instance: string | undefined;
  const comma = v.lastIndexOf(",");
  if (comma > 0 && /^\d+$/.test(v.slice(comma + 1).trim())) {
    port = Number.parseInt(v.slice(comma + 1).trim(), 10);
    v = v.slice(0, comma);
  }
  const slash = v.indexOf("\\");
  if (slash >= 0) {
    instance = v.slice(slash + 1) || undefined;
    v = v.slice(0, slash);
  }
  return { host: v.trim() || "127.0.0.1", port, instance };
}

function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off", "disable", "disabled"].includes(v)) return false;
  if (["true", "yes", "1", "on", "enable", "enabled", "mandatory"].includes(v)) return true;
  return fallback;
}
