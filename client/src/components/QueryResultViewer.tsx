import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { formatNumber, isRecord } from "@/lib/utils";
import type { QueryPlan } from "@/types/api";

const COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#06b6d4", "#84cc16"];

function rowsFromDocuments(documents: unknown[]): Record<string, unknown>[] {
  return documents.map((d) => (isRecord(d) ? d : { value: d }));
}

export function ResultTable({ documents }: { documents: unknown[] }) {
  const rows = rowsFromDocuments(documents);
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!rows.length) {
    return <p className="text-sm text-slate-500">No rows returned.</p>;
  }
  return (
    <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 font-mono text-xs">
                  {formatNumber(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultChart({
  documents,
  visualization
}: {
  documents: unknown[];
  visualization?: QueryPlan["visualization"];
}) {
  if (!visualization || visualization.type === "none" || visualization.type === "table" || visualization.type === "metric") {
    return null;
  }
  const rows = rowsFromDocuments(documents);
  const x = visualization.xField ?? Object.keys(rows[0] ?? {}).find((k) => k !== visualization.yField) ?? "_id";
  const y = visualization.yField ?? Object.keys(rows[0] ?? {}).find((k) => k !== x && typeof rows[0]?.[k] === "number") ?? "value";
  const data = rows.map((r) => ({
    name: String(r[x] ?? r._id ?? ""),
    value: typeof r[y] === "number" ? r[y] : Number(r[y] ?? 0)
  }));
  if (data.length < 2 && visualization.type !== "pie") return null;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        {visualization.type === "line" ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={2} />
          </LineChart>
        ) : visualization.type === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={90}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#0d9488" radius={[6, 6, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
