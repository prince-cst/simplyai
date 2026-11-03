import { useParams } from "react-router-dom";
import { CollectionDetails } from "@/components/CollectionDetails";
import { PageHeader } from "@/components/ui";

export function CollectionDetailPage() {
  const { name } = useParams();
  return (
    <div>
      <PageHeader title={name ?? "Collection"} subtitle="Inferred fields, types, and a limited sample of documents." />
      {name ? <CollectionDetails name={name} /> : null}
    </div>
  );
}
