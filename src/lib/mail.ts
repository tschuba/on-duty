import nodemailer from "nodemailer";
import { env } from "../env.js";

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

// Log-and-skip by design (see backlog "Digitale Anträge"): the submit/approve/reject
// workflow must never fail just because notifications aren't configured or the SMTP
// server is unreachable. Callers surface `sent: false` to the user as an inline hint.
export async function sendMail(to: string, subject: string, text: string): Promise<{ sent: boolean }> {
  if (!isSmtpConfigured()) {
    console.warn(`[mail] SMTP nicht konfiguriert — E-Mail an ${to} ("${subject}") nicht versendet.`);
    return { sent: false };
  }

  try {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error(`[mail] Versand an ${to} fehlgeschlagen:`, err);
    return { sent: false };
  }
}
