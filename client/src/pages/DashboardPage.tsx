import { Link } from "react-router-dom";
import {
  MessageSquare,
  Database,
  Table2,
  Bell,
  ArrowRight
} from "lucide-react";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Badge, PageHeader, SectionLabel, Skeleton } from "@/components/ui";
import { useMongoStatus, useSchema } from "@/hooks/useMongo";
import { engineLabel, isExternalAppEngine, isOutlookEngine, isQuickBooksEngine } from "@/lib/engines";
import { formatDate } from "@/lib/utils";

const STEPS = [
  {
    to: "/connections",
    label: "Connect",
    desc: "Database, QuickBooks, or Outlook",
    icon: Database
  },
  {
    to: "/explorer",
    label: "Explore",
    desc: "Tables, fields, and samples",
    icon: Table2
  },
  {
    to: "/chat",
    label: "Ask",
    desc: "Chat with Simply AI",
    icon: MessageSquare
  },
  {
    to: "/triggers",
    label: "Alert",
    desc: "Email triggers on live data",
    icon: Bell
  }
];

export function DashboardPage() {
  const status = useMongoStatus();
  const schema = useSchema();
  const summary = schema.data?.schema.summary ?? status.data?.schemaSummary;
  const engine = status.data?.engine;
  const connected = Boolean(status.data?.connected);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Simply AI"
        subtitle="Connect your data, explore structure, then ask questions in plain English."
        actions={
          <Link
            to="/chat"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700"
          >
            Open Chat
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {/* Compact workflow strip */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="group flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-brand-500/40 dark:border-slate-800 dark:bg-slate-900/40"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-600/20 dark:text-teal-300">
              <s.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold">{s.label}</p>
              <p className="text-[10px] leading-snug text-slate-400">{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <SectionLabel>Status</SectionLabel>
          <ConnectionStatus />

          {summary && !isExternalAppEngine(engine) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="mb-2 flex items-center gap-1.5">
                <p className="text-xs font-semibold">{engineLabel(engine)} summary</p>
                <Badge tone="teal">Live</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Tables" value={summary.collectionCount} />
                <Stat label="Est. rows" value={summary.estimatedDocuments} />
                <Stat label="Relations" value={summary.relationshipCount} />
                <Stat label="Date fields" value={summary.dateFieldCount} />
              </div>
              <p className="mt-2 text-[10px] text-slate-400">
                Numeric: {summary.numericFieldCount}
                {schema.data?.introspectedAt ? ` · ${formatDate(schema.data.introspectedAt)}` : ""}
              </p>
            </div>
          ) : status.isLoading ? (
            <Skeleton className="h-20" />
          ) : connected && isQuickBooksEngine(engine) ? (
            <HintCard
              title="QuickBooks ready"
              body="Ask about P&L, aging, invoices, and cash in Chat."
            />
          ) : connected && isOutlookEngine(engine) ? (
            <HintCard
              title="Outlook ready"
              body="Ask for today's mail summary, unread highlights, or action items."
            />
          ) : !connected ? (
            <HintCard
              title="Get started"
              body="Add MongoDB, MySQL, SQL Server, QuickBooks, or Outlook under Connections."
            />
          ) : null}
        </div>

        <div>
          <SectionLabel className="mb-1.5">Tips</SectionLabel>
          <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
            <li>
              Use the header <span className="font-medium">Chat with</span> picker to switch sources.
            </li>
            <li>Explorer shows fields Simply AI can query — refresh after schema changes.</li>
            <li>Triggers send email alerts on expiry windows or new rows (databases only).</li>
            <li>Past chats appear under Recents beside the conversation — click one to continue.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/40">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function HintCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{body}</p>
    </div>
  );
}
