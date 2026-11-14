import nodemailer from "nodemailer";
import { env } from "../env.js";
import { logger } from "./logger.js";
import { renderMail, resolveTemplate, type MailVars, type ResolvedTemplate } from "./mail-templates.js";

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

export interface TemplateMailOptions {
  key: string;
  to: string;
  vars: MailVars;
  template?: ResolvedTemplate; // bereits aufgelöst (ein resolveTemplate je Versand an mehrere Empfänger)
  headers?: Record<string, string>; // z. B. List-Unsubscribe; überschreibt Vorlagen-Header nicht für X-On-Duty-*
}

// Ein Pool-Transport für alle Mails (Massenversand); env ändert sich zur Laufzeit nicht.
let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
function getTransport(): ReturnType<typeof nodemailer.createTransport> {
  return (transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    pool: true,
  }));
}

const RESERVED_HEADER = /^(x-on-duty-|from$|to$|subject$|list-unsubscribe)/i;

function extraHeaders(tpl: ResolvedTemplate): Record<string, string> {
  if (tpl.headersMode !== "extendable" || !tpl.extraHeaders) return {};
  try {
    return Object.fromEntries(Object.entries(JSON.parse(tpl.extraHeaders) as Record<string, string>).filter(([k]) => !RESERVED_HEADER.test(k)));
  } catch {
    logger.warn({ key: tpl.key }, "[mail] invalid extraHeaders JSON ignored");
    return {};
  }
}

// Einheitliches Schema (docs/mails.md): Betreff "[<ORG_NAME>|<Typ>] …" plus X-On-Duty-Category/-Event/-Audience.
// Texte, Präfix und Header kommen aus mail_templates.
// Log-and-skip by design (see backlog "Digitale Anträge"): the submit/approve/reject
// workflow must never fail just because notifications aren't configured or the SMTP
// server is unreachable. Callers surface `sent: false` to the user as an inline hint.
export async function sendMail(opts: TemplateMailOptions): Promise<{ sent: boolean }> {
  const to = opts.to;
  const tpl = opts.template ?? (await resolveTemplate(opts.key));
  if (!tpl) return { sent: false };
  const { subject, text } = renderMail(tpl, opts.vars);
  const headers = { ...extraHeaders(tpl), "X-On-Duty-Category": tpl.category, "X-On-Duty-Event": tpl.key, "X-On-Duty-Audience": tpl.audience, ...opts.headers };
  if (!isSmtpConfigured()) {
    logger.warn({ subject }, "[mail] SMTP not configured, email not sent");
    return { sent: false };
  }

  try {
    await getTransport().sendMail({ from: env.SMTP_FROM, to, subject, text, headers });
    return { sent: true };
  } catch (err) {
    logger.error({ err, subject }, "[mail] sending failed");
    return { sent: false };
  }
}
