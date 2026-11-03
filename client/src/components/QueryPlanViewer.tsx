import { JsonViewer } from "@/components/JsonViewer";
import type { QueryPlan } from "@/types/api";

export function QueryPlanViewer({ plan }: { plan: QueryPlan }) {
  if (plan.operation === "outlook") {
    return (
      <JsonViewer
        title="Outlook mail fetch"
        value={{
          operation: plan.operation,
          folder: plan.collection,
          limit: plan.limit,
          explanation: plan.explanation
        }}
      />
    );
  }
  if (plan.operation === "qbo") {
    return (
      <JsonViewer
        title="QuickBooks request"
        value={{
          operation: plan.operation,
          collection: plan.collection,
          limit: plan.limit,
          explanation: plan.explanation
        }}
      />
    );
  }
  if (plan.sql) {
    return <JsonViewer title="SQL" value={{ sql: plan.sql, tables: plan.collectionsUsed, dateIntents: plan.dateIntents }} />;
  }
  const query = {
    operation: plan.operation,
    collection: plan.collection,
    filter: plan.filter,
    pipeline: plan.pipeline,
    projection: plan.projection,
    sort: plan.sort,
    limit: plan.limit,
    distinctField: plan.distinctField,
    dateIntents: plan.dateIntents
  };
  return <JsonViewer title="MongoDB Query" value={query} />;
}

export function queryPlanCollapsibleTitle(plan: QueryPlan): string {
  if (plan.operation === "outlook") return "Mail fetch details";
  if (plan.operation === "qbo") return "QuickBooks request";
  if (plan.sql) return "SQL query";
  return "MongoDB query";
}
