import { Link } from "react-router-dom";
import { Card } from "@/components/ui";

export function DatabaseExplorer({
  database,
  collections
}: {
  database: string;
  collections: { name: string; estimatedCount: number }[];
}) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-slate-500">Database Explorer</p>
      <h2 className="mt-1 text-lg font-semibold">{database}</h2>
      <p className="mt-4 text-sm font-medium">Collections</p>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {collections.map((c) => (
          <li key={c.name}>
            <Link
              to={`/collections/${encodeURIComponent(c.name)}`}
              className="flex items-center justify-between py-2 text-sm hover:text-teal-700"
            >
              <span>▸ {c.name}</span>
              <span className="font-mono text-xs text-slate-400">{c.estimatedCount.toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
