import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in server/.env");
  }
  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPassword
    }
  });
  return transporter;
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPassword);
}

export async function sendAlertEmail(input: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}): Promise<{ messageId: string }> {
  const to = input.to.map((e) => e.trim()).filter(Boolean);
  if (!to.length) {
    throw new Error("No email recipients");
  }
  const transport = getTransporter();
  const from = env.smtpFrom || env.smtpUser;
  const info = await transport.sendMail({
    from,
    to: to.join(", "),
    subject: input.subject,
    text: input.text,
    html: input.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(input.text)}</pre>`
  });
  logger.info({ to, messageId: info.messageId, operation: "smtp-send" }, "Alert email sent");
  return { messageId: String(info.messageId ?? "") };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
