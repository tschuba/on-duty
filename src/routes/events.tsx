import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, eventTags, eventVisibleRoles, appRoles } from "../db/schema/index.js";
import { requireAuth, type Variables, type AuthedUser } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { Field, FieldGroup } from "../components/field.js";
import { RowAction } from "../components/row-action.js";
import { ChipInput } from "../components/chip-input.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { addMonths, parseRange, rangeParams, rangePresets, todayStr } from "../lib/quick-range.js";
import { buildListUrl, parseMulti } from "../lib/list-query.js";
import { setFlash } from "../lib/flash.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { tagSuggestionsJson, TAG_SUGGESTIONS_ID } from "../lib/tags.js";
import {
  eventTagVocabulary,
  overlapsRange,
  parseEventForm,
  saveEventTagsAndRoles,
  validateEventForm,
  visibilityCondition,
  type Event,
  type EventFormValues,
} from "../lib/events.js";
import { formatDateTime, formatDay, formatTime, localDays, resolveTimezone, toLocalDate, toLocalInput, zoneAbbr } from "../lib/datetime.js";

export const eventRoutes = new Hono<{ Variables: Variables }>();
const manage = requireAuth("events:manage");

type EventRow = Event & { tags: { tag: string }[]; visibleRoles: { roleId: string }[] };

async function fetchEvents(user: AuthedUser | undefined, where: ReturnType<typeof and>): Promise<EventRow[]> {
  const cond = and(visibilityCondition(user), where);
  return db.query.events.findMany({ where: cond, with: { tags: true, visibleRoles: true }, orderBy: asc(events.startsAt) }) as Promise<EventRow[]>;
}

// ── Zeitzonen-Hinweis ────────────────────────────────────────────────────────

function TimezoneHint({ tz }: { tz: string }) {
  return (
    <p id="tz-hint" hidden class="text-sm opacity-70 mb-4">
      {t("events.timezoneHint")}
      <script dangerouslySetInnerHTML={{ __html: `
        if (Intl.DateTimeFormat().resolvedOptions().timeZone !== ${JSON.stringify(tz)}) document.getElementById('tz-hint').hidden = false;
      ` }} />
    </p>
  );
}

// ── Liste/Kalender ───────────────────────────────────────────────────────────

function EventTimeLabel({ ev, tz }: { ev: Event; tz: string }) {
  if (ev.allDay) {
    const sameDay = toLocalDate(ev.startsAt, tz) === toLocalDate(ev.endsAt, tz);
    return <>{formatDay(ev.startsAt, tz)}{!sameDay && <> – {formatDay(ev.endsAt, tz)}</>}</>;
  }
  return <>{formatDateTime(ev.startsAt, tz)} – {formatTime(ev.endsAt, tz)} {zoneAbbr(ev.startsAt, tz)}</>;
}

function EventTagBadges({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return <div class="flex flex-wrap gap-1 mt-1">{tags.map((tag) => <span class="badge badge-sm badge-outline">{tag}</span>)}</div>;
}

function EventList({ rows, tz, canManage }: { rows: EventRow[]; tz: string; canManage: boolean }) {
  if (!rows.length) return <p class="text-base-content/60 py-8">{t("events.empty")}</p>;
  return (
    <div class="overflow-x-auto">
      <table class="table table-zebra w-full">
        <tbody>
          {rows.map((ev) => {
            const orphanRoles = ev.visibility === "roles" && ev.visibleRoles.length === 0;
            return (
              <tr class={canManage ? "cursor-pointer hover" : ""} onclick={canManage ? `location.href='/events/${ev.id}/edit'` : undefined}>
                <td>
                  <div class="font-medium">{ev.title}{orphanRoles && <span class="badge badge-sm badge-warning ml-2">{t("events.orphanRoles")}</span>}</div>
                  <div class="text-sm opacity-70"><EventTimeLabel ev={ev} tz={tz} />{ev.location && <> · {ev.location}</>}</div>
                  <EventTagBadges tags={ev.tags.map((x) => x.tag)} />
                </td>
                {canManage && (
                  <td class="text-right">
                    <RowAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" attrs={{
                      "hx-post": `/events/${ev.id}/delete`, "hx-confirm": t("events.confirmDelete", { title: ev.title }), "hx-target": "#events-results", "hx-swap": "outerHTML",
                    }} onclick="event.stopPropagation()" />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventPopupHtml(ev: Event, tz: string, tags: string[]): string {
  const time = ev.allDay ? "" : `${formatTime(ev.startsAt, tz)}–${formatTime(ev.endsAt, tz)} `;
  const tagBadges = tags.map((tag) => `<span class="badge badge-xs badge-outline">${escapeHtml(tag)}</span>`).join(" ");
  return `<div class="p-1 text-xs"><div class="font-medium">${escapeHtml(ev.title)}</div><div>${time}${escapeHtml(ev.location ?? "")}</div>${tagBadges ? `<div class="flex flex-wrap gap-1 mt-1">${tagBadges}</div>` : ""}</div>`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function CalendarView({ rows, tz, canManage, tagParam, noFetch }: { rows: EventRow[]; tz: string; canManage: boolean; tagParam: string[]; noFetch?: boolean }) {
  const byDate = new Map<string, EventRow[]>();
  for (const ev of rows) {
    for (const key of localDays(ev.startsAt, ev.endsAt, tz)) {
      const list = byDate.get(key) ?? [];
      list.push(ev);
      byDate.set(key, list);
    }
  }
  return (
    <div>
      <div id="events-calendar" data-tz={tz} data-tags={tagParam.join(",")} data-no-fetch={noFetch ? "1" : ""}></div>
      <div id="events-calendar-day" class="mt-4"></div>
      <script type="application/json" id="events-calendar-data" dangerouslySetInnerHTML={{ __html: JSON.stringify(
        [...byDate.entries()].map(([date, list]) => [date, list.map((ev) => ({
          id: ev.id, title: ev.title, html: EventPopupHtml(ev, tz, ev.tags.map((x) => x.tag)),
          editHref: canManage ? `/events/${ev.id}/edit` : null,
        }))]),
      ).replace(/</g, "\\u003c") }} />
      <link rel="stylesheet" href="/css/vanilla-calendar.css" />
      <script type="module" dangerouslySetInnerHTML={{ __html: CALENDAR_SCRIPT }} />
    </div>
  );
}

// Zeigt die Termine des angeklickten Tages unterhalb; lädt beim Blättern neue Monate per calendar.json nach.
const CALENDAR_SCRIPT = `
  import { Calendar } from "/js/vanilla-calendar.min.js";
  const root = document.getElementById("events-calendar");
  if (root) {
    const dayBox = document.getElementById("events-calendar-day");
    const tags = root.dataset.tags;
    let byDate = new Map(JSON.parse(document.getElementById("events-calendar-data").textContent));
    function popups() {
      const p = {};
      for (const [date, list] of byDate) p[date] = { modifier: "events-day" };
      return p;
    }
    function renderDay(dateStr) {
      const list = byDate.get(dateStr) || [];
      dayBox.innerHTML = list.length ? list.map((e) =>
        '<div class="border-b border-base-300 py-2">' + e.html + (e.editHref ? ' <a class="link text-xs" href="' + e.editHref + '">' + ${JSON.stringify(t("common.edit"))} + '</a>' : '') + '</div>'
      ).join("") : "";
    }
    const calendar = new Calendar(root, {
      locale: "de-DE",
      firstWeekday: 1,
      popups: popups(),
      onClickDate(self) { renderDay(self.context.selectedDates[0] || self.selectedDates[0]); },
      async onClickArrow(self) {
        if (root.dataset.noFetch) return;
        const y = self.selectedYear, m = self.selectedMonth;
        const pad = (n) => String(n).padStart(2, "0");
        const from = y + "-" + pad(m + 1) + "-01";
        const to = y + "-" + pad(m + 1) + "-" + pad(new Date(y, m + 1, 0).getDate());
        const qs = tags ? "&" + tags.split(",").map((t) => "tag=" + encodeURIComponent(t)).join("&") : "";
        const res = await fetch("/events/calendar.json?from=" + from + "&to=" + to + qs);
        if (!res.ok) return;
        const data = await res.json();
        for (const [date, list] of data) byDate.set(date, list);
        self.set({ popups: popups() });
      },
    });
    calendar.init();
  }
`;

// ── /events ──────────────────────────────────────────────────────────────────

eventRoutes.get("/", requireAuth(), async (c) => {
  const user = c.get("user")!;
  const canManage = user.permissions.has("events:manage");
  const tz = resolveTimezone(c);
  const today = todayStr();
  const view = c.req.query("view") === "calendar" ? "calendar" : "list";
  const tagFilter = parseMulti(c.req.queries("tag"), await eventTagVocabulary(user));

  const range = parseRange(c.req.query(), today, "future", { start: today, end: addMonths(today, 3) });
  const { start, end } = range;
  const rp = rangeParams(range);

  const windowStart = view === "calendar" ? today : start;
  const windowEnd = view === "calendar" ? addMonths(today, 12) : end;
  const where = overlapsRange(windowStart, windowEnd, tz);
  let rows = await fetchEvents(user, where);
  if (tagFilter.length) rows = rows.filter((ev) => tagFilter.every((tag) => ev.tags.some((x) => x.tag === tag)));

  const allTags = await eventTagVocabulary(user);
  const presets = rangePresets(today, "future");
  const qs = (extra: Record<string, string | string[] | undefined>) => buildListUrl("/events", { ...rp, tag: tagFilter, view: view === "calendar" ? "calendar" : undefined }, extra);
  const rpHidden = Object.entries(rp).filter(([, v]) => v !== undefined) as [string, string][];

  return c.html(
    <Layout title={t("events.title")} user={user} activeNav="events">
      <div class="max-w-4xl mx-auto">
      <PageHeader title={t("events.title")} actions={canManage ? <HeaderAction variant="primary" icon="plus" label={t("common.create")} href="/events/new" class="btn-primary" /> : undefined} />
      <TimezoneHint tz={tz} />

      <div class="filter-bar mb-6 flex flex-wrap gap-3 items-end">
        <div class="join">
          <a href={qs({ view: undefined })} class={`btn join-item ${view === "list" ? "btn-outline btn-primary" : "btn-ghost"}`}>{t("events.view.list")}</a>
          <a href={qs({ view: "calendar" })} class={`btn join-item ${view === "calendar" ? "btn-outline btn-primary" : "btn-ghost"}`}>{t("events.view.calendar")}</a>
        </div>
        {view === "list" && (
          <QuickRangeFilter presets={presets} range={range} dir="future" action="/events" hidden={tagFilter.map((f): [string, string] => ["tag", f])} href={(p) => qs(p)} />
        )}
        <MultiSelectFilter param="tag" autoApply searchable options={allTags.map((tag) => ({ value: tag, label: tag }))} selected={tagFilter}
          allLabel={t("events.filter.allTags")} countLabel={(count) => t("events.filter.tagCount", { count })}
          applyLabel={t("common.apply")} resetLabel={t("common.reset")} searchPlaceholder={t("common.searchPlaceholder")} emptyLabel={t("events.filter.noTags")} />
      </div>

      <div id="events-results">
        {view === "calendar" ? <CalendarView rows={rows} tz={tz} canManage={canManage} tagParam={tagFilter} /> : <EventList rows={rows} tz={tz} canManage={canManage} />}
      </div>
      </div>
    </Layout>,
  );
});

// GET /events/calendar.json — Termine eines Zeitraums, gleiche Sichtbarkeit wie /events
eventRoutes.get("/calendar.json", requireAuth(), async (c) => {
  const user = c.get("user")!;
  const tz = resolveTimezone(c);
  const from = c.req.query("from") || todayStr();
  const to = c.req.query("to") || addMonths(from, 1);
  // serverseitig auf wenige Monate begrenzen
  const cappedTo = addMonths(from, 6) < to ? addMonths(from, 6) : to;
  const tagFilter = parseMulti(c.req.queries("tag"), await eventTagVocabulary(user));
  const canManage = user.permissions.has("events:manage");

  let rows = await fetchEvents(user, overlapsRange(from, cappedTo, tz));
  if (tagFilter.length) rows = rows.filter((ev) => tagFilter.every((tag) => ev.tags.some((x) => x.tag === tag)));

  const byDate = new Map<string, unknown[]>();
  for (const ev of rows) {
    for (const key of localDays(ev.startsAt, ev.endsAt, tz)) {
      const list = byDate.get(key) ?? [];
      list.push({ id: ev.id, title: ev.title, html: EventPopupHtml(ev, tz, ev.tags.map((x) => x.tag)), editHref: canManage ? `/events/${ev.id}/edit` : null });
      byDate.set(key, list);
    }
  }
  return c.json([...byDate.entries()]);
});

// ── /events/public ───────────────────────────────────────────────────────────

const PUBLIC_WINDOW_MONTHS = 12;
const PUBLIC_MAX_ROWS = 200;

eventRoutes.get("/public", async (c) => {
  const tz = resolveTimezone(c);
  const today = todayStr();
  const view = c.req.query("view") === "calendar" ? "calendar" : "list";
  const rows = (await db.query.events.findMany({
    where: and(eq(events.visibility, "public"), overlapsRange(today, addMonths(today, PUBLIC_WINDOW_MONTHS), tz)),
    with: { tags: true },
    orderBy: asc(events.startsAt),
    limit: PUBLIC_MAX_ROWS,
  })) as (Event & { tags: { tag: string }[] })[];

  const tagFilter = parseMulti(c.req.queries("tag"), [...new Set(rows.flatMap((ev) => ev.tags.map((x) => x.tag)))]);
  const filtered = tagFilter.length ? rows.filter((ev) => tagFilter.every((tag) => ev.tags.some((x) => x.tag === tag))) : rows;
  const allTags = [...new Set(rows.flatMap((ev) => ev.tags.map((x) => x.tag)))].sort((a, b) => a.localeCompare(b, "de"));

  if (!env.EVENTS_PUBLIC_INDEXING) c.header("X-Robots-Tag", "noindex");
  c.header("Cache-Control", "public, max-age=60");

  const qs = (extra: Record<string, string | string[] | undefined>) => buildListUrl("/events/public", { tag: tagFilter, view: view === "calendar" ? "calendar" : undefined }, extra);

  return c.html(
    <Layout title={t("events.title")}>
      <div class="max-w-4xl mx-auto">
      <PageHeader title={t("events.title")} />
      <TimezoneHint tz={tz} />
      <div class="filter-bar mb-6 flex flex-wrap gap-3 items-end">
        <div class="join">
          <a href={qs({ view: undefined })} class={`btn join-item ${view === "list" ? "btn-outline btn-primary" : "btn-ghost"}`}>{t("events.view.list")}</a>
          <a href={qs({ view: "calendar" })} class={`btn join-item ${view === "calendar" ? "btn-outline btn-primary" : "btn-ghost"}`}>{t("events.view.calendar")}</a>
        </div>
        <MultiSelectFilter param="tag" autoApply searchable options={allTags.map((tag) => ({ value: tag, label: tag }))} selected={tagFilter}
          allLabel={t("events.filter.allTags")} countLabel={(count) => t("events.filter.tagCount", { count })}
          applyLabel={t("common.apply")} resetLabel={t("common.reset")} searchPlaceholder={t("common.searchPlaceholder")} emptyLabel={t("events.filter.noTags")} />
      </div>
      {view === "calendar"
        ? <CalendarView rows={filtered.map((ev) => ({ ...ev, visibleRoles: [] }))} tz={tz} canManage={false} tagParam={tagFilter} noFetch />
        : <EventList rows={filtered.map((ev) => ({ ...ev, visibleRoles: [] }))} tz={tz} canManage={false} />}
      </div>
    </Layout>,
  );
});

// ── Formular ─────────────────────────────────────────────────────────────────

const DURATION_PRESETS: { key: string; label: string }[] = [
  { key: "1h", label: t("events.form.duration.1h") },
  { key: "2h", label: t("events.form.duration.2h") },
  { key: "3h", label: t("events.form.duration.3h") },
  { key: "halfDay", label: t("events.form.duration.halfDay") },
  { key: "fullDay", label: t("events.form.duration.fullDay") },
];

async function TagSuggestions(user: AuthedUser) {
  return <script type="application/json" id={TAG_SUGGESTIONS_ID} dangerouslySetInnerHTML={{ __html: tagSuggestionsJson(await eventTagVocabulary(user)) }} />;
}

function EventForm({ values, errors, roles }: {
  values: EventFormValues; errors: Record<string, string>; roles: { id: string; name: string }[];
}) {
  return (
    <form id="event-form" method="post" class="space-y-4 max-w-2xl">
      <Field label={t("events.form.title")} required after={errors.title && <span class="text-error text-sm">{errors.title}</span>}>
        <input type="text" name="title" value={values.title} placeholder={t("events.form.title")} maxlength={200} class={`input w-full${errors.title ? " input-error" : ""}`} required />
      </Field>

      <label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">
        <input type="checkbox" id="event-allday" name="allDay" checked={values.allDay} class="toggle" />
        <span>{t("events.form.allDay")}</span>
      </label>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("events.form.start")} required>
          <input type={values.allDay ? "date" : "datetime-local"} id="event-start" name="startsAt" value={values.startsAt} class={`input w-full${errors.dates ? " input-error" : ""}`} required />
        </Field>
        <Field label={t("events.form.end")} required
          after={<div class="flex gap-1 flex-wrap mt-1">{DURATION_PRESETS.map((p) => <button type="button" class="btn btn-xs" data-duration={p.key}>{p.label}</button>)}</div>}>
          <input type={values.allDay ? "date" : "datetime-local"} id="event-end" name="endsAt" value={values.endsAt} class={`input w-full${errors.dates ? " input-error" : ""}`} required />
        </Field>
      </div>
      {errors.dates && <p class="text-error text-sm">{errors.dates}</p>}

      <Field label={t("events.form.location")} after={errors.location && <span class="text-error text-sm">{errors.location}</span>}>
        <input type="text" name="location" value={values.location} placeholder={t("events.form.location")} maxlength={200} class={`input w-full${errors.location ? " input-error" : ""}`} />
      </Field>

      <Field label={t("events.form.description")} after={errors.description && <span class="text-error text-sm">{errors.description}</span>}>
        <textarea name="description" rows={4} maxlength={5000} class={`textarea w-full${errors.description ? " textarea-error" : ""}`}>{values.description}</textarea>
      </Field>

      <ChipInput name="tags" label={t("events.form.tags")} placeholder={t("events.form.tagsPlaceholder")} values={values.tags} splitOnComma caseSensitive={false} suggestionsFrom={`#${TAG_SUGGESTIONS_ID}`} />

      <FieldGroup legend={t("events.form.visibility")}>
        <div class="flex flex-col gap-2">
          {(["public", "loggedIn", "roles"] as const).map((v) => (
            <label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">
              <input type="radio" name="visibility" value={v} checked={values.visibility === v} class="radio" id={v === "roles" ? "event-visibility-roles" : undefined} />
              <span>{t(`events.form.visibility.${v}`)}</span>
            </label>
          ))}
        </div>
      </FieldGroup>

      <div id="event-roles" hidden={values.visibility !== "roles"}>
        <FieldGroup legend={t("events.form.roles")}>
          <div class="flex flex-col gap-1">
            {roles.map((r) => (
              <label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">
                <input type="checkbox" name="roleIds" value={r.id} checked={values.roleIds.includes(r.id)} class="checkbox" />
                <span>{r.name}</span>
              </label>
            ))}
          </div>
        </FieldGroup>
        {errors.roleIds && <p class="text-error text-sm">{errors.roleIds}</p>}
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const allDay = document.getElementById('event-allday');
          const start = document.getElementById('event-start');
          const end = document.getElementById('event-end');
          function setType(isAllDay) {
            start.type = isAllDay ? 'date' : 'datetime-local';
            end.type = isAllDay ? 'date' : 'datetime-local';
            if (isAllDay) { start.value = start.value.slice(0, 10); end.value = end.value.slice(0, 10); }
          }
          allDay.addEventListener('change', function() { setType(allDay.checked); });
          document.querySelectorAll('[data-duration]').forEach(function(btn) {
            btn.addEventListener('click', function() {
              if (!start.value) return;
              const s = new Date(start.value);
              const d = btn.dataset.duration;
              const e = new Date(s);
              if (d === '1h') e.setHours(e.getHours() + 1);
              else if (d === '2h') e.setHours(e.getHours() + 2);
              else if (d === '3h') e.setHours(e.getHours() + 3);
              else if (d === 'halfDay') e.setHours(e.getHours() + 4);
              else if (d === 'fullDay') e.setDate(e.getDate() + 1);
              const pad = (n) => String(n).padStart(2, '0');
              end.value = e.getFullYear() + '-' + pad(e.getMonth() + 1) + '-' + pad(e.getDate()) + 'T' + pad(e.getHours()) + ':' + pad(e.getMinutes());
            });
          });
          document.querySelectorAll('input[name=visibility]').forEach(function(r) {
            r.addEventListener('change', function() {
              document.getElementById('event-roles').hidden = !document.getElementById('event-visibility-roles').checked;
            });
          });
        })();
      ` }} />
    </form>
  );
}

function emptyFormValues(): EventFormValues {
  return { title: "", location: "", description: "", allDay: false, startsAt: "", endsAt: "", visibility: "loggedIn", tags: [], roleIds: [] };
}

async function loadRoles() {
  return db.select({ id: appRoles.id, name: appRoles.name }).from(appRoles).orderBy(asc(appRoles.name));
}

eventRoutes.get("/new", manage, async (c) => {
  const user = c.get("user")!;
  const [roles] = await Promise.all([loadRoles()]);
  return c.html(
    <Layout title={t("events.form.newTitle")} user={user} activeNav="events">
      <div class="max-w-2xl mx-auto">
      <PageHeader title={t("events.form.newTitle")} backHref="/events" actions={<FormActions formId="event-form" />} />
      <EventForm values={emptyFormValues()} errors={{}} roles={roles} />
      <TagSuggestions {...user} />
      </div>
    </Layout>,
  );
});

eventRoutes.post("/new", manage, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody({ all: true });
  const values = parseEventForm(body);
  const roles = await loadRoles();
  const tz = resolveTimezone(c);
  const result = validateEventForm(values, tz);

  if ("errors" in result) {
    return c.html(
      <Layout title={t("events.form.newTitle")} user={user} activeNav="events">
        <div class="max-w-2xl mx-auto">
        <PageHeader title={t("events.form.newTitle")} backHref="/events" actions={<FormActions formId="event-form" />} />
        <EventForm values={values} errors={result.errors} roles={roles} />
        <TagSuggestions {...user} />
        </div>
      </Layout>,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }

  await db.transaction(async (tx) => {
    const [row] = await tx.insert(events).values({
      title: values.title, location: values.location || null, description: values.description || null,
      allDay: values.allDay, startsAt: result.startsAt, endsAt: result.endsAt, visibility: values.visibility,
    }).returning({ id: events.id });
    await saveEventTagsAndRoles(tx as never, row.id, values.tags, values.visibility, values.roleIds);
  });

  setFlash(c, t("events.form.created"), "success");
  return c.redirect("/events");
});

async function fetchEventForEdit(id: string) {
  return db.query.events.findFirst({ where: eq(events.id, id), with: { tags: true, visibleRoles: true } });
}

function toEventFormValues(ev: NonNullable<Awaited<ReturnType<typeof fetchEventForEdit>>>, tz: string): EventFormValues {
  return {
    title: ev.title,
    location: ev.location ?? "",
    description: ev.description ?? "",
    allDay: ev.allDay,
    startsAt: ev.allDay ? toLocalInput(ev.startsAt, tz).slice(0, 10) : toLocalInput(ev.startsAt, tz),
    endsAt: ev.allDay ? toLocalInput(ev.endsAt, tz).slice(0, 10) : toLocalInput(ev.endsAt, tz),
    visibility: ev.visibility,
    tags: ev.tags.map((x) => x.tag),
    roleIds: ev.visibleRoles.map((x) => x.roleId),
  };
}

eventRoutes.get("/:id/edit", manage, async (c) => {
  const user = c.get("user")!;
  const ev = await fetchEventForEdit(c.req.param("id"));
  if (!ev) return c.notFound();
  const tz = resolveTimezone(c);
  const roles = await loadRoles();
  return c.html(
    <Layout title={t("events.form.editTitle")} user={user} activeNav="events">
      <div class="max-w-2xl mx-auto">
      <PageHeader title={t("events.form.editTitle")} backHref="/events" actions={<FormActions formId="event-form" />} />
      <EventForm values={toEventFormValues(ev, tz)} errors={{}} roles={roles} />
      <TagSuggestions {...user} />
      </div>
    </Layout>,
  );
});

eventRoutes.post("/:id/edit", manage, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const existing = await fetchEventForEdit(id);
  if (!existing) return c.notFound();

  const body = await c.req.parseBody({ all: true });
  const values = parseEventForm(body);
  const roles = await loadRoles();
  const tz = resolveTimezone(c);
  const result = validateEventForm(values, tz);

  if ("errors" in result) {
    return c.html(
      <Layout title={t("events.form.editTitle")} user={user} activeNav="events">
        <div class="max-w-2xl mx-auto">
        <PageHeader title={t("events.form.editTitle")} backHref="/events" actions={<FormActions formId="event-form" />} />
        <EventForm values={values} errors={result.errors} roles={roles} />
        <TagSuggestions {...user} />
        </div>
      </Layout>,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }

  await db.transaction(async (tx) => {
    await tx.update(events).set({
      title: values.title, location: values.location || null, description: values.description || null,
      allDay: values.allDay, startsAt: result.startsAt, endsAt: result.endsAt, visibility: values.visibility,
    }).where(eq(events.id, id));
    await saveEventTagsAndRoles(tx as never, id, values.tags, values.visibility, values.roleIds);
  });

  setFlash(c, t("events.form.saved"), "success");
  return c.redirect("/events");
});

eventRoutes.post("/:id/delete", manage, async (c) => {
  const id = c.req.param("id");
  await db.delete(events).where(eq(events.id, id));
  setFlash(c, t("events.form.deleted"), "success");

  const user = c.get("user")!;
  const tz = resolveTimezone(c);
  const rows = await fetchEvents(user, undefined);
  return c.html(<div id="events-results"><EventList rows={rows} tz={tz} canManage={true} /></div>);
});
