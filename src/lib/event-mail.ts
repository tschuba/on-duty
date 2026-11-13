import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailLog, mailPreferences, members, persons } from "../db/schema/index.js";
import { invitedMembers, type Event } from "./events.js";
import { linkUrl } from "./links.js";
import { sendMail } from "./mail.js";
import { buildVars, resolveTemplate, type MailRecipient } from "./mail-templates.js";
import { logger } from "./logger.js";
import { now } from "./datetime.js";

export const EVENT_TOPIC = "events";

export type RecipientState = "send" | "no-email" | "opted-out";
export interface EventMailRecipient { memberId: string; personId: string; firstName: string; lastName: string; email: string; state: RecipientState }

// Einladungskreis ∩ Adresse vorhanden ∩ nicht abbestellt. Vergangene Termine: keine Empfänger.
export async function eventMailRecipients(event: Pick<Event, "id" | "visibility" | "endsAt">): Promise<EventMailRecipient[]> {
  if (event.endsAt < now()) return [];
  const ids = await invitedMembers(event);
  if (!ids.length) return [];
  const rows = await db.select({ memberId: members.id, personId: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email })
    .from(members).innerJoin(persons, eq(persons.id, members.personId)).where(inArray(members.id, ids));
  const out = await db.select({ personId: mailPreferences.personId }).from(mailPreferences)
    .where(and(eq(mailPreferences.topic, EVENT_TOPIC), eq(mailPreferences.optedOut, true), inArray(mailPreferences.personId, rows.map((r) => r.personId))));
  const optedOut = new Set(out.map((o) => o.personId));
  return rows.map((r): EventMailRecipient => {
    const email = (r.email ?? "").trim();
    return { memberId: r.memberId, personId: r.personId, firstName: r.firstName, lastName: r.lastName, email, state: !email ? "no-email" : optedOut.has(r.personId) ? "opted-out" : "send" };
  }).sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
}

export const countRecipients = (rs: EventMailRecipient[]) => ({
  send: rs.filter((r) => r.state === "send").length,
  noEmail: rs.filter((r) => r.state === "no-email").length,
  optedOut: rs.filter((r) => r.state === "opted-out").length,
});

// Eine Mail je Adresse (getrimmt, Kleinschreibung), Block je Mitglied. Läuft im Hintergrund; Fehler sind Log-and-skip.
export async function sendEventMails(event: Event, template = "event-created"): Promise<void> {
  const groups = new Map<string, EventMailRecipient[]>();
  for (const r of (await eventMailRecipients(event)).filter((r) => r.state === "send")) {
    const k = r.email.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  if (!groups.size) return;
  const tpl = await resolveTemplate(template);
  if (!tpl) return;
  for (const group of groups.values()) {
    const rcpts: MailRecipient[] = group.map((r) => ({
      firstName: r.firstName, lastName: r.lastName, email: r.email,
      optOutUrl: linkUrl({ p: "mail.optout", m: r.memberId, t: EVENT_TOPIC }),
      rsvpYesUrl: linkUrl({ p: "event.rsvp-yes", m: r.memberId, e: event.id }),
      rsvpNoUrl: linkUrl({ p: "event.rsvp-no", m: r.memberId, e: event.id }),
    }));
    const multiple = group.length > 1;
    const vars = buildVars(template, { event, optOutAllUrl: multiple ? linkUrl({ p: "mail.optout-address", m: group[0].memberId, t: EVENT_TOPIC }) : undefined }, rcpts);
    // List-Unsubscribe nur bei genau einem Mitglied, sonst nicht eindeutig.
    const headers = multiple ? undefined : { "List-Unsubscribe": `<${rcpts[0].optOutUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    let sent = false;
    try {
      ({ sent } = await sendMail({ key: template, to: group[0].email, vars, template: tpl, headers }));
    } catch (err) {
      logger.error({ err }, "[event-mail] send failed");
    }
    try {
      await db.insert(mailLog).values(group.map((r) => ({ personId: r.personId, template, eventId: event.id, status: sent ? "sent" as const : "failed" as const })));
    } catch (err) {
      logger.error({ err }, "[event-mail] mail_log insert failed");
    }
  }
}

// Opt-Out setzen: eine Person (über memberId) oder alle Personen mit derselben Adresse (serverseitig aufgelöst).
export async function setOptOut(memberId: string, topic: string, optedOut: boolean, scope: "person" | "address", source: "link" | "address-link"): Promise<boolean> {
  const [me] = await db.select({ personId: persons.id, email: persons.email }).from(members).innerJoin(persons, eq(persons.id, members.personId)).where(eq(members.id, memberId));
  if (!me) return false;
  const email = (me.email ?? "").trim().toLowerCase();
  const ids = scope === "address" && email
    ? (await db.select({ id: persons.id }).from(persons).where(sql`lower(trim(${persons.email})) = ${email}`)).map((r) => r.id)
    : [me.personId];
  await db.insert(mailPreferences).values(ids.map((personId) => ({ personId, topic, optedOut, source, changedAt: now() })))
    .onConflictDoUpdate({ target: [mailPreferences.personId, mailPreferences.topic], set: { optedOut, source, changedAt: now() } });
  return true;
}
