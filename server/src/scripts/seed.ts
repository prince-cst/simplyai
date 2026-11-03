import { MongoClient } from "mongodb";
import { env } from "../config/env.js";
import { seedTestShopDatabase } from "../seed/seedTestShopDatabase.js";

const uri = env.mongoUri;
const dbName = env.testDatabaseName;

async function main(): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const result = await seedTestShopDatabase(db);
    console.log("Seeded test database successfully.");
    console.log(`Database: ${result.database}`);
    console.log(`shops: ${result.shops}`);
    console.log(`products: ${result.products}`);
    console.log(`customers: ${result.customers}`);
    console.log(`orders: ${result.orders}`);
    console.log("");
    console.log("Connect in the app with:");
    console.log(`${uri.replace(/\/$/, "")}/${dbName}`);
  } catch (error) {
    console.error("Unable to seed the test database.");
    console.error("Check:");
    console.error("- MongoDB is running locally (default mongodb://127.0.0.1:27017)");
    console.error("- MONGODB_URI in server/.env");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
  }
}

void main();
