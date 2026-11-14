import { and, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailLog, memberRoleAssignments, members } from "../db/schema/index.js";
import { findMembersByStatus, isActiveMember } from "./events.js";
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

// Auswahl: Vereinigung aus Statusgruppen, aktuell vergebenen Funktionen und Einzelpersonen; leer = alle aktiven Mitglieder.
export interface Selection { statuses: string[]; roleIds: string[]; memberIds: string[] }

export async function customRecipients(topic: string, sel: Selection = { statuses: [], roleIds: [], memberIds: [] }, urgent = false): Promise<EventMailRecipient[]> {
  let ids: string[];
  if (!sel.statuses.length && !sel.roleIds.length && !sel.memberIds.length) {
    ids = (await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members)).filter(isActiveMember).map((m) => m.id);
  } else {
    const byStatus = await findMembersByStatus(); // nur aktive Mitglieder
    const active = new Set(Object.values(byStatus).flat().map((m) => m.id));
    const picked = new Set(sel.statuses.flatMap((st) => (byStatus as Record<string, { id: string }[]>)[st]?.map((m) => m.id) ?? []));
    if (sel.roleIds.length) {
      const rows = await db.select({ id: memberRoleAssignments.memberId }).from(memberRoleAssignments)
        .where(and(inArray(memberRoleAssignments.memberRoleId, sel.roleIds), isNull(memberRoleAssignments.to)));
      rows.forEach((r) => active.has(r.id) && picked.add(r.id));
    }
    sel.memberIds.forEach((id) => active.has(id) && picked.add(id));
    ids = [...picked];
  }
  return mailRecipientsFor(ids, urgent ? "" : topic); // dringend: Abbestellungen gelten nicht (Thema "" wird nie abbestellt)
}

export const countSend = (rs: EventMailRecipient[]) => rs.filter((r) => r.state === "send").length;

// Startet den Versand im Hintergrund (eine Mail je Adresse). Ergebnis: Empfängerzahl oder Grund des Abbruchs.
export async function startCustomMail(key: string, values: Record<string, string>, sel: Selection | undefined, urgent: boolean): Promise<number | "busy" | "invalid" | "none"> {
  if (inFlight.has(key)) return "busy";
  inFlight.add(key);
  try {
    const tpl = await resolveTemplate(key);
    if (!tpl?.topic) { inFlight.delete(key); return "invalid"; }
    const rs = (await customRecipients(tpl.topic, sel, urgent)).filter((r) => r.state === "send");
    if (!rs.length) { inFlight.delete(key); return "none"; }
    void run(key, tpl, rs, values, urgent).catch((err) => logger.error({ err }, "[custom-mail] failed")).finally(() => inFlight.delete(key));
    return rs.length;
  } catch (err) {
    inFlight.delete(key);
    throw err;
  }
}

async function run(key: string, tpl: NonNullable<Awaited<ReturnType<typeof resolveTemplate>>>, rs: EventMailRecipient[], values: Record<string, string>, urgent: boolean): Promise<void> {
  const groups = new Map<string, EventMailRecipient[]>();
  for (const r of rs) groups.set(r.email.toLowerCase(), [...(groups.get(r.email.toLowerCase()) ?? []), r]);
  const mailTpl = { ...tpl, key: `custom-${key}` }; // X-On-Duty-Event
  for (const group of groups.values()) {
    const first = group[0];
    const single = group.length === 1;
    const unsubscribeUrl = urgent ? "" : linkUrl({ p: single ? "mail.optout" : "mail.optout-address", m: first.memberId, t: tpl.topic! });
    const vars: MailVars = {
      ...values, unsubscribeUrl,
      org: { name: env.ORG_NAME, url: env.OIDC_APP_URL, contactEmail: "" }, type: t("mail.type.custom"),
      recipient: { name: `${first.firstName} ${first.lastName}`.trim(), firstName: first.firstName, lastName: first.lastName, email: first.email },
    };
    // List-Unsubscribe nur bei genau einem Mitglied und nicht bei dringenden Mails (dort gibt es kein Opt-Out).
    const headers = urgent || !single ? undefined : { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
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
