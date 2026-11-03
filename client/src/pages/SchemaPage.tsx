import { SchemaViewer } from "@/components/SchemaViewer";
import { Button, PageHeader } from "@/components/ui";
import { useRefreshSchema } from "@/hooks/useMongo";
import { toast } from "sonner";
import { ApiError } from "@/types/api";

export function SchemaPage() {
  const refresh = useRefreshSchema();
  return (
    <div>
      <PageHeader
        title="Schema"
        subtitle="Compact schema context used by the query planner. Relationships are inferred, not guaranteed."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: () => toast.success("Schema refreshed"),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed")
              })
            }
          >
            Refresh Schema
          </Button>
        }
      />
      <SchemaViewer />
    </div>
  );
}
