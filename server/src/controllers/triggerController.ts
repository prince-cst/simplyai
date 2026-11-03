import type { Request, Response } from "express";
import {
  CreateTriggerBodySchema,
  PatchTriggerBodySchema,
  ProposeTriggerBodySchema,
  TestTriggerBodySchema
} from "../schemas/trigger.js";
import { getAppStore } from "../config/appStore.js";
import { getOrCreateSession } from "../services/session/SessionStore.js";
import { proposeTrigger } from "../services/triggers/TriggerProposalService.js";
import {
  approveTrigger,
  createTrigger,
  deleteTrigger,
  getTriggerOrThrow,
  listAllTriggers,
  patchTrigger,
  runTriggerWindow
} from "../services/triggers/TriggerService.js";
import { triggerScheduler } from "../services/triggers/TriggerScheduler.js";
import { isSmtpConfigured } from "../services/triggers/EmailService.js";
import { AppError } from "../utils/errors.js";
import { connectionEngineOf } from "../services/sql/mysqlUri.js";

function publicTrigger(t: ReturnType<typeof getTriggerOrThrow>) {
  const { notifiedKeys: _keys, ...rest } = t;
  const saved = getAppStore().connections.find((c) => c.id === t.connectionId);
  return {
    ...rest,
    connectionName: saved?.name ?? "Unknown connection",
    databaseName: saved?.databaseName,
    connectionEngine: saved ? connectionEngineOf(saved) : t.target.engine,
    connectionMissing: !saved
  };
}

export async function propose(req: Request, res: Response): Promise<void> {
  const body = ProposeTriggerBodySchema.parse(req.body);
  const session = getOrCreateSession(req.sessionId);
  const connectionId = body.connectionId || session.activeConnectionId;
  if (!connectionId) {
    throw new AppError(400, "Not connected", "Connect a database first.", [], "NOT_CONNECTED");
  }
  const result = await proposeTrigger({
    sessionId: req.sessionId,
    prompt: body.prompt,
    connectionId
  });
  res.json(result);
}

export function list(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  void req;
  const triggers = listAllTriggers().map(publicTrigger);
  res.json({
    triggers,
    smtpConfigured: isSmtpConfigured(),
    activeConnectionId: session.activeConnectionId ?? getAppStore().activeConnectionId ?? null
  });
}

export function getOne(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  res.json({ trigger: publicTrigger(getTriggerOrThrow(id)) });
}

export function create(req: Request, res: Response): void {
  const body = CreateTriggerBodySchema.parse(req.body);
  const session = getOrCreateSession(req.sessionId);
  const connectionId = body.connectionId || session.activeConnectionId;
  if (!connectionId) {
    throw new AppError(400, "Not connected", "Connect a database first.", [], "NOT_CONNECTED");
  }
  const saved = getAppStore().connections.find((c) => c.id === connectionId);
  if (!saved) {
    throw new AppError(404, "Connection not found", "Saved connection not found.", [], "NO_CONNECTION");
  }
  if (!body.email.to.length) {
    throw new AppError(400, "Recipients required", "Add at least one email recipient.", [], "NO_RECIPIENTS");
  }
  const engine = connectionEngineOf(saved);
  if (engine === "quickbooks" || engine === "outlook") {
    throw new AppError(
      400,
      "Unsupported engine",
      "Triggers do not support QuickBooks or Outlook yet.",
      [],
      "UNSUPPORTED_ENGINE"
    );
  }
  const trigger = createTrigger({
    name: body.name,
    connectionId,
    userPrompt: body.userPrompt,
    explanation: body.explanation,
    target: {
      ...body.target,
      // Always bind engine to the chosen connection — never mix DB A schema with DB B runtime.
      engine: engine as "mongodb" | "mysql" | "mssql"
    },
    windows: body.windows,
    email: body.email,
    status: body.status
  });
  triggerScheduler.resync();
  res.status(201).json({ trigger: publicTrigger(trigger) });
}

export function patch(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  const body = PatchTriggerBodySchema.parse(req.body);
  const trigger = patchTrigger(id, body);
  triggerScheduler.resync();
  res.json({ trigger: publicTrigger(trigger) });
}

export function approve(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  const existing = getTriggerOrThrow(id);
  if (!existing.email.to.length) {
    throw new AppError(
      400,
      "Recipients required",
      "Add at least one email recipient before activating.",
      [],
      "NO_RECIPIENTS"
    );
  }
  const trigger = approveTrigger(id);
  triggerScheduler.resync();
  res.json({ trigger: publicTrigger(trigger) });
}

export function remove(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  deleteTrigger(id);
  triggerScheduler.resync();
  res.json({ ok: true });
}

export async function testRun(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? "");
  const body = TestTriggerBodySchema.parse(req.body ?? {});
  const result = await runTriggerWindow({
    triggerId: id,
    windowId: body.windowId,
    sendEmail: body.sendEmail ?? false,
    dryRun: body.dryRun ?? !body.sendEmail
  });
  res.json({ trigger: publicTrigger(result.trigger), run: result.run });
}
