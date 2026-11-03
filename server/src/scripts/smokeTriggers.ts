/**
 * Smoke test: seed expiry docs on local Mongo, evaluate two windows.
 * Run: npx tsx src/scripts/smokeTriggers.ts
 * Optional email: set SMOKE_SEND_EMAIL=1
 */
import { MongoClient } from "mongodb";
import { v4 as uuid } from "uuid";
import {
  configureAppStore,
  setSavedConnections,
  upsertTrigger,
  removeTrigger
} from "../config/appStore.js";
import { env } from "../config/env.js";
import type { TriggerDefinition } from "../types/index.js";
import { evaluateTriggerWindow } from "../services/triggers/TriggerEvaluator.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";
import { isSmtpConfigured, sendAlertEmail } from "../services/triggers/EmailService.js";

async function main(): Promise<void> {
  const uri = env.mongoUri;
  const dbName = "trigger_smoke_db";
  configureAppStore({ persist: false });

  const seedClient = new MongoClient(uri);
  await seedClient.connect();
  const col = seedClient.db(dbName).collection("trigger_smoke_docs");
  await col.deleteMany({});
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  await col.insertMany([
    { name: "Doc A (75d)", expiresAt: new Date(now + 75 * day) },
    { name: "Doc B (45d)", expiresAt: new Date(now + 45 * day) },
    { name: "Doc C (10d)", expiresAt: new Date(now + 10 * day) },
    { name: "Doc D (120d)", expiresAt: new Date(now + 120 * day) }
  ]);
  await seedClient.close();
  console.log("Seeded", dbName, "trigger_smoke_docs");

  const connectionId = uuid();
  const nowIso = new Date().toISOString();
  setSavedConnections(
    [
      {
        id: connectionId,
        name: "smoke-local",
        uri,
        engine: "mongodb",
        databaseName: dbName,
        createdAt: nowIso,
        lastUsedAt: nowIso
      }
    ],
    connectionId
  );

  await mongoConnectionManager.ensureLiveForConnection(connectionId);

  const trigger: TriggerDefinition = {
    id: uuid(),
    name: "Smoke expiry alert",
    connectionId,
    status: "draft",
    userPrompt: "smoke",
    explanation: "Smoke test trigger",
    target: {
      engine: "mongodb",
      collectionOrTable: "trigger_smoke_docs",
      dateField: "expiresAt"
    },
    windows: [
      {
        id: "w-monthly",
        label: "90-60 monthly",
        condition: { kind: "daysUntil", minDays: 60, maxDays: 90 },
        schedule: { cron: "0 9 1 * *", timezone: env.timezone },
        dedupeBucket: "month"
      },
      {
        id: "w-daily",
        label: "60-30 daily",
        condition: { kind: "daysUntil", minDays: 30, maxDays: 60 },
        schedule: { cron: "0 9 * * *", timezone: env.timezone },
        dedupeBucket: "day"
      }
    ],
    email: {
      to: [env.smtpUser || "test@example.com"],
      subjectTemplate: "Smoke {{name}} {{matchCount}}",
      bodyTemplate: "{{rows}}"
    },
    createdAt: nowIso,
    updatedAt: nowIso,
    recentRuns: [],
    notifiedKeys: []
  };

  upsertTrigger(trigger);

  const monthly = await evaluateTriggerWindow(trigger, trigger.windows[0]!);
  const daily = await evaluateTriggerWindow(trigger, trigger.windows[1]!);
  console.log("Monthly window (60-90) matches:", monthly.rows.map((r) => r.name));
  console.log("Daily window (30-60) matches:", daily.rows.map((r) => r.name));

  const monthlyOk = monthly.rows.some((r) => r.name === "Doc A (75d)");
  const dailyOk = daily.rows.some((r) => r.name === "Doc B (45d)");
  if (!monthlyOk || !dailyOk) {
    console.error("Window matching failed", { monthly: monthly.rows, daily: daily.rows });
    process.exit(1);
  }

  console.log("SMTP configured:", isSmtpConfigured());
  if (isSmtpConfigured() && process.env.SMOKE_SEND_EMAIL === "1") {
    await sendAlertEmail({
      to: [env.smtpUser],
      subject: "Trigger smoke test",
      text: `Monthly: ${monthly.rows.map((r) => r.name).join(", ")}\nDaily: ${daily.rows.map((r) => r.name).join(", ")}`
    });
    console.log("Smoke email sent to", env.smtpUser);
  }

  removeTrigger(trigger.id);
  console.log("Smoke OK");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
