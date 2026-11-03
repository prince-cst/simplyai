import type { ConnectionPool } from "mssql";
import type { CollectionSchema, DatabaseSchema, FieldSchema, FieldType, Relationship } from "../../types/index.js";
import { buildDatabaseSchema } from "../mongodb/SchemaInferenceService.js";

const SKIP_DATABASES = new Set(["master", "tempdb", "model", "msdb"]);

interface TableRow {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  TABLE_ROWS: number | null;
}

interface ColumnRow {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_KEY: string;
}

interface FkRow {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

function mapMssqlType(dataType: string): FieldType {
  const t = dataType.toLowerCase();
  if (["date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time"].includes(t)) return "date";
  if (["int", "tinyint", "smallint", "bigint"].includes(t)) return "integer";
  if (["decimal", "numeric", "float", "real", "money", "smallmoney"].includes(t)) return "decimal";
  if (t === "bit") return "boolean";
  if (["binary", "varbinary", "image", "rowversion", "timestamp"].includes(t)) return "binary";
  return "string";
}

export function quoteMssqlIdent(name: string): string {
  return name
    .replace(/[\[\]]/g, "")
    .split(".")
    .filter(Boolean)
    .map((part) => `[${part.replace(/]/g, "]]")}]`)
    .join(".");
}

function tableName(schema: string, name: string): string {
  if (!schema || schema.toLowerCase() === "dbo") return name;
  return `${schema}.${name}`;
}

export async function listMssqlDatabases(pool: ConnectionPool): Promise<string[]> {
  const result = await pool.request().query<{ name: string }>(
    `SELECT name
     FROM sys.databases
     WHERE state_desc = 'ONLINE'
       AND name NOT IN ('master', 'tempdb', 'model', 'msdb')
     ORDER BY name`
  );
  return (result.recordset ?? [])
    .map((row) => row.name)
    .filter((name) => name && !SKIP_DATABASES.has(name.toLowerCase()));
}

export async function introspectMssqlDatabase(pool: ConnectionPool, database: string): Promise<DatabaseSchema> {
  const tableList = await pool.request().query<TableRow>(
    `SELECT SCHEMA_NAME(t.schema_id) AS TABLE_SCHEMA,
            t.name AS TABLE_NAME,
            CAST(SUM(p.rows) AS BIGINT) AS TABLE_ROWS
     FROM sys.tables t
     LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
     WHERE t.is_ms_shipped = 0
     GROUP BY SCHEMA_NAME(t.schema_id), t.name
     ORDER BY TABLE_SCHEMA, TABLE_NAME`
  );

  const columnList = await pool.request().input("db", database).query<ColumnRow>(
    `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
            CASE WHEN pk.COLUMN_NAME IS NULL THEN '' ELSE 'PRI' END AS COLUMN_KEY
     FROM INFORMATION_SCHEMA.COLUMNS c
     LEFT JOIN (
       SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
         ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
        AND tc.TABLE_NAME = ku.TABLE_NAME
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
         AND tc.TABLE_CATALOG = @db
     ) pk
       ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
     WHERE c.TABLE_CATALOG = @db
     ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
  );

  const fkList = await pool.request().query<FkRow>(
    `SELECT
        OBJECT_SCHEMA_NAME(fk.parent_object_id) AS TABLE_SCHEMA,
        OBJECT_NAME(fk.parent_object_id) AS TABLE_NAME,
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS COLUMN_NAME,
        OBJECT_NAME(fk.referenced_object_id) AS REFERENCED_TABLE_NAME,
        COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS REFERENCED_COLUMN_NAME
     FROM sys.foreign_keys fk
     JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id`
  );

  const tables = tableList.recordset ?? [];
  const columns = columnList.recordset ?? [];
  const fks = fkList.recordset ?? [];
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const col of columns) {
    const key = tableName(col.TABLE_SCHEMA, col.TABLE_NAME);
    const list = colsByTable.get(key) ?? [];
    list.push(col);
    colsByTable.set(key, list);
  }

  const collections: CollectionSchema[] = [];
  for (const table of tables) {
    const name = tableName(table.TABLE_SCHEMA, table.TABLE_NAME);
    const tableCols = colsByTable.get(name) ?? [];
    const fields: FieldSchema[] = tableCols.map((col) => {
      const type = mapMssqlType(col.DATA_TYPE);
      return {
        path: col.COLUMN_NAME,
        type,
        typesSeen: [type],
        enumSamples: [],
        isPossibleId: col.COLUMN_KEY === "PRI" || /id$/i.test(col.COLUMN_NAME),
        isPossibleDate: type === "date",
        isNumeric: type === "integer" || type === "decimal" || type === "number"
      };
    });
    let sampleDocuments: Record<string, unknown>[] = [];
    try {
      const sample = await pool.request().query(`SELECT TOP (5) * FROM ${quoteMssqlIdent(name)}`);
      sampleDocuments = (sample.recordset ?? []) as Record<string, unknown>[];
    } catch {
      sampleDocuments = [];
    }
    collections.push({
      name,
      estimatedCount: Number(table.TABLE_ROWS ?? 0),
      sampleSize: sampleDocuments.length,
      fields,
      sampleDocuments
    });
  }

  const schema = buildDatabaseSchema(database, collections);
  const relationships: Relationship[] = fks.map((fk) => ({
    fromCollection: tableName(fk.TABLE_SCHEMA, fk.TABLE_NAME),
    fromField: fk.COLUMN_NAME,
    toCollection: fk.REFERENCED_TABLE_NAME,
    toField: fk.REFERENCED_COLUMN_NAME,
    confidence: 0.95,
    reason: "Declared SQL Server foreign key"
  }));
  return {
    ...schema,
    relationships: relationships.length ? relationships : schema.relationships
  };
}
