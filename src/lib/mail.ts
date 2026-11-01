import nodemailer from "nodemailer";
import { env } from "../env.js";
import { logger } from "./logger.js";
import { t } from "../i18n/index.js";
import { mailLabel } from "./mail-label.js";

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

export type MailCategory = "membership" | "lend" | "registration";
export type MailAudience = "staff" | "applicant";

export interface MailOptions {
  to: string;
  category: MailCategory;
  event: string; // stable, not localized, e.g. "application-approved"
  audience: MailAudience;
  subject: string;
  text: string;
}

// Einheitliches Schema (docs/mails.md): Betreff "[<ORG_NAME>|<Typ>] …" plus X-On-Duty-Category/-Event/-Audience.
// Typ-Labels sind fest — Nutzer filtern darauf.
// Log-and-skip by design (see backlog "Digitale Anträge"): the submit/approve/reject
// workflow must never fail just because notifications aren't configured or the SMTP
// server is unreachable. Callers surface `sent: false` to the user as an inline hint.
export async function sendMail({ to, category, event, audience, subject: rawSubject, text }: MailOptions): Promise<{ sent: boolean }> {
  const subject = `[${mailLabel(env.ORG_NAME)}|${t(`mail.type.${category}`)}] ${rawSubject}`;
  if (!isSmtpConfigured()) {
    logger.warn({ subject }, "[mail] SMTP not configured, email not sent");
    return { sent: false };
  }

  try {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({ from: env.SMTP_FROM, to, subject, text,
      headers: { "X-On-Duty-Category": category, "X-On-Duty-Event": event, "X-On-Duty-Audience": audience },
    });
    return { sent: true };
  } catch (err) {
    logger.error({ err, subject }, "[mail] sending failed");
    return { sent: false };
  }
}
