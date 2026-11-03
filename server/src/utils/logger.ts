import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  redact: {
    paths: [
      "connectionString",
      "uri",
      "apiKey",
      "password",
      "req.headers.authorization",
      "req.body.connectionString",
      "req.body.apiKey",
      "req.body.gemini.apiKey",
      "req.body.groq.apiKey",
      "*.connectionString",
      "*.apiKey",
      "*.password"
    ],
    censor: "[redacted]"
  },
  transport:
    env.nodeEnv === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" }
        }
});
