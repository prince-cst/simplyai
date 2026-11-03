/**
 * Future-ready MongoDB access port.
 * Version 1 uses the official Node driver directly.
 * A MongoDB MCP adapter can implement this later without changing chat/query code.
 */
export interface MongoDataSource {
  listCollectionNames(): Promise<string[]>;
  estimatedCount(collection: string): Promise<number>;
  sample(collection: string, limit: number): Promise<Record<string, unknown>[]>;
}
