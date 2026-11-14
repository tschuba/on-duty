import { db } from "../db/index.js";
import { mailLog, members } from "../db/schema/index.js";
import { isActiveMember } from "./events.js";
import { mailRecipientsFor, type EventMailRecipient } from "./event-mail.js";
import { linkUrl } from "./links.js";
import { sendMail } from "./mail.js";
import { resolveTemplate, type MailVars } from "./mail-templates.js";
import { env } from "../env.js";
import { logger } from "./logger.js";
import { t } from "../i18n/index.js";

// Gleicher Prozess, gleiche Idee wie in event-mail.ts: Doppelversand und Löschen während des Versands verhindern.
const inFlight = new Set<string>();
export const isSending = (key: string) => inFlight.has(key);

// shortcut: Empfänger = alle aktiven Mitglieder; Auswahl nach Tags/Funktionen/Einzelnen später.
export async function customRecipients(topic: string): Promise<EventMailRecipient[]> {
  const rows = await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members);
  return mailRecipientsFor(rows.filter(isActiveMember).map((m) => m.id), topic);
}

export const countSend = (rs: EventMailRecipient[]) => rs.filter((r) => r.state === "send").length;

// Startet den Versand im Hintergrund (eine Mail je Adresse). Ergebnis: Empfängerzahl oder Grund des Abbruchs.
export async function startCustomMail(key: string, values: Record<string, string>): Promise<number | "busy" | "invalid" | "none"> {
  if (inFlight.has(key)) return "busy";
  inFlight.add(key);
  try {
    const tpl = await resolveTemplate(key);
    if (!tpl?.topic) { inFlight.delete(key); return "invalid"; }
    const rs = (await customRecipients(tpl.topic)).filter((r) => r.state === "send");
    if (!rs.length) { inFlight.delete(key); return "none"; }
    void run(key, tpl, rs, values).catch((err) => logger.error({ err }, "[custom-mail] failed")).finally(() => inFlight.delete(key));
    return rs.length;
  } catch (err) {
    inFlight.delete(key);
    throw err;
  }
}

async function run(key: string, tpl: NonNullable<Awaited<ReturnType<typeof resolveTemplate>>>, rs: EventMailRecipient[], values: Record<string, string>): Promise<void> {
  const groups = new Map<string, EventMailRecipient[]>();
  for (const r of rs) groups.set(r.email.toLowerCase(), [...(groups.get(r.email.toLowerCase()) ?? []), r]);
  const mailTpl = { ...tpl, key: `custom-${key}` }; // X-On-Duty-Event
  for (const group of groups.values()) {
    const first = group[0];
    const vars: MailVars = {
      ...values,
      org: { name: env.ORG_NAME, url: env.OIDC_APP_URL, contactEmail: "" }, type: t("mail.type.custom"),
      recipient: { name: `${first.firstName} ${first.lastName}`.trim(), firstName: first.firstName, lastName: first.lastName, email: first.email },
    };
    // List-Unsubscribe nur bei genau einem Mitglied an der Adresse, sonst nicht eindeutig.
    const headers = group.length > 1 ? undefined : { "List-Unsubscribe": `<${linkUrl({ p: "mail.optout", m: first.memberId, t: tpl.topic! })}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    let sent = false;
    try {
      ({ sent } = await sendMail({ key, to: first.email, vars, template: mailTpl, headers }));
    } catch (err) {
      logger.error({ err }, "[custom-mail] send failed");
    }
    try {
      await db.insert(mailLog).values(group.map((r) => ({ personId: r.personId, template: key, status: sent ? "sent" as const : "failed" as const })));
    } catch (err) {
      logger.error({ err }, "[custom-mail] mail_log insert failed");
    }
  }
}
