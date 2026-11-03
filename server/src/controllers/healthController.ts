import type { Request, Response } from "express";
import { getPublicRuntimeSettings } from "../config/runtimeSettings.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";

export function healthWithSession(req: Request, res: Response): void {
  const status = mongoConnectionManager.getStatus(req.sessionId);
  res.json({
    ok: true,
    name: "Universal MongoDB AI Assistant",
    time: new Date().toISOString(),
    timezone: getPublicRuntimeSettings().timezone,
    mongodbConnected: status.connected,
    demoMode: !status.connected,
    provider: getPublicRuntimeSettings().provider
  });
}
