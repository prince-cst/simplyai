import { TestCenter } from "@/components/TestCenter";
import { PageHeader } from "@/components/ui";

export function TestCenterPage() {
  return (
    <div>
      <PageHeader
        title="AI & Database Test Center"
        subtitle="Each test performs a real operation and reports PASS or FAIL with details."
      />
      <TestCenter />
    </div>
  );
}
