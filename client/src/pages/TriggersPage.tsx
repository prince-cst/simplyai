import { PageHeader } from "@/components/ui";
import { TriggersPanel } from "@/components/TriggersPanel";

export function TriggersPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Triggers"
        subtitle="Describe an alert in plain English — Simply AI proposes the schedule, filters, and email."
      />
      <TriggersPanel />
    </div>
  );
}
