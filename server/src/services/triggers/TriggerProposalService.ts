import { v4 as uuid } from "uuid";
import { getAppStore } from "../../config/appStore.js";
import { TriggerProposalSchema } from "../../schemas/trigger.js";
import { env } from "../../config/env.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import type { TriggerDefinition, TriggerEngine } from "../../types/index.js";
import { AppError } from "../../utils/errors.js";
import { createAIProvider } from "../ai/AIProviderFactory.js";
import { completeJsonWithRetry } from "../ai/jsonComplete.js";
import { toCompactSchema } from "../mongodb/SchemaInferenceService.js";
import { getOrCreateSession } from "../session/SessionStore.js";
import { mongoConnectionManager } from "../mongodb/MongoConnectionManager.js";
import { refreshSchema } from "../schemaRefresh.js";
import {
  TRIGGER_PROPOSAL_SYSTEM_PROMPT,
  buildTriggerProposalUserPrompt
} from "../../prompts/triggerProposalPrompt.js";
import { currentDateContext } from "../../utils/dates.js";
import { logger } from "../../utils/logger.js";
import { inferDedupeBucket } from "./TriggerService.js";

export interface TriggerProposalResult {
  proposal: {
    name: string;
    explanation: string;
    connectionId: string;
    userPrompt: string;
    target: TriggerDefinition["target"];
    windows: TriggerDefinition["windows"];
    email: TriggerDefinition["email"];
  };
  provider: string;
  model: string;
}

export async function proposeTrigger(input: {
  sessionId: string;
  prompt: string;
  connectionId?: string;
}): Promise<TriggerProposalResult> {
  const session = getOrCreateSession(input.sessionId);
  await mongoConnectionManager.ensureLive(input.sessionId);

  const connectionId =
    input.connectionId || session.activeConnectionId || getAppStore().activeConnectionId;
  if (!connectionId) {
    throw new AppError(
      400,
      "Not connected",
      "Connect a MongoDB or SQL database before creating triggers.",
      [],
      "NOT_CONNECTED"
    );
  }

  if (session.activeConnectionId !== connectionId) {
    await mongoConnectionManager.activate(input.sessionId, connectionId);
  }

  if (!session.schema) {
    await refreshSchema(input.sessionId);
  }
  if (!session.schema) {
    throw new AppError(400, "No schema", "Refresh the database schema first.", [], "NO_SCHEMA");
  }

  const engine = (session.engine ?? "mongodb") as string;
  if (engine === "quickbooks" || engine === "outlook") {
    throw new AppError(
      400,
      "Unsupported engine",
      "Triggers do not support QuickBooks or Outlook yet.",
      [],
      "UNSUPPORTED_ENGINE"
    );
  }

  const settings = getRuntimeSettings();
  const compact = toCompactSchema(
    session.schema,
    engine === "mysql" || engine === "mssql" || engine === "mongodb" || engine === "quickbooks"
      ? engine
      : "mongodb"
  );
  const timezone = settings.timezone || env.timezone;
  const user = buildTriggerProposalUserPrompt({
    prompt: input.prompt,
    engine,
    timezone,
    dateContextJson: JSON.stringify(currentDateContext(timezone), null, 2),
    compactSchemaJson: JSON.stringify(compact, null, 2)
  });

  const runPropose = async (useFallback: boolean) => {
    const provider = createAIProvider(
      settings,
      useFallback ? settings.fallbackProvider : undefined
    );
    const parsed = await completeJsonWithRetry(
      (system, u, jsonMode) => provider.generateText(system, u, jsonMode),
      TRIGGER_PROPOSAL_SYSTEM_PROMPT,
      user
    );

    let proposalParse = TriggerProposalSchema.safeParse(parsed);
    if (!proposalParse.success) {
      const repairUser = `Fix this trigger-proposal JSON.\nValidation:\n${proposalParse.error.message}\n\nJSON:\n${JSON.stringify(parsed).slice(0, 4000)}\n\nReturn only corrected JSON.`;
      const repaired = await completeJsonWithRetry(
        (system, u, jsonMode) => provider.generateText(system, u, jsonMode),
        TRIGGER_PROPOSAL_SYSTEM_PROMPT,
        repairUser
      );
      proposalParse = TriggerProposalSchema.safeParse(repaired);
      if (!proposalParse.success) {
        throw new AppError(
          502,
          proposalParse.error.message,
          "AI returned an invalid trigger proposal. Try rephrasing your request.",
          [],
          "TRIGGER_PROPOSAL_INVALID"
        );
      }
    }
    return { provider, data: proposalParse.data };
  };

  const canFallback =
    Boolean(settings.fallbackProvider) && settings.fallbackProvider !== settings.provider;

  let provider;
  let data;
  try {
    ({ provider, data } = await runPropose(false));
  } catch (error) {
    const code = error instanceof AppError ? error.code : "";
    const shouldFallback =
      canFallback && (code === "AI_UNAVAILABLE" || code === "AI_QUOTA" || code === "AI_OLLAMA");
    if (!shouldFallback) throw error;
    logger.warn(
      {
        from: settings.provider,
        to: settings.fallbackProvider,
        code,
        operation: "trigger-propose-fallback"
      },
      "Primary AI failed for trigger propose; trying fallback provider"
    );
    ({ provider, data } = await runPropose(true));
  }
  const targetEngine = (
    ["mongodb", "mysql", "mssql"].includes(engine) ? engine : data.target.engine
  ) as TriggerEngine;

  return {
    provider: provider.name,
    model: provider.model,
    proposal: {
      name: data.name,
      explanation: data.explanation,
      connectionId,
      userPrompt: input.prompt,
      target: {
        ...data.target,
        engine: targetEngine
      },
      windows: data.windows.map((w) => ({
        id: w.id || uuid(),
        label: w.label,
        condition: w.condition,
        schedule: {
          cron: w.schedule.cron,
          timezone: w.schedule.timezone || settings.timezone || env.timezone
        },
        dedupeBucket: w.dedupeBucket ?? inferDedupeBucket(w.schedule.cron)
      })),
      email: {
        to: (data.email?.to ?? []).map((e) => e.trim()).filter(Boolean),
        subjectTemplate:
          data.email?.subjectTemplate ||
          `Alert: {{matchCount}} item(s) — ${data.name}`,
        bodyTemplate:
          data.email?.bodyTemplate ||
          `New matches for {{name}}:\n\n{{rows}}`,
        displayFields: data.email?.displayFields?.map((f) => f.trim()).filter(Boolean)
      }
    }
  };
}
