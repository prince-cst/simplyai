import { Card } from "@/components/ui";
import { JsonViewer } from "@/components/JsonViewer";
import { useSchema } from "@/hooks/useMongo";
import { formatDate } from "@/lib/utils";

export function SchemaViewer() {
  const schema = useSchema();
  if (!schema.data) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Connect to MongoDB, MySQL, or SQL Server to generate a compact schema context.</p>
      </Card>
    );
  }
  const s = schema.data.schema;
  const compact = {
    database: s.database,
    collections: s.collections.map((c) => ({
      name: c.name,
      estimatedCount: c.estimatedCount,
      fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type]))
    })),
    relationships: s.relationships
  };
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-500">Last refreshed: {formatDate(schema.data.introspectedAt)}</p>
        <p className="mt-2 text-sm">
          This compact schema is what the AI sees. Raw sample documents are not sent to the model.
        </p>
      </Card>
      <JsonViewer title="Compact schema context" value={compact} />
      {s.relationships.length ? (
        <Card>
          <h3 className="mb-2 font-medium">Inferred relationships</h3>
          <ul className="space-y-2 text-sm">
            {s.relationships.map((r, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="font-mono text-xs">
                  {r.fromCollection}.{r.fromField} → {r.toCollection}.{r.toField}
                </p>
                <p className="mt-1 text-slate-500">
                  Confidence {r.confidence} · {r.reason}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
