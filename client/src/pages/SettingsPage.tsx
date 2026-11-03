import { SettingsPanel } from "@/components/SettingsPanel";
import { PageHeader } from "@/components/ui";

export function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="AI keys and MongoDB connections are saved in this project’s local store and restored after the API restarts."
      />
      <SettingsPanel />
    </div>
  );
}
