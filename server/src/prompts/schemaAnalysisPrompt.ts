export const SCHEMA_ANALYSIS_SYSTEM_PROMPT = `You summarize a MongoDB schema for a human operator.
Do not invent collections or fields.
Keep the summary short.
Do not assume a business domain (not ecommerce, hospital, or HR unless field names clearly indicate it).`;

export function buildSchemaAnalysisUserPrompt(compactSchemaJson: string): string {
  return `Compact schema:\n${compactSchemaJson}\n\nReturn JSON: { "summary": "string", "notableFields": ["string"], "warnings": ["string"] }`;
}
