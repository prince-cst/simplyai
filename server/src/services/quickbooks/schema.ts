import type { CollectionSchema, DatabaseSchema, FieldSchema } from "../../types/index.js";
import { QBO_ENTITIES, QBO_REPORTS } from "./types.js";

function field(path: string, type: FieldSchema["type"], opts?: Partial<FieldSchema>): FieldSchema {
  return {
    path,
    type,
    typesSeen: [type],
    enumSamples: [],
    isPossibleId: Boolean(opts?.isPossibleId),
    isPossibleDate: type === "date" || Boolean(opts?.isPossibleDate),
    isNumeric: type === "number" || type === "integer" || type === "decimal" || Boolean(opts?.isNumeric),
    ...opts
  };
}

function collection(name: string, fields: FieldSchema[], note: string): CollectionSchema {
  return {
    name,
    estimatedCount: 0,
    sampleSize: 0,
    fields,
    sampleDocuments: [{ _note: note }]
  };
}

/** Virtual schema so the AI planner knows which QB reports/entities it can call. */
export function buildQuickBooksSchema(companyName: string): DatabaseSchema {
  const reportFields = [
    field("reportName", "string"),
    field("start_date", "date"),
    field("end_date", "date"),
    field("date_macro", "string"),
    field("accounting_method", "string"),
    field("aging_period", "number", { isNumeric: true }),
    field("summarize_column_by", "string")
  ];

  const entityFields = [
    field("Id", "string", { isPossibleId: true }),
    field("DisplayName", "string"),
    field("Name", "string"),
    field("Balance", "number", { isNumeric: true }),
    field("TotalAmt", "number", { isNumeric: true }),
    field("DueDate", "date"),
    field("TxnDate", "date"),
    field("BalanceRemaining", "number", { isNumeric: true })
  ];

  const collections: CollectionSchema[] = [
    ...QBO_REPORTS.map((name) =>
      collection(
        name,
        reportFields,
        `QuickBooks report. Use operation "qbo" with action "report" and reportName "${name}". For overdue > 90 days prefer AgedReceivables or AgedReceivableDetail.`
      )
    ),
    ...QBO_ENTITIES.map((name) =>
      collection(
        name,
        entityFields,
        `QuickBooks entity. Use operation "qbo" with action "query" and a QuickBooks query language string, e.g. SELECT * FROM ${name} MAXRESULTS 20`
      )
    )
  ];

  const dateFieldCount = collections.reduce(
    (n, c) => n + c.fields.filter((f) => f.isPossibleDate || f.type === "date").length,
    0
  );
  const numericFieldCount = collections.reduce((n, c) => n + c.fields.filter((f) => f.isNumeric).length, 0);

  return {
    database: companyName || "QuickBooks",
    collections,
    relationships: [],
    introspectedAt: new Date().toISOString(),
    summary: {
      collectionCount: collections.length,
      estimatedDocuments: 0,
      relationshipCount: 0,
      dateFieldCount,
      numericFieldCount
    }
  };
}
