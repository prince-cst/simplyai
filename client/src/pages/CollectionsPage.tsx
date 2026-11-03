import { DatabaseExplorer } from "@/components/DatabaseExplorer";
import { PageHeader, Skeleton } from "@/components/ui";
import { useSchema } from "@/hooks/useMongo";

export function CollectionsPage() {
  const schema = useSchema();
  return (
    <div>
      <PageHeader title="Collections" subtitle="Browse discovered collections from the current database." />
      {schema.isLoading ? (
        <Skeleton className="h-64" />
      ) : schema.data ? (
        <DatabaseExplorer
          database={schema.data.schema.database}
          collections={schema.data.schema.collections.map((c) => ({
            name: c.name,
            estimatedCount: c.estimatedCount
          }))}
        />
      ) : (
        <p className="text-sm text-slate-500">Connect to MongoDB, MySQL, or SQL Server to list collections and tables.</p>
      )}
    </div>
  );
}
