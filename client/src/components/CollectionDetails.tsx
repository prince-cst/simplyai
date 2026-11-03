import { Badge, Button, Card } from "@/components/ui";
import { JsonViewer } from "@/components/JsonViewer";
import { useCollection, useSample } from "@/hooks/useMongo";

export function CollectionDetails({ name }: { name: string }) {
  const details = useCollection(name);
  const sample = useSample(name, 10);
  const collection = details.data?.collection;

  if (details.isLoading || !collection) {
    return <p className="text-sm text-slate-500">Loading collection…</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs uppercase tracking-wide text-slate-500">Collection</p>
        <h2 className="text-xl font-semibold">{collection.name}</h2>
        <p className="mt-2 text-sm text-slate-500">
          Estimated Documents: {collection.estimatedCount.toLocaleString()} · Sample size: {collection.sampleSize}
        </p>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-2">Field</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {collection.fields.map((f) => (
                <tr key={f.path} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 font-mono text-xs">{f.path}</td>
                  <td>
                    <Badge>{f.type}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">View sample data</h3>
          <Button variant="outline" size="sm" onClick={() => void sample.refetch()}>
            Refresh
          </Button>
        </div>
        {sample.data ? <JsonViewer title="Sample documents (max 20)" value={sample.data.documents} /> : null}
      </Card>
    </div>
  );
}
