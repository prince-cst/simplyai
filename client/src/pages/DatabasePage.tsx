import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Database, Cloud, Mail } from "lucide-react";
import { ConnectionForm, OutlookConnectCard, QuickBooksConnectCard } from "@/components/ConnectionForm";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { PageHeader, SectionLabel } from "@/components/ui";
import { useMongoStatus } from "@/hooks/useMongo";
import { cn } from "@/lib/utils";

type Tab = "database" | "quickbooks" | "outlook";

const TABS: { id: Tab; label: string; icon: typeof Database; hint: string }[] = [
  { id: "database", label: "Database", icon: Database, hint: "MongoDB, MySQL, or SQL Server" },
  { id: "quickbooks", label: "QuickBooks", icon: Cloud, hint: "Online company via OAuth" },
  { id: "outlook", label: "Outlook", icon: Mail, hint: "Microsoft 365 mailbox" }
];

export function DatabasePage() {
  const [params, setParams] = useSearchParams();
  const status = useMongoStatus();
  const [tab, setTab] = useState<Tab>("database");

  useEffect(() => {
    const qb = params.get("qb");
    const outlook = params.get("outlook");
    if (!qb && !outlook) return;
    if (qb === "connected") {
      toast.success("QuickBooks connected");
      setTab("quickbooks");
      void status.refetch();
    } else if (qb === "error") {
      toast.error(params.get("message") || "QuickBooks connect failed");
      setTab("quickbooks");
    }
    if (outlook === "connected") {
      toast.success("Outlook connected");
      setTab("outlook");
      void status.refetch();
    } else if (outlook === "error") {
      toast.error(params.get("message") || "Outlook connect failed");
      setTab("outlook");
    }
    const next = new URLSearchParams(params);
    next.delete("qb");
    next.delete("outlook");
    next.delete("message");
    setParams(next, { replace: true });
  }, [params, setParams, status]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Connections"
        subtitle="Add a data source, then pick it in the header to chat. Databases, QuickBooks, and Outlook stay separate."
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Add / connect panel */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex border-b border-slate-100 dark:border-slate-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium transition",
                  tab === t.id
                    ? "border-b-2 border-brand-600 text-brand-700 dark:text-teal-300"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="p-3">
            <SectionLabel className="mb-2">{TABS.find((t) => t.id === tab)?.hint}</SectionLabel>
            {tab === "database" ? <ConnectionForm /> : null}
            {tab === "quickbooks" ? <QuickBooksConnectCard /> : null}
            {tab === "outlook" ? <OutlookConnectCard /> : null}
          </div>
        </div>

        {/* Active + saved sources */}
        <div className="min-w-0">
          <SectionLabel className="mb-1.5">Active & saved</SectionLabel>
          <ConnectionStatus />
        </div>
      </div>
    </div>
  );
}
