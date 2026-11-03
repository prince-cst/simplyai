import { ConnectionForm } from "@/components/ConnectionForm";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { AIProviderSettings } from "@/components/AIProviderSettings";
import { Badge, Card, Input } from "@/components/ui";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";

export function SettingsPanel() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const data = settings.data;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">MongoDB</h2>
        <div className="space-y-4">
          <ConnectionStatus />
          <Card>
            <ConnectionForm />
          </Card>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">AI Provider</h2>
        <AIProviderSettings />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Query Safety</h2>
        <Card className="space-y-3">
          <p>
            Read-only mode: <Badge tone="green">ON</Badge>
          </p>
          <label className="flex items-center justify-between gap-4 text-sm">
            Require query approval
            <input
              type="checkbox"
              checked={data.requireQueryApproval}
              onChange={(e) => update.mutate({ requireQueryApproval: e.target.checked })}
            />
          </label>
          <label className="block text-sm">
            Max result documents
            <Input
              className="mt-1"
              type="number"
              defaultValue={data.maxResultDocuments}
              onBlur={(e) => update.mutate({ maxResultDocuments: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            Query timeout (ms)
            <Input
              className="mt-1"
              type="number"
              defaultValue={data.queryTimeoutMs}
              onBlur={(e) => update.mutate({ queryTimeoutMs: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            Max pipeline stages
            <Input
              className="mt-1"
              type="number"
              defaultValue={data.maxPipelineStages}
              onBlur={(e) => update.mutate({ maxPipelineStages: Number(e.target.value) })}
            />
          </label>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Introspection</h2>
        <Card className="space-y-3">
          <label className="block text-sm">
            Sample documents per collection
            <Input
              className="mt-1"
              type="number"
              defaultValue={data.sampleDocumentsPerCollection}
              onBlur={(e) => update.mutate({ sampleDocumentsPerCollection: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            Timezone
            <Input className="mt-1" defaultValue={data.timezone} onBlur={(e) => update.mutate({ timezone: e.target.value })} />
          </label>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Developer Mode</h2>
        <Card>
          <label className="flex items-center justify-between gap-4 text-sm">
            Show schema context, provider, query plan, and validation details
            <input
              type="checkbox"
              checked={data.developerMode}
              onChange={(e) => update.mutate({ developerMode: e.target.checked })}
            />
          </label>
        </Card>
      </section>
    </div>
  );
}
