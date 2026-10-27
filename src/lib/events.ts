import { and, eq, exists, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, eventTags, eventVisibleRoles } from "../db/schema/index.js";
import { trimmed, parseTags } from "./forms.js";
import { allDayBounds, parseLocal, dayAfter } from "./datetime.js";
import { t } from "../i18n/index.js";

export type Event = typeof events.$inferSelect;
export type EventVisibility = Event["visibility"];
export type EventWithExtras = Event & { tags: string[]; roleIds: string[] };

// Sichtbarkeit: events:manage sieht alles. Sonst public immer, loggedIn bei Login, roles nur bei Rollentreffer
// (verwaiste roles-Termine ohne zugewiesene Rolle bleiben so automatisch nur für events:manage sichtbar).
export function visibilityCondition(user: { permissions: Set<string>; roleIds: Set<string> } | undefined): SQL | undefined {
  if (user?.permissions.has("events:manage")) return undefined;
  const roleMatch = user && user.roleIds.size > 0
    ? and(eq(events.visibility, "roles"), exists(
        db.select().from(eventVisibleRoles).where(and(eq(eventVisibleRoles.eventId, events.id), inArray(eventVisibleRoles.roleId, [...user.roleIds]))),
      ))
    : undefined;
  if (!user) return eq(events.visibility, "public");
  return or(eq(events.visibility, "public"), eq(events.visibility, "loggedIn"), roleMatch);
}

// Formular-Vorschlagsliste: nur Tags der für den Nutzer sichtbaren Termine (nicht die ganze Tag-Tabelle).
export async function eventTagVocabulary(user: { permissions: Set<string>; roleIds: Set<string> } | undefined): Promise<string[]> {
  const where = visibilityCondition(user);
  const rows = await db.select({ tag: eventTags.tag }).from(eventTags).innerJoin(events, eq(eventTags.eventId, events.id)).where(where);
  return [...new Set(rows.map((r) => r.tag))].sort((a, b) => a.localeCompare(b, "de"));
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
  description: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  visibility: EventVisibility;
  tags: string[];
  roleIds: string[];
};

export function parseEventForm(body: Record<string, any>): EventFormValues {
  const visibility = body.visibility === "public" || body.visibility === "roles" ? body.visibility : "loggedIn";
  return {
    title: trimmed(body, "title"),
    location: trimmed(body, "location"),
    description: trimmed(body, "description"),
    allDay: body.allDay === "true" || body.allDay === "on",
    startsAt: trimmed(body, "startsAt"),
    endsAt: trimmed(body, "endsAt"),
    visibility,
    tags: parseTags(body, "tags"),
    roleIds: [...new Set((Array.isArray(body.roleIds) ? body.roleIds : body.roleIds ? [body.roleIds] : []).map(String))],
  };
}

// Validiert und wandelt in UTC-Zeiten; gibt { errors } zurück, wenn etwas fehlt/falsch ist.
export function validateEventForm(values: EventFormValues, tz: string): { startsAt: Date; endsAt: Date } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!values.title) errors.title = t("events.form.error.titleRequired");
  else if (values.title.length > 200) errors.title = t("events.form.error.titleTooLong");
  if (values.location.length > 200) errors.location = t("events.form.error.locationTooLong");
  if (values.description.length > 5000) errors.description = t("events.form.error.descriptionTooLong");
  if (values.visibility === "roles" && values.roleIds.length === 0) errors.roleIds = t("events.form.error.rolesRequired");

  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (values.allDay) {
    const bounds = values.startsAt && values.endsAt ? allDayBounds(values.startsAt, values.endsAt, tz) : null;
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

// Ersetzt Tags und Rollen eines Termins vollständig (Löschen + Neuanlage), analog routes/inventory.tsx.
export async function saveEventTagsAndRoles(tx: typeof db, eventId: string, tags: string[], visibility: EventVisibility, roleIds: string[]): Promise<void> {
  await tx.delete(eventTags).where(eq(eventTags.eventId, eventId));
  if (tags.length) await tx.insert(eventTags).values(tags.map((tag) => ({ eventId, tag })));

  await tx.delete(eventVisibleRoles).where(eq(eventVisibleRoles.eventId, eventId));
  if (visibility === "roles" && roleIds.length) await tx.insert(eventVisibleRoles).values(roleIds.map((roleId) => ({ eventId, roleId })));
}
