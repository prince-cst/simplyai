import type { CollectionSchema, DatabaseSchema, FieldSchema } from "../../types/index.js";
import { OUTLOOK_FOLDERS } from "./types.js";

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

/** Virtual schema so the AI planner knows which Outlook folders/ranges it can query. */
export function buildOutlookSchema(accountLabel: string): DatabaseSchema {
  const mailFields = [
    field("id", "string", { isPossibleId: true }),
    field("subject", "string"),
    field("from", "string"),
    field("fromAddress", "string"),
    field("receivedDateTime", "date"),
    field("bodyPreview", "string"),
    field("body", "string"),
    field("isRead", "boolean"),
    field("hasAttachments", "boolean"),
    field("importance", "string")
  ];

  const collections: CollectionSchema[] = [
    ...OUTLOOK_FOLDERS.map((name) =>
      collection(
        name,
        mailFields,
        `Outlook folder. Use operation "outlook" with collection "${name}". Prefer range "today" for daily summaries.`
      )
    ),
    collection(
      "MailSummary",
      [
        field("range", "string"),
        field("unreadOnly", "boolean"),
        field("folder", "string"),
        field("includeBody", "boolean")
      ],
      'Use for questions like "summarize today\'s mail". operation "outlook", collection "MailSummary" or "Inbox", outlook.range "today".'
    )
  ];

  return {
    database: accountLabel || "Outlook",
    collections,
    relationships: [],
    introspectedAt: new Date().toISOString(),
    summary: {
      collectionCount: collections.length,
      estimatedDocuments: 0,
      relationshipCount: 0,
      dateFieldCount: 1,
      numericFieldCount: 0
    }
  };
}
