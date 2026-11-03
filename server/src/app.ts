import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { apiRouter } from "./routes/api.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { sessionMiddleware } from "./middleware/session.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./utils/logger.js";
import { env } from "./config/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function isAllowedBrowserOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (
      hostname.endsWith(".ngrok-free.app") ||
      hostname.endsWith(".ngrok-free.dev") ||
      hostname.endsWith(".ngrok.app") ||
      hostname.endsWith(".ngrok.io")
    ) {
      return true;
    }
    const parts = hostname.split(".").map((n) => Number.parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b] = parts;
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, isAllowedBrowserOrigin(origin));
      },
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
  app.use(sessionMiddleware);
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          executionTimeMs: Date.now() - started
        },
        "request"
      );
    });
    next();
  });

  app.use("/api", apiRouter);

  const clientDist = path.resolve(here, "../../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
