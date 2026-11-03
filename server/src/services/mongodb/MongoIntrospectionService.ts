import type { Db, Document } from "mongodb";
import { toJsonSafe } from "../../utils/bson.js";
import type { CollectionSchema } from "../../types/index.js";
import { inferFieldsFromDocuments } from "./SchemaInferenceService.js";

export interface IntrospectionOptions {
  sampleDocumentsPerCollection: number;
}

export async function listCollectionNames(db: Db): Promise<string[]> {
  const cols = await db.listCollections({}, { nameOnly: true }).toArray();
  return cols
    .map((c) => c.name)
    .filter((name) => !name.startsWith("system."))
    .sort((a, b) => a.localeCompare(b));
}

export async function introspectDatabase(
  db: Db,
  options: IntrospectionOptions
): Promise<CollectionSchema[]> {
  const names = await listCollectionNames(db);
  const sampleSize = Math.max(1, Math.min(50, options.sampleDocumentsPerCollection));
  const collections: CollectionSchema[] = [];

  for (const name of names) {
    const col = db.collection(name);
    let estimatedCount = 0;
    try {
      estimatedCount = await col.estimatedDocumentCount();
    } catch {
      estimatedCount = 0;
    }

    let samples: Document[] = [];
    try {
      samples = await col
        .aggregate([{ $sample: { size: sampleSize } }], { maxTimeMS: 8000 })
        .toArray();
    } catch {
      samples = await col.find({}).limit(sampleSize).maxTimeMS(8000).toArray();
    }

    const jsonSamples = samples.map((doc) => toJsonSafe(doc) as Record<string, unknown>);
    const fields = inferFieldsFromDocuments(samples);

    collections.push({
      name,
      estimatedCount,
      sampleSize: samples.length,
      fields,
      sampleDocuments: jsonSamples.slice(0, Math.min(5, jsonSamples.length))
    });
  }

  return collections;
}

export async function sampleCollection(
  db: Db,
  collection: string,
  limit: number
): Promise<Record<string, unknown>[]> {
  const cap = Math.max(1, Math.min(20, limit));
  const docs = await db
    .collection(collection)
    .find({})
    .limit(cap)
    .maxTimeMS(8000)
    .toArray();
  return docs.map((doc) => toJsonSafe(doc) as Record<string, unknown>);
}
