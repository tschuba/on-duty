import { and, asc, eq, exists, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, eventTags, eventInvitees, members, persons } from "../db/schema/index.js";
import { trimmed, parseTags } from "./forms.js";
import { parseCoordinates } from "./coordinates.js";
import { EVENT_TAGS, normalizeEventTags } from "./event-tags.js";
import { allDayBounds, parseLocal, dayAfter } from "./datetime.js";
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
    memberIds: [...new Set((Array.isArray(body.memberIds) ? body.memberIds : body.memberIds ? [body.memberIds] : []).map(String))],
  };
}

// Validiert und wandelt in UTC-Zeiten; gibt { errors } zurück, wenn etwas fehlt/falsch ist.
export function validateEventForm(values: EventFormValues, tz: string): { startsAt: Date; endsAt: Date } | { errors: Record<string, string> } {
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

  if (Object.keys(errors).length > 0) return { errors };
  return { startsAt: startsAt!, endsAt: endsAt! };
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

export async function loadMemberNames(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const rows = await db.select({ id: members.id, firstName: persons.firstName, lastName: persons.lastName }).from(members)
    .innerJoin(persons, eq(persons.id, members.personId)).where(inArray(members.id, ids)).orderBy(asc(persons.lastName), asc(persons.firstName));
  return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }));
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
