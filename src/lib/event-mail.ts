import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailLog, mailPreferences, members, persons } from "../db/schema/index.js";
import { invitedMembers, isActiveMember, type Event } from "./events.js";
import { linkUrl } from "./links.js";
import { sendMail } from "./mail.js";
import { buildVars, resolveTemplate, whenText, type MailRecipient } from "./mail-templates.js";
import { logger } from "./logger.js";
import { formatDateTime, now, resolveLocale } from "./datetime.js";
import { t } from "../i18n/index.js";

export const EVENT_TOPIC = "events";

export type RecipientState = "send" | "no-email" | "opted-out";
export interface EventMailRecipient { memberId: string; personId: string; firstName: string; lastName: string; email: string; state: RecipientState }

// Einladungskreis ∩ Adresse vorhanden ∩ nicht abbestellt. Vergangene Termine: keine Empfänger.
// includePast: auch für beendete Termine (Versandstatus-Anzeige), nie zum Versenden.
export async function eventMailRecipients(event: Pick<Event, "id" | "visibility" | "endsAt">, includePast = false): Promise<EventMailRecipient[]> {
  if (!includePast && event.endsAt < now()) return [];
  return mailRecipientsFor(await invitedMembers(event));
}

// Mitglieder-IDs → Empfänger inkl. Zustand (Adresse/Abbestellung).
export async function mailRecipientsFor(ids: string[]): Promise<EventMailRecipient[]> {
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

const TEMPLATES = { cancelled: "event-cancelled", uncancelled: "event-uncancelled" } as const;

// ---- Änderungserkennung ---------------------------------------------------

export interface EventSnapshot { startsAt: Date; endsAt: Date; allDay: boolean; location: string | null; rsvpDeadline: Date | null }
export const snapshot = (e: EventSnapshot): EventSnapshot => ({ startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, location: e.location, rsvpDeadline: e.rsvpDeadline });

const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

// Nur Zeit, Ort und Anmeldefrist fragen nach; alles andere löst nie eine Mail aus. Eine Zeile je Änderung: "Ort: alt → neu".
export function eventChanges(old: EventSnapshot, cur: EventSnapshot, tz: string, locale = resolveLocale()): string[] {
  const none = t("events.changes.none");
  const lines: string[] = [];
  if (old.allDay !== cur.allDay || !same(old.startsAt, cur.startsAt) || !same(old.endsAt, cur.endsAt)) {
    lines.push(`${t("events.changes.when")}: ${whenText(old, tz, locale)} → ${whenText(cur, tz, locale)}`);
  }
  if ((old.location ?? "") !== (cur.location ?? "")) lines.push(`${t("events.changes.location")}: ${old.location || none} → ${cur.location || none}`);
  if (!same(old.rsvpDeadline, cur.rsvpDeadline)) {
    const f = (d: Date | null) => (d ? formatDateTime(d, tz, locale) : none);
    lines.push(`${t("events.changes.deadline")}: ${f(old.rsvpDeadline)} → ${f(cur.rsvpDeadline)}`);
  }
  return lines;
}

// ---- Nachholen („Neuer Termin“) -------------------------------------------

// Wer bekommt „Neuer Termin“ jetzt? Kein Log-Eintrag: alle Empfänger. Sonst nur Personen, deren letzter Eintrag failed ist.
export async function createdTargets(event: Pick<Event, "id" | "visibility" | "endsAt">): Promise<{ mode: "all" | "failed"; recipients: EventMailRecipient[] }> {
  const latest = await latestStatus(event.id, "event-created");
  const all = await eventMailRecipients(event);
  return latest.size === 0
    ? { mode: "all", recipients: all }
    : { mode: "failed", recipients: all.filter((r) => r.state === "send" && latest.get(r.personId) === "failed") };
}

// Letzter mail_log-Eintrag je Person (optional nur eine Vorlage).
async function latestStatus(eventId: string, template?: string): Promise<Map<string, "sent" | "failed">> {
  const rows = await db.select({ personId: mailLog.personId, status: mailLog.status }).from(mailLog)
    .where(template ? and(eq(mailLog.eventId, eventId), eq(mailLog.template, template)) : eq(mailLog.eventId, eventId)).orderBy(asc(mailLog.sentAt));
  return new Map(rows.map((r) => [r.personId, r.status]));
}

// ---- Versandstatus ---------------------------------------------------------

export type DeliveryState = "sent" | "failed" | "no-email" | "opted-out" | "no-smtp" | "pending";
export async function eventDelivery(event: Pick<Event, "id" | "visibility" | "endsAt">, smtp: boolean): Promise<(EventMailRecipient & { delivery: DeliveryState })[]> {
  const [rs, latest] = await Promise.all([eventMailRecipients(event, true), latestStatus(event.id)]);
  return rs.map((r) => ({ ...r, delivery: r.state === "no-email" ? "no-email" : r.state === "opted-out" ? "opted-out" : latest.get(r.personId) ?? (smtp ? "pending" : "no-smtp") }));
}

// ---- Versand ----------------------------------------------------------------

// Doppelversand-Schutz gegen gleichzeitige Requests (gleicher Prozess); inFlight wird vor dem ersten await gesetzt.
const inFlight = new Set<string>();

// „Neuer Termin“ (Anlegen/Nachholen), im Hintergrund; false = nichts zu versenden bzw. läuft schon.
export async function startEventMails(event: Event): Promise<boolean> {
  const key = `created:${event.id}`;
  if (inFlight.has(key) || event.cancelledAt) return false;
  inFlight.add(key);
  try {
    const ids = new Set((await createdTargets(event)).recipients.filter((r) => r.state === "send").map((r) => r.memberId));
    if (!ids.size) { inFlight.delete(key); return false; }
    void sendEventMails(event, "event-created", { filter: (r) => ids.has(r.memberId) }).finally(() => inFlight.delete(key));
    return true;
  } catch (err) {
    inFlight.delete(key);
    throw err;
  }
}

// Versand nach Änderung/Absage im selben Request (nach dem Speichern), im Hintergrund. Änderungen und Neu-Eingeladene berechnet der Aufrufer serverseitig.
export function sendChangeMails(event: Event, o: { changes?: string[]; added?: string[]; cancel?: "cancelled" | "uncancelled" }): void {
  const added = new Set(o.added ?? []);
  void (async () => {
    if (o.cancel) await sendEventMails(event, TEMPLATES[o.cancel]);
    if (o.changes?.length) await sendEventMails(event, "event-updated", { changes: o.changes.join("\n"), filter: (r) => !added.has(r.memberId) });
    if (added.size && !event.cancelledAt) await sendEventMails(event, "event-created", { filter: (r) => added.has(r.memberId) });
  })().catch((err) => logger.error({ err }, "[event-mail] change mails failed"));
}

export interface SendOpts { changes?: string; filter?: (r: EventMailRecipient) => boolean }

// Eine Mail je Adresse (getrimmt, Kleinschreibung), Block je Mitglied. Läuft im Hintergrund; Fehler sind Log-and-skip.
export async function sendEventMails(event: Event, template = "event-created", opts: SendOpts = {}): Promise<void> {
  const groups = new Map<string, EventMailRecipient[]>();
  for (const r of (await eventMailRecipients(event)).filter((r) => r.state === "send" && (opts.filter?.(r) ?? true))) {
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
    const vars = buildVars(template, { event, changes: opts.changes, optOutAllUrl: multiple ? linkUrl({ p: "mail.optout-address", m: group[0].memberId, t: EVENT_TOPIC }) : undefined }, rcpts);
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

// ---- Info-Mail zu Termin-Mails (#152) ----------------------------------------

const INFO_TEMPLATE = "event-mail-info";

// Aktive Mitglieder mit Adresse, nicht abbestellt, ohne erfolgreich versendete Info-Mail.
export async function infoMailRecipients(): Promise<EventMailRecipient[]> {
  const all = await mailRecipientsFor((await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members)).filter(isActiveMember).map((m) => m.id));
  const done = await db.select({ personId: mailLog.personId }).from(mailLog).where(and(eq(mailLog.template, INFO_TEMPLATE), eq(mailLog.status, "sent")));
  const sentTo = new Set(done.map((d) => d.personId));
  return all.filter((r) => r.state === "send" && !sentTo.has(r.personId));
}

// Eine Mail je Adresse, im Hintergrund; gibt die Zahl der Empfänger zurück (0 = nichts zu tun).
export async function sendEventInfoMail(): Promise<number> {
  const rs = await infoMailRecipients();
  if (!rs.length) return 0;
  void sendInfoGroups(rs).catch((err) => logger.error({ err }, "[event-mail] info mail failed"));
  return rs.length;
}

async function sendInfoGroups(rs: EventMailRecipient[]): Promise<void> {
  const tpl = await resolveTemplate(INFO_TEMPLATE);
  if (!tpl) return;
  const groups = new Map<string, EventMailRecipient[]>();
  for (const r of rs) groups.set(r.email.toLowerCase(), [...(groups.get(r.email.toLowerCase()) ?? []), r]);
  for (const group of groups.values()) {
    const rcpts: MailRecipient[] = group.map((r) => ({ firstName: r.firstName, lastName: r.lastName, email: r.email, optOutUrl: linkUrl({ p: "mail.optout", m: r.memberId, t: EVENT_TOPIC }) }));
    const multiple = group.length > 1;
    const vars = buildVars(INFO_TEMPLATE, { optOutAllUrl: multiple ? linkUrl({ p: "mail.optout-address", m: group[0].memberId, t: EVENT_TOPIC }) : undefined }, rcpts);
    const headers = multiple ? undefined : { "List-Unsubscribe": `<${rcpts[0].optOutUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    let sent = false;
    try {
      ({ sent } = await sendMail({ key: INFO_TEMPLATE, to: group[0].email, vars, template: tpl, headers }));
    } catch (err) {
      logger.error({ err }, "[event-mail] info send failed");
    }
    try {
      await db.insert(mailLog).values(group.map((r) => ({ personId: r.personId, template: INFO_TEMPLATE, status: sent ? "sent" as const : "failed" as const })));
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
  await savePreference(ids, topic, optedOut, source);
  return true;
}

type PreferenceSource = typeof mailPreferences.$inferInsert["source"];
export async function savePreference(personIds: string[], topic: string, optedOut: boolean, source: PreferenceSource): Promise<void> {
  await db.insert(mailPreferences).values(personIds.map((personId) => ({ personId, topic, optedOut, source, changedAt: now() })))
    .onConflictDoUpdate({ target: [mailPreferences.personId, mailPreferences.topic], set: { optedOut, source, changedAt: now() } });
}

export async function isOptedOut(personId: string, topic = EVENT_TOPIC): Promise<boolean> {
  const [row] = await db.select({ o: mailPreferences.optedOut }).from(mailPreferences).where(and(eq(mailPreferences.personId, personId), eq(mailPreferences.topic, topic)));
  return !!row?.o;
}

// Formular-Checkbox → nur schreiben, wenn sich der Wert ändert (sonst bliebe die ursprüngliche Quelle erhalten).
export async function setEventMailsEnabled(personId: string, enabled: boolean, source: "account" | "admin" | "settings"): Promise<void> {
  if ((await isOptedOut(personId)) === !enabled) return;
  await savePreference([personId], EVENT_TOPIC, !enabled, source);
}
