import { and, asc, count, eq, gt, exists, gte, inArray, isNull, lt, notExists, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, eventTags, eventInvitees, eventRsvps, members, persons } from "../db/schema/index.js";
import { trimmed, parseTags } from "./forms.js";
import { parseCoordinates } from "./coordinates.js";
import { EVENT_TAGS, normalizeEventTags } from "./event-tags.js";
import { allDayBounds, parseLocal, dayAfter, now } from "./datetime.js";
import { t } from "../i18n/index.js";
import { deriveMemberStatus } from "./status.js";
import { env } from "../env.js";

export type Event = typeof events.$inferSelect;
export type EventVisibility = Event["visibility"];

// Sichtbarkeit: events:manage sieht alles. Sonst public immer, loggedIn bei Login, members nur für Logins eingeladener Mitglieder
// (members-Termine mit leerer Liste bleiben so automatisch nur für events:manage sichtbar). Legacy-Wert roles ist nicht mehr sichtbar.
export function visibilityCondition(user: { id?: string; permissions: Set<string> } | undefined): SQL | undefined {
  if (user?.permissions.has("events:manage")) return undefined;
  if (!user) return eq(events.visibility, "public");
  const invited = and(eq(events.visibility, "members"), exists(
    db.select({ x: eventInvitees.eventId }).from(eventInvitees)
      .innerJoin(members, eq(members.id, eventInvitees.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(eventInvitees.eventId, events.id), eq(persons.userId, user.id ?? ""))),
  ));
  return or(eq(events.visibility, "public"), eq(events.visibility, "loggedIn"), invited);
}

// Aktiv = weder ausgetreten noch verstorben. Einzige Definition für "eingeladen zählt".
export function isActiveMember(m: { exitDate: string | null; deathDate: string | null }): boolean {
  return !m.exitDate && !m.deathDate;
}

// Eingeladene Mitglieder-IDs: public/loggedIn = alle aktiven Mitglieder (zur Laufzeit), members = aktive Teilmenge der Liste.
export async function invitedMembers(event: { id: string; visibility: EventVisibility }): Promise<string[]> {
  const rows = event.visibility === "members"
    ? await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(eventInvitees)
        .innerJoin(members, eq(members.id, eventInvitees.memberId)).where(eq(eventInvitees.eventId, event.id))
    : await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members);
  return rows.filter(isActiveMember).map((r) => r.id);
}

// Formular-Vorschlagsliste: nur Tags der für den Nutzer sichtbaren Termine (nicht die ganze Tag-Tabelle).
export async function eventTagVocabulary(user: { id?: string; permissions: Set<string> } | undefined): Promise<string[]> {
  const where = visibilityCondition(user);
  const rows = await db.select({ tag: eventTags.tag }).from(eventTags).innerJoin(events, eq(eventTags.eventId, events.id)).where(where);
  // Vordefinierte Tags kommen separat aus EVENT_TAGS.
  return [...new Set(rows.map((r) => r.tag))].filter((tag) => !EVENT_TAGS.some((d) => d.key === tag)).sort((a, b) => a.localeCompare(b, "de"));
}

// Überlappung mit [start, end] (Tage, "YYYY-MM-DD"): startsAt < Ende+1 Tag und endsAt >= Start.
export function overlapsRange(start: string, end: string, tz: string): SQL | undefined {
  const startDate = parseLocal(start, tz);
  const endExclusive = dayAfter(end, tz);
  if (!startDate) return undefined;
  return and(lt(events.startsAt, endExclusive), gte(events.endsAt, startDate));
}

export type EventFormValues = {
  title: string;
  location: string;
  coordinates: string; // ein Feld "lat, lng", wie im Inventar
  description: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  visibility: EventVisibility;
  tags: string[];
  memberIds: string[];
  rsvpEnabled: boolean;
  maxParticipants: string;
  rsvpDeadline: string;
};

export function parseEventForm(body: Record<string, any>): EventFormValues {
  const visibility = body.visibility === "public" || body.visibility === "members" ? body.visibility : "loggedIn";
  return {
    title: trimmed(body, "title"),
    location: trimmed(body, "location"),
    coordinates: trimmed(body, "coordinates"),
    description: trimmed(body, "description"),
    allDay: body.allDay === "true" || body.allDay === "on",
    startsAt: trimmed(body, "startsAt"),
    endsAt: trimmed(body, "endsAt"),
    visibility,
    tags: normalizeEventTags(parseTags(body, "tags")),
    rsvpEnabled: body.rsvpEnabled === "true" || body.rsvpEnabled === "on",
    maxParticipants: trimmed(body, "maxParticipants"),
    rsvpDeadline: trimmed(body, "rsvpDeadline"),
    memberIds: [...new Set((Array.isArray(body.memberIds) ? body.memberIds : body.memberIds ? [body.memberIds] : []).map(String))],
  };
}

// Validiert und wandelt in UTC-Zeiten; gibt { errors } zurück, wenn etwas fehlt/falsch ist.
export function validateEventForm(values: EventFormValues, tz: string): { startsAt: Date; endsAt: Date; maxParticipants: number | null; rsvpDeadline: Date | null } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!values.title) errors.title = t("events.form.error.titleRequired");
  else if (values.title.length > 200) errors.title = t("events.form.error.titleTooLong");
  if (values.location.length > 200) errors.location = t("events.form.error.locationTooLong");
  if (parseCoordinates(values.coordinates).error) errors.coordinates = t("inventory.form.invalidCoordinate");
  if (values.description.length > 5000) errors.description = t("events.form.error.descriptionTooLong");

  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (values.allDay) {
    const bounds = values.startsAt ? allDayBounds(values.startsAt, values.endsAt || values.startsAt, tz) : null;
    if (!bounds) errors.dates = t("events.form.error.datesRequired");
    else ({ startsAt, endsAt } = bounds);
  } else {
    startsAt = values.startsAt ? parseLocal(values.startsAt, tz) : null;
    endsAt = values.endsAt ? parseLocal(values.endsAt, tz) : null;
    if (!startsAt || !endsAt) errors.dates = t("events.form.error.datesRequired");
  }
  if (startsAt && endsAt && endsAt < startsAt) errors.dates = t("events.form.error.endBeforeStart");

  // Anmeldefelder: ungültige Werte blockieren nur bei aktiver Anmeldung, sonst werden sie verworfen (null).
  const max = values.maxParticipants ? Number(values.maxParticipants) : null;
  const maxOk = max === null || (Number.isInteger(max) && max >= 1 && max <= 100000);
  if (!maxOk && values.rsvpEnabled) errors.maxParticipants = t("events.form.error.maxParticipants");
  const deadline = values.rsvpDeadline ? parseLocal(values.rsvpDeadline, tz) : null;
  const deadlineOk = !values.rsvpDeadline || (!!deadline && (!startsAt || deadline <= startsAt));
  if (!deadlineOk && values.rsvpEnabled) errors.rsvpDeadline = t("events.form.error.rsvpDeadline");

  if (Object.keys(errors).length > 0) return { errors };
  return { startsAt: startsAt!, endsAt: endsAt!, maxParticipants: maxOk ? max : null, rsvpDeadline: deadlineOk ? deadline : null };
}

// Ersetzt Tags und Einladungsliste eines Termins vollständig (Löschen + Neuanlage), analog routes/inventory.tsx.
// Die Liste gilt nur bei visibility "members". Bereits eingeladene Ausgetretene bleiben erhalten (zählen nur nicht mehr);
// neu aufgenommen werden nur aktive Mitglieder, unbekannte IDs fallen weg.
export async function saveEventTagsAndInvitees(tx: typeof db, eventId: string, tags: string[], visibility: EventVisibility, memberIds: string[]): Promise<void> {
  await tx.delete(eventTags).where(eq(eventTags.eventId, eventId));
  if (tags.length) await tx.insert(eventTags).values(tags.map((tag) => ({ eventId, tag })));

  const existing = new Set((await tx.select({ id: eventInvitees.memberId }).from(eventInvitees).where(eq(eventInvitees.eventId, eventId))).map((r) => r.id));
  await tx.delete(eventInvitees).where(eq(eventInvitees.eventId, eventId));
  if (visibility !== "members" || !memberIds.length) return;
  const rows = await tx.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members).where(inArray(members.id, memberIds));
  const ids = rows.filter((r) => existing.has(r.id) || isActiveMember(r)).map((r) => r.id);
  if (ids.length) await tx.insert(eventInvitees).values(ids.map((memberId) => ({ eventId, memberId })));
}

export async function loadMemberNames(ids: string[], lastFirst = false): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const rows = await db.select({ id: members.id, firstName: persons.firstName, lastName: persons.lastName }).from(members)
    .innerJoin(persons, eq(persons.id, members.personId)).where(inArray(members.id, ids)).orderBy(asc(persons.lastName), asc(persons.firstName));
  return rows.map((r) => ({ id: r.id, name: lastFirst ? `${r.lastName}, ${r.firstName}` : `${r.firstName} ${r.lastName}` }));
}

// Aktive Mitglieder je abgeleitetem Status (Ausgetretene/Verstorbene nie), nach Name sortiert.
export const AUDIENCE_STATUSES = ["active", "youth", "children", "passive", "supporting"] as const;
export async function findMembersByStatus(): Promise<Record<(typeof AUDIENCE_STATUSES)[number], { id: string; name: string }[]>> {
  const out = Object.fromEntries(AUDIENCE_STATUSES.map((s) => [s, [] as { id: string; name: string }[]])) as Awaited<ReturnType<typeof findMembersByStatus>>;
  const rows = await db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } });
  rows
    .filter(isActiveMember)
    .sort((a, b) => a.person.lastName.localeCompare(b.person.lastName, "de") || a.person.firstName.localeCompare(b.person.firstName, "de"))
    .forEach((m) => {
      const st = deriveMemberStatus({ ...m, birthDate: m.person.birthDate! }, m.assignments, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT);
      if (st in out) out[st as keyof typeof out].push({ id: m.id, name: `${m.person.firstName} ${m.person.lastName}` });
    });
  return out;
}


// ── Anmeldung (RSVP) ─────────────────────────────────────────────────────────

export type RsvpStatus = "yes" | "no";
type RsvpEvent = Pick<Event, "id" | "startsAt" | "endsAt" | "rsvpEnabled" | "maxParticipants" | "rsvpDeadline" | "cancelledAt">;

// Login -> Mitglied (über persons.userId); undefined ohne verknüpftes Mitglied.
export async function memberForUser(userId: string): Promise<{ id: string; exitDate: string | null; deathDate: string | null } | undefined> {
  const [row] = await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members)
    .innerJoin(persons, eq(persons.id, members.personId)).where(eq(persons.userId, userId)).limit(1);
  return row;
}

export const effectiveDeadline = (ev: Pick<Event, "startsAt" | "rsvpDeadline">): Date => ev.rsvpDeadline ?? ev.startsAt;

export type RsvpLock = "cancelled" | "deadline" | null;
// Allgemeiner Sperrgrund (gilt für Zu- und Absagen). Terminabsage sperrt alle, der Schluss nur Mitglieder.
export function rsvpLock(ev: RsvpEvent, manager: boolean, at = now()): RsvpLock {
  if (ev.cancelledAt) return "cancelled";
  return !manager && at > effectiveDeadline(ev) ? "deadline" : null;
}
export const isFull = (ev: Pick<Event, "maxParticipants">, yes: number) => ev.maxParticipants != null && yes >= ev.maxParticipants;

// Löschen nur für abgesagte oder vergangene Termine.
export const canDelete = (ev: Pick<Event, "cancelledAt" | "endsAt">, at = now()) => !!ev.cancelledAt || ev.endsAt < at;

export type RsvpRow = { memberId: string; name: string; lastName: string; status: RsvpStatus; active: boolean };

// Alle Anmeldungen eines Termins mit Name (inkl. Ausgetretener; Aufrufer zählen nur aktive).
export async function loadRsvps(eventId: string): Promise<RsvpRow[]> {
  const rows = await db.select({ memberId: members.id, firstName: persons.firstName, lastName: persons.lastName, status: eventRsvps.status, exitDate: members.exitDate, deathDate: members.deathDate })
    .from(eventRsvps).innerJoin(members, eq(members.id, eventRsvps.memberId)).innerJoin(persons, eq(persons.id, members.personId))
    .where(eq(eventRsvps.eventId, eventId));
  return rows.map((r) => ({ memberId: r.memberId, name: `${r.lastName}, ${r.firstName}`, lastName: r.lastName, status: r.status, active: isActiveMember(r) }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.name.localeCompare(b.name, "de"));
}

export const countYes = (rows: RsvpRow[]) => rows.filter((r) => r.active && r.status === "yes").length;

// "Offen": eingeladene aktive Mitglieder ohne Zeile.
export async function loadOpenMembers(event: { id: string; visibility: EventVisibility }, rows: RsvpRow[]): Promise<{ id: string; name: string }[]> {
  const answered = new Set(rows.map((r) => r.memberId));
  return (await loadMemberNames((await invitedMembers(event)).filter((id) => !answered.has(id)), true));
}

// Zusagen aktiver Mitglieder und eigener Status für die Listenansicht (ein Query für alle Termine).
export async function loadRsvpSummaries(eventIds: string[], memberId: string | undefined): Promise<Map<string, { yes: number; mine: RsvpStatus | null }>> {
  const out = new Map<string, { yes: number; mine: RsvpStatus | null }>(eventIds.map((id) => [id, { yes: 0, mine: null }]));
  if (!eventIds.length) return out;
  const rows = await db.select({ eventId: eventRsvps.eventId, memberId: eventRsvps.memberId, status: eventRsvps.status }).from(eventRsvps)
    .innerJoin(members, eq(members.id, eventRsvps.memberId))
    .where(and(inArray(eventRsvps.eventId, eventIds), isNull(members.exitDate), isNull(members.deathDate)));
  for (const r of rows) {
    const s = out.get(r.eventId)!;
    if (r.status === "yes") s.yes++;
    if (r.memberId === memberId) s.mine = r.status;
  }
  return out;
}

// Offene Rückmeldungen des Logins: gleiche Definition wie RsvpLine (eingeladen, beantwortbar, keine Zeile). Ohne aktives Mitglied 0.
export async function countPendingRsvps(userId: string): Promise<number> {
  const member = await memberForUser(userId);
  if (!member || !isActiveMember(member)) return 0;
  const at = now();
  const [row] = await db.select({ n: count() }).from(events).where(and(
    eq(events.rsvpEnabled, true), isNull(events.cancelledAt),
    gt(events.startsAt, at), gt(sql`coalesce(${events.rsvpDeadline}, ${events.startsAt})`, at),
    or(
      inArray(events.visibility, ["public", "loggedIn"]),
      and(eq(events.visibility, "members"), exists(db.select({ x: eventInvitees.eventId }).from(eventInvitees)
        .where(and(eq(eventInvitees.eventId, events.id), eq(eventInvitees.memberId, member.id))))),
    ),
    notExists(db.select({ x: eventRsvps.eventId }).from(eventRsvps).where(and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.memberId, member.id)))),
  ));
  return Number(row?.n ?? 0);
}

export type SetRsvpResult = "ok" | "cancelled" | "deadline" | "full" | "notFound";

// Setzt Zu-/Absage. Die Termin-Zeile wird gesperrt (FOR UPDATE), damit Limit-Prüfung und Eintrag race-sicher sind.
// manager = Führung: Schluss und Limit gelten nicht, die Terminabsage schon.
export async function setRsvp(eventId: string, memberId: string, status: RsvpStatus, manager: boolean): Promise<SetRsvpResult> {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!ev || !ev.rsvpEnabled) return "notFound";
    const lock = rsvpLock(ev, manager);
    if (lock) return lock;
    if (status === "yes" && !manager && ev.maxParticipants != null) {
      const [mine] = await tx.select({ status: eventRsvps.status }).from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
      if (mine?.status !== "yes") {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(eventRsvps).innerJoin(members, eq(members.id, eventRsvps.memberId))
          .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, "yes"), isNull(members.exitDate), isNull(members.deathDate)));
        if (isFull(ev, n)) return "full";
      }
    }
    await tx.insert(eventRsvps).values({ eventId, memberId, status }).onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.memberId], set: { status, respondedAt: now() } });
    return "ok";
  });
}

// Zurück auf "offen" (nur Führung). Terminabsage sperrt auch das.
export async function resetRsvp(eventId: string, memberId: string): Promise<SetRsvpResult> {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!ev || !ev.rsvpEnabled) return "notFound";
    if (ev.cancelledAt) return "cancelled";
    await tx.delete(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
    return "ok";
  });
}

// Picker der Führung: alle aktiven Mitglieder ohne Zeile für diesen Termin (auch nicht eingeladene).
export function withoutRsvp(eventId: string): SQL {
  return notExists(db.select({ x: eventRsvps.id }).from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, members.id))));
}
