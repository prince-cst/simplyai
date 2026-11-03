import { describe, expect, it } from "vitest";
import {
  isMaskedSecret,
  looksLikeMssql,
  parseMssqlTarget,
  parseMssqlConnectionString,
  toMssqlUri
} from "../src/services/sql/mssqlUri.js";
import { applyMssqlRowLimit } from "../src/services/sql/MssqlQueryExecutionService.js";
import { maskConnectionString } from "../src/utils/mask.js";

describe("SQL Server ADO.NET connection strings", () => {
  it("parses an SSMS / Azure SQL connection string", () => {
    const raw =
      'Data Source=sqlsrv-medpacs-dev.database.windows.net;Persist Security Info=True;User ID=dicomdbadmin;Password=Secret123!;Pooling=False;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=True;Application Name="SQL Server Management Studio";Command Timeout=0';
    expect(looksLikeMssql(raw)).toBe(true);
    const target = parseMssqlConnectionString(raw);
    expect(target.host).toBe("sqlsrv-medpacs-dev.database.windows.net");
    expect(target.port).toBe(1433);
    expect(target.user).toBe("dicomdbadmin");
    expect(target.password).toBe("Secret123!");
    expect(target.encrypt).toBe(true);
    expect(target.trustServerCertificate).toBe(true);
    expect(target.database).toBeUndefined();
    const uri = toMssqlUri(target);
    expect(uri.startsWith("mssql://")).toBe(true);
    expect(maskConnectionString(uri)).toContain("********");
    expect(maskConnectionString(uri)).not.toContain("Secret123!");
  });

  it("requires a real password when the pasted string is masked", () => {
    const raw =
      "Data Source=sqlsrv-medpacs-dev.database.windows.net;User ID=dicomdbadmin;Password=●●●●●●;Encrypt=True";
    expect(isMaskedSecret("●●●●●●")).toBe(true);
    expect(() => parseMssqlTarget({ connectionString: raw })).toThrow(/masked password/i);
    const target = parseMssqlTarget({ connectionString: raw, password: "RealPass!" });
    expect(target.password).toBe("RealPass!");
  });

  it("rewrites MySQL LIMIT into T-SQL TOP", () => {
    expect(applyMssqlRowLimit("SELECT id FROM studies LIMIT 20", 50)).toBe("SELECT TOP (50) id FROM studies");
    expect(applyMssqlRowLimit("SELECT TOP (10) id FROM studies", 50)).toBe("SELECT TOP (10) id FROM studies");
  });
});
