import type { Pool } from "mysql2/promise";
import type { CollectionSchema, DatabaseSchema, FieldSchema, FieldType, Relationship } from "../../types/index.js";
import { buildDatabaseSchema } from "../mongodb/SchemaInferenceService.js";

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_KEY: string;
  COLUMN_TYPE?: string;
}

interface TableRow {
  TABLE_NAME: string;
  TABLE_ROWS: number | null;
}

interface FkRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

const SKIP_SCHEMAS = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

function mapMysqlType(dataType: string): FieldType {
  const t = dataType.toLowerCase();
  if (["date", "datetime", "timestamp", "time", "year"].includes(t)) return "date";
  if (["int", "tinyint", "smallint", "mediumint", "bigint"].includes(t)) return "integer";
  if (["decimal", "numeric", "float", "double", "real"].includes(t)) return "decimal";
  if (["bit", "bool", "boolean"].includes(t)) return "boolean";
  if (["blob", "binary", "varbinary"].includes(t)) return "binary";
  if (["json"].includes(t)) return "object";
  return "string";
}

export async function listMysqlDatabases(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query("SHOW DATABASES");
  if (!Array.isArray(rows)) return [];
  return (rows as Array<Record<string, string>>)
    .map((row) => Object.values(row)[0] ?? "")
    .filter((name) => name && !SKIP_SCHEMAS.has(name.toLowerCase()));
}

export async function introspectMysqlDatabase(pool: Pool, database: string): Promise<DatabaseSchema> {
  const [tableRows] = await pool.query(
    `SELECT TABLE_NAME, TABLE_ROWS
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [database]
  );
  const [columnRows] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY, COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database]
  );
  const [fkRows] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [database]
  );

  const tables = Array.isArray(tableRows) ? (tableRows as TableRow[]) : [];
  const columns = Array.isArray(columnRows) ? (columnRows as ColumnRow[]) : [];
  const fks = Array.isArray(fkRows) ? (fkRows as FkRow[]) : [];
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const col of columns) {
    const list = colsByTable.get(col.TABLE_NAME) ?? [];
    list.push(col);
    colsByTable.set(col.TABLE_NAME, list);
  }

  const collections: CollectionSchema[] = [];
  for (const table of tables) {
    const tableCols = colsByTable.get(table.TABLE_NAME) ?? [];
    const fields: FieldSchema[] = tableCols.map((col) => {
      const type = mapMysqlType(col.DATA_TYPE);
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
      const [sample] = await pool.query({
        sql: `SELECT * FROM \`${database}\`.\`${table.TABLE_NAME}\` LIMIT 5`,
        timeout: 5000
      });
      if (Array.isArray(sample)) {
        sampleDocuments = sample as Record<string, unknown>[];
      }
    } catch {
      sampleDocuments = [];
    }
    collections.push({
      name: table.TABLE_NAME,
      estimatedCount: Number(table.TABLE_ROWS ?? 0),
      sampleSize: sampleDocuments.length,
      fields,
      sampleDocuments
    });
  }

  const schema = buildDatabaseSchema(database, collections);
  const relationships: Relationship[] = fks.map((fk) => ({
    fromCollection: fk.TABLE_NAME,
    fromField: fk.COLUMN_NAME,
    toCollection: fk.REFERENCED_TABLE_NAME,
    toField: fk.REFERENCED_COLUMN_NAME,
    confidence: 0.95,
    reason: "Declared MySQL foreign key"
  }));
  return {
    ...schema,
    relationships: relationships.length ? relationships : schema.relationships
  };
}
