import { Hono, type Context } from "hono";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, eventTags, members, persons } from "../db/schema/index.js";
import { requireAuth, type Variables, type AuthedUser } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { Field, FieldGroup, ViewField, ViewGrid } from "../components/field.js";
import { Icon } from "../components/icon.js";
import { LocationPicker } from "../components/location-picker.js";
import { osmUrl, parseCoordinates } from "../lib/coordinates.js";
import { RowAction } from "../components/row-action.js";
import { ChipInput } from "../components/chip-input.js";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { addMonths, todayStr } from "../lib/quick-range.js";
import { parseMulti } from "../lib/list-query.js";
import { setFlash } from "../lib/flash.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { getSettings, setSetting } from "../lib/settings.js";
import { PublicFooter } from "../components/public-form.js";
import { ImpressumHint } from "../components/impressum-hint.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { tagSuggestionsJson, TAG_SUGGESTIONS_ID } from "../lib/tags.js";
import { EVENT_TAGS, eventTagDef, eventTagLabel, normalizeEventTags, sortEventTags, firstEventTagDef } from "../lib/event-tags.js";
import {
  eventTagVocabulary,
  overlapsRange,
  parseEventForm,
  saveEventTagsAndInvitees,
  findMembersByStatus,
  loadMemberNames,
  validateEventForm,
  visibilityCondition,
  type Event,
  type EventFormValues,
} from "../lib/events.js";
import { formatDateTime, formatDay, formatTime, resolveTimezone, toLocalDate, toLocalInput } from "../lib/datetime.js";

export const eventRoutes = new Hono<{ Variables: Variables }>();
const manage = requireAuth("events:manage");

type EventRow = Event & { tags: { tag: string }[]; invitees: { memberId: string }[] };

async function fetchEvents(user: AuthedUser | undefined, where: ReturnType<typeof and>): Promise<EventRow[]> {
  const cond = and(visibilityCondition(user), where);
  return db.query.events.findMany({ where: cond, with: { tags: true, invitees: true }, orderBy: asc(events.startsAt) }) as Promise<EventRow[]>;
}

// ── Umrechnung in die Zone des Nutzers ──────────────────────────────────────
// Nur bei abweichendem UTC-Offset (Browser vs. Wehr) erscheint "(bei dir …)" bzw. im Formular "= … bei dir".
// shortcut: Eingabe in der DST-Lücke wird im Hinweis nicht normalisiert, serverseitig schon (parseLocal).
function LocalTimes({ tz }: { tz: string }) {
  return <script dangerouslySetInnerHTML={{ __html: `
    (function () {
      var TZ = ${JSON.stringify(tz)}, here = ${JSON.stringify(t("events.localTime.here"))};
      var fmtParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      function tzOffset(ms) {
        var p = {}; fmtParts.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
      }
      function differs(ms) { return tzOffset(ms) !== -new Date(ms).getTimezoneOffset() * 60000; }
      var tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
      var df = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
      function fmt(ms) {
        var d = new Date(ms), wallDay = new Date(ms + tzOffset(ms)).getUTCDate();
        return (d.getDate() !== wallDay ? df.format(d) + " " : "") + tf.format(d);
      }
      window.localTimes = function (root) {
        (root || document).querySelectorAll("[data-utc-start]").forEach(function (el) {
          if (el.dataset.done) return;
          el.dataset.done = "1";
          var s = +el.dataset.utcStart, e = +el.dataset.utcEnd;
          if (!differs(s)) return;
          var span = document.createElement("span");
          span.className = "opacity-70";
          span.textContent = " (" + here + " " + fmt(s) + "–" + fmt(e) + ")";
          el.appendChild(span);
        });
      };
      window.localTimes();
      function wallToMs(v) {
        var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v);
        if (!m) return NaN;
        var g = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return g - tzOffset(g - tzOffset(g));
      }
      document.querySelectorAll("[data-local-hint]").forEach(function (hint) {
        var input = document.getElementById(hint.dataset.localHint), allDay = document.getElementById("event-allday");
        function update() {
          var ms = allDay && allDay.checked ? NaN : wallToMs(input.value);
          hint.hidden = isNaN(ms) || !differs(ms);
          if (!hint.hidden) hint.textContent = "= " + fmt(ms) + " " + here;
        }
        input.addEventListener("input", update);
        if (allDay) allDay.addEventListener("change", update);
        update();
      });
    })();
  ` }} />;
}

// ── Liste/Kalender ───────────────────────────────────────────────────────────

function EventTimeLabel({ ev, tz, card }: { ev: Event; tz: string; card?: boolean }) {
  if (ev.allDay) {
    const sameDay = toLocalDate(ev.startsAt, tz) === toLocalDate(ev.endsAt, tz);
    if (card && sameDay) return <>{t("events.allDayShort")}</>; // Datum steht schon im Datumsblock
    return <>{formatDay(ev.startsAt, tz)}{!sameDay && <> – {formatDay(ev.endsAt, tz)}</>}</>;
  }
  return <span data-utc-start={ev.startsAt.getTime()} data-utc-end={ev.endsAt.getTime()}>{formatDateTime(ev.startsAt, tz)} – {formatTime(ev.endsAt, tz)}</span>;
}

// Ort in der Liste: bei Koordinaten OSM-Link (neuer Tab, ohne Zeilenklick), sonst Text.
function EventPlace({ ev }: { ev: Pick<Event, "location" | "latitude" | "longitude"> }) {
  if (ev.latitude == null || ev.longitude == null) return <>{ev.location}</>;
  return <a href={osmUrl(ev.latitude, ev.longitude)} target="_blank" rel="noopener" class="link" onclick="event.stopPropagation()">{ev.location || t("events.location.onMap")}</a>;
}

// Koordinatenfeld des Formulars -> Spaltenwerte (leer = null).
const dbCoords = (raw: string) => { const c = parseCoordinates(raw); return { latitude: c.latitude || null, longitude: c.longitude || null }; };

function EventTagBadges({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return <div class="flex flex-wrap gap-1 mt-1">{sortEventTags(tags).map((tag) => <span class={`badge badge-sm ${eventTagDef(tag)?.badge ?? "badge-outline"}`}>{eventTagLabel(tag)}</span>)}</div>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const MONTH_ABBR = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];

// Terminliste (öffentlich + intern): Monatsüberschrift steckt im Wrapper der ersten Karte des Monats.
function EventCards({ rows, tz, canManage, linked }: { rows: EventRow[]; tz: string; canManage: boolean; linked: boolean }) {
  let prev = "";
  return (
    <>
      {rows.map((ev) => {
        const day = toLocalDate(ev.startsAt, tz);
        const month = day.slice(0, 7);
        const heading = month !== prev;
        prev = month;
        const orphanMembers = ev.visibility === "members" && ev.invitees.length === 0;
        const monthIdx = Number(day.slice(5, 7)) - 1;
        return (
          <div data-date={day} data-month={month} class="scroll-mt-20 mb-6">
            {heading && <h2 class="text-xl font-bold mt-4 mb-3">{new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00Z`))}</h2>}
            <div class={`flex gap-3 sm:gap-4 py-1 ${linked ? "cursor-pointer" : ""}`} onclick={linked ? `location.href='/events/${ev.id}'` : undefined}>
              <div class="bg-primary text-primary-content rounded-box shrink-0 w-14 sm:w-16 flex flex-col items-center justify-center py-2 leading-tight">
                <span class="text-xl sm:text-2xl font-bold">{Number(day.slice(8, 10))}</span>
                <span class="text-xs uppercase">{MONTH_ABBR[monthIdx]}</span>
                <span class="text-xs opacity-80">{day.slice(0, 4)}</span>
              </div>
              <div class="min-w-0 space-y-1 lg:space-y-1.5">
                <div class="font-medium lg:text-lg">{ev.title}{orphanMembers && <span class="badge badge-sm badge-warning ml-2">{t("events.orphanMembers")}</span>}</div>
                <div class="text-sm opacity-70"><EventTimeLabel ev={ev} tz={tz} card />{(ev.location || ev.latitude != null) && <> · <EventPlace ev={ev} /></>}</div>
                {ev.description && <p class="text-sm opacity-70 line-clamp-3">{ev.description}</p>}
                <EventTagBadges tags={ev.tags.map((x) => x.tag)} />
              </div>
              {canManage && (
                <div class="ml-auto shrink-0">
                  <RowAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" attrs={{
                    "hx-post": `/events/${ev.id}/delete`, "hx-confirm": t("events.confirmDelete", { title: ev.title }), "hx-target": "closest [data-date]", "hx-swap": "outerHTML",
                  }} onclick="event.stopPropagation()" />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ?rows=YYYY-MM liefert nur die Einträge dieses Monats (Nachladen beim Scrollen).
function monthFragment(c: Context, rows: EventRow[], tz: string, canManage: boolean, linked: boolean) {
  const m = c.req.query("rows");
  if (!m || !MONTH_RE.test(m)) return null;
  const month = rows.filter((ev) => toLocalDate(ev.startsAt, tz).startsWith(m));
  return c.html(<EventCards rows={month} tz={tz} canManage={canManage} linked={linked} />);
}

// Kalender + Liste. Die Liste zeigt ein gleitendes Fenster aus Fokusmonat ± 1 (nur Monate mit Terminen), der Rest kommt per ?rows= nach.
function EventsBrowser({ rows, tz, canManage, base, tagFilter, monthParam }: { rows: EventRow[]; tz: string; canManage: boolean; base: string; tagFilter: string[]; monthParam?: string }) {
  if (!rows.length) return <p class="text-base-content/60 py-8">{t(tagFilter.length ? "events.emptyFiltered" : "events.empty")}</p>;
  const days = [...new Set(rows.map((ev) => toLocalDate(ev.startsAt, tz)))];
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const wanted = monthParam && MONTH_RE.test(monthParam) ? monthParam : todayStr().slice(0, 7);
  const fi = Math.max(0, months.findIndex((m) => m >= wanted) < 0 ? months.length - 1 : months.findIndex((m) => m >= wanted));
  const shown = new Set(months.slice(Math.max(0, fi - 1), fi + 2));
  const dayTags = new Map<string, string[]>();
  for (const ev of rows) { const d = toLocalDate(ev.startsAt, tz); dayTags.set(d, [...(dayTags.get(d) ?? []), ...ev.tags.map((x) => x.tag)]); }
  const dayColors: Record<string, { c: string; l: string }> = {};
  for (const [d, tg] of dayTags) { const def = firstEventTagDef(tg); if (def) dayColors[d] = { c: def.color, l: eventTagLabel(def.key) }; }
  const data = { days, months, focus: months[fi], base, tags: tagFilter, dayColors };
  return (
    <>
      <div class="mb-4 flex items-center gap-3">
        <div class="join lg:hidden">
          <button type="button" data-ev-m="list" class="btn join-item btn-outline btn-primary">{t("events.view.list")}</button>
          <button type="button" data-ev-m="cal" class="btn join-item btn-ghost">{t("events.view.calendar")}</button>
        </div>
        <label class="hidden lg:flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="ev-cal-toggle" class="toggle toggle-sm" checked />
          <span>{t("events.calendar.show")}</span>
        </label>
      </div>
      <div id="ev-wrap" data-m="list" data-dc="1" class="group lg:flex lg:gap-6 lg:items-start">
        <div class="hidden group-data-[m=cal]:block lg:group-data-[dc=1]:block lg:group-data-[dc=0]:hidden lg:w-80 lg:shrink-0 lg:sticky lg:top-20">
          <div id="ev-calendar"></div>
        </div>
        <div class="min-w-0 flex-1 group-data-[m=cal]:hidden lg:group-data-[m=cal]:block">
          <div id="ev-rows"><EventCards rows={rows.filter((ev) => shown.has(toLocalDate(ev.startsAt, tz).slice(0, 7)))} tz={tz} canManage={canManage} linked={base === "/events"} /></div>
        </div>
      </div>
      <script type="application/json" id="ev-data" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />
      <link rel="stylesheet" href="/css/vanilla-calendar.css" />
      <style>{`#ev-calendar [data-vc-date]:not([data-vc-date-disabled]) [data-vc-date-btn]{background-image:radial-gradient(circle at 50% calc(100% - 5px),var(--ev-dot,currentColor) 2.5px,transparent 3px)}`}</style>
      <script type="module" dangerouslySetInnerHTML={{ __html: EVENTS_SCRIPT }} />
    </>
  );
}

const EVENTS_SCRIPT = `
  import { Calendar } from "/js/vanilla-calendar.min.js";
  const cfg = JSON.parse(document.getElementById("ev-data").textContent);
  const { days, months } = cfg;
  const wrap = document.getElementById("ev-wrap");
  const tbody = document.getElementById("ev-rows");
  const ITEM = "[data-month]";
  const toggle = document.getElementById("ev-cal-toggle");
  const rows = (sel) => [...tbody.querySelectorAll(sel)];
  const isDesktop = () => matchMedia("(min-width: 1024px)").matches;
  const pad = (n) => String(n).padStart(2, "0");

  wrap.dataset.dc = localStorage.getItem("ev-cal") === "0" ? "0" : "1";
  toggle.checked = wrap.dataset.dc === "1";
  toggle.onchange = () => { wrap.dataset.dc = toggle.checked ? "1" : "0"; localStorage.setItem("ev-cal", wrap.dataset.dc); };
  function setMobile(m) {
    wrap.dataset.m = m;
    document.querySelectorAll("[data-ev-m]").forEach((b) => {
      const on = b.dataset.evM === m;
      b.classList.toggle("btn-outline", on); b.classList.toggle("btn-primary", on); b.classList.toggle("btn-ghost", !on);
    });
  }
  document.querySelectorAll("[data-ev-m]").forEach((b) => { b.onclick = () => setMobile(b.dataset.evM); });

  const idxOf = (m) => { const i = months.findIndex((x) => x >= m); return i < 0 ? months.length - 1 : i; };
  const topRow = () => rows(ITEM).find((tr) => tr.getBoundingClientRect().bottom > 90) || null;

  // Fenster = Monate i-1..i+1; ältere/entfernte Monate fliegen raus, Scrollposition wird am obersten Eintrag festgehalten.
  async function ensureWindow(i) {
    const want = months.slice(Math.max(0, i - 1), i + 2);
    const have = new Set(rows(ITEM).map((tr) => tr.dataset.month));
    const need = want.filter((m) => !have.has(m));
    const drop = [...have].filter((m) => !want.includes(m));
    if (!need.length && !drop.length) return;
    const qs = cfg.tags.map((t) => "&tag=" + encodeURIComponent(t)).join("");
    const parts = await Promise.all(need.map(async (m) => {
      const res = await fetch(cfg.base + "?rows=" + m + qs);
      return [m, res.ok ? await res.text() : ""];
    }));
    const anchor = topRow();
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    rows(ITEM).forEach((tr) => { if (drop.includes(tr.dataset.month)) tr.remove(); });
    for (const [m, html] of parts) {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      tbody.insertBefore(tpl.content, rows(ITEM).find((tr) => tr.dataset.month > m) || null);
    }
    if (anchor && anchor.isConnected) scrollBy(0, anchor.getBoundingClientRect().top - before);
    if (window.localTimes) window.localTimes(tbody);
  }
  let chain = Promise.resolve();
  const ensure = (i) => (chain = chain.then(() => ensureWindow(i)));

  let lock = 0, markedDate = "", shownYm = cfg.focus, curMonth = "";
  function setUrl() {
    const u = new URL(location.href);
    u.searchParams.set("month", curMonth);
    history.replaceState(null, "", u);
  }
  function mark(d) {
    markedDate = d; shownYm = d.slice(0, 7);
    calendar.set({ selectedDates: [d], selectedMonth: Number(d.slice(5, 7)) - 1, selectedYear: Number(d.slice(0, 4)) });
  }
  function flash(d) {
    rows('[data-date="' + d + '"]').forEach((tr) => {
      tr.style.transition = "background-color .4s";
      tr.style.backgroundColor = "color-mix(in oklab, var(--color-warning) 35%, transparent)";
      setTimeout(() => { tr.style.backgroundColor = ""; }, 1500);
    });
  }
  // target: "YYYY-MM-DD" (erster Eintrag des Tages) oder "YYYY-MM" (erster Eintrag ab diesem Monat)
  async function jump(target) {
    lock = Infinity;
    await ensure(idxOf(target.slice(0, 7)));
    const tr = target.length > 7 ? rows('[data-date="' + target + '"]')[0] : rows(ITEM).find((r) => r.dataset.month >= target);
    if (tr) {
      tr.scrollIntoView();
      curMonth = tr.dataset.month; setUrl();
      if (target.length > 7) flash(target);
    }
    lock = Date.now() + 250;
  }

  function syncFromCalendar(self) {
    const ym = self.selectedYear + "-" + pad(self.selectedMonth + 1);
    if (ym === shownYm) return;
    shownYm = ym;
    if (isDesktop()) jump(ym);
  }
  const first = new Date(days[0] + "T00:00:00");
  const calendar = new Calendar(document.getElementById("ev-calendar"), {
    locale: "de-DE", firstWeekday: 1,
    dateMin: days[0], dateMax: days[days.length - 1],
    disableAllDates: true, enableDates: days, enableDateToggle: false,
    selectedMonth: Number(cfg.focus.slice(5)) - 1, selectedYear: Number(cfg.focus.slice(0, 4)),
    onClickDate(self) {
      const d = self.context.selectedDates[0];
      if (!d) return;
      markedDate = d; shownYm = d.slice(0, 7);
      setMobile("list");
      jump(d);
    },
    onCreateDateEls(self, el) {
      const dc = cfg.dayColors[el.dataset.vcDate];
      if (!dc) return;
      el.firstElementChild.style.setProperty("--ev-dot", "var(--color-" + dc.c + ")");
      el.title = dc.l;
    },
    onClickArrow: syncFromCalendar, onClickMonth: syncFromCalendar, onClickYear: syncFromCalendar,
  });
  calendar.init();

  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (Date.now() < lock) return;
      const tr = topRow();
      if (!tr) return;
      if (tr.dataset.date !== markedDate) mark(tr.dataset.date);
      if (tr.dataset.month !== curMonth) { curMonth = tr.dataset.month; setUrl(); ensure(idxOf(curMonth)); }
    });
  }, { passive: true });

  curMonth = cfg.focus;
  jump(cfg.focus);
`;

// ── /events ──────────────────────────────────────────────────────────────────

eventRoutes.get("/", requireAuth(), async (c) => {
  c.header("Cache-Control", "private, no-store"); // rechteabhängige Liste: nie in geteilten Caches
  const user = c.get("user")!;
  const canManage = user.permissions.has("events:manage");
  const tz = resolveTimezone(c);
  const freeTags = await eventTagVocabulary(user);
  const allTags = [...EVENT_TAGS.map((d) => d.key as string), ...freeTags];
  const tagFilter = parseMulti(normalizeEventTags(c.req.queries("tag") ?? []), allTags);
  const publicEnabled = (await getSettings()).eventsPublicEnabled === "true";

  // shortcut: lädt alle sichtbaren Termine für Kalendertage/Monatsliste, bei sehr vielen Terminen auf Monatsabfragen umstellen.
  let rows = await fetchEvents(user, undefined);
  if (tagFilter.length) rows = rows.filter((ev) => tagFilter.every((tag) => ev.tags.some((x) => x.tag === tag)));
  const fragment = monthFragment(c, rows, tz, canManage, true);
  if (fragment) return fragment;

  return c.html(
    <Layout title={t("events.title")} user={user}>
      <div class="max-w-6xl mx-auto">
      <PageHeader title={t("events.title")} actions={<>
        {canManage ? (
          <div class="dropdown dropdown-end">
            <div tabindex={0} role="button" class="btn btn-ghost gap-2" aria-label={`${t("events.publicLink")}: ${publicEnabled ? t("events.publicSettings.on") : t("events.publicSettings.off")}`}>
              <Icon name="link" class="h-5 w-5" />
              <span class="hidden sm:inline">{t("events.publicLink")}</span>
              <span class={`inline-block h-2 w-2 rounded-full ${publicEnabled ? "bg-success" : "bg-error"}`} />
            </div>
            <div tabindex={0} class="dropdown-content bg-base-200 rounded-box z-10 w-72 p-3 shadow space-y-2">
              <form method="post" action="/events/public-settings">
                <label class="label cursor-pointer justify-between gap-3">
                  <span class="text-sm">{publicEnabled ? t("events.publicSettings.on") : t("events.publicSettings.off")}</span>
                  <input type="checkbox" name="enabled" value="1" class="toggle toggle-success" checked={publicEnabled} onchange="this.form.submit()" />
                </label>
              </form>
              {publicEnabled ? (
                <div class="flex items-center gap-2">
                  <a href="/events/public" target="_blank" rel="noopener" class="btn btn-sm btn-ghost flex-1 justify-start">
                    <Icon name="arrow-top-right-on-square" class="h-4 w-4" />{t("events.publicSettings.open")}
                  </a>
                  <button type="button" class="btn btn-sm btn-ghost btn-square" title={t("applications.links.copy")} aria-label={t("applications.links.copy")}
                    data-url={new URL("/events/public", env.OIDC_APP_URL).toString()}
                    onclick={`navigator.clipboard.writeText(this.dataset.url).then(function(){document.body.dispatchEvent(new CustomEvent('showToast',{detail:{message:${JSON.stringify(t("applications.links.copied"))},type:'info'}}))})`}>
                    <Icon name="clipboard-document" class="h-4 w-4" />
                  </button>
                </div>
              ) : <p class="text-xs opacity-60">{t("events.publicSettings.hint")}</p>}
              <ImpressumHint />
            </div>
          </div>
        ) : publicEnabled && <HeaderAction icon="arrow-top-right-on-square" label={t("events.publicLink")} href="/events/public" attrs={{ target: "_blank", rel: "noopener" }} />}
        {canManage && <HeaderAction variant="primary" icon="plus" label={t("common.create")} href="/events/new" class="btn-primary" />}
      </>} />
      <LocalTimes tz={tz} />
      <div class="filter-bar mb-6 flex flex-wrap gap-3 items-end">
        <MultiSelectFilter param="tag" autoApply searchable options={allTags.map((tag) => ({ value: tag, label: eventTagLabel(tag) }))} selected={tagFilter}
          allLabel={t("events.filter.allTags")} countLabel={(count) => t("events.filter.tagCount", { count })}
          applyLabel={t("common.apply")} resetLabel={t("common.reset")} searchPlaceholder={t("common.searchPlaceholder")} emptyLabel={t("events.filter.noTags")} />
      </div>

      <EventsBrowser rows={rows} tz={tz} canManage={canManage} base="/events" tagFilter={tagFilter} monthParam={c.req.query("month")} />
      </div>
    </Layout>,
  );
});

// ── /events/public ───────────────────────────────────────────────────────────

const PUBLIC_WINDOW_MONTHS = 12;
const PUBLIC_MAX_ROWS = 200;

eventRoutes.post("/public-settings", manage, async (c) => {
  const body = await c.req.parseBody();
  await setSetting("eventsPublicEnabled", body.enabled === "1" ? "true" : "false");
  setFlash(c, t("events.publicSettings.saved"), "success");
  return c.redirect("/events");
});

eventRoutes.get("/public", async (c) => {
  if ((await getSettings()).eventsPublicEnabled !== "true") return c.notFound();
  const tz = resolveTimezone(c);
  const today = todayStr();
  const rows = (await db.query.events.findMany({
    where: and(eq(events.visibility, "public"), overlapsRange(today, addMonths(today, PUBLIC_WINDOW_MONTHS), tz)),
    with: { tags: true },
    orderBy: asc(events.startsAt),
    limit: PUBLIC_MAX_ROWS,
  })) as (Event & { tags: { tag: string }[] })[];

  const filtered = rows.map((ev) => ({ ...ev, invitees: [] }));

  if (!env.EVENTS_PUBLIC_INDEXING) c.header("X-Robots-Tag", "noindex");
  c.header("Cache-Control", "public, max-age=60");

  const fragment = monthFragment(c, filtered, tz, false, false);
  if (fragment) return fragment;

  return c.html(
    <Layout title={t("events.title")}>
      <div class="max-w-6xl mx-auto">
      <PageHeader title={t("events.title")} />
      <LocalTimes tz={tz} />
      <EventsBrowser rows={filtered} tz={tz} canManage={false} base="/events/public" tagFilter={[]} monthParam={c.req.query("month")} />
      <PublicFooter />
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
  return <script type="application/json" id={TAG_SUGGESTIONS_ID} dangerouslySetInnerHTML={{ __html: tagSuggestionsJson([...EVENT_TAGS.map((d) => eventTagLabel(d.key)), ...(await eventTagVocabulary(user))]) }} />;
}

async function EventForm({ values, errors, invitees, tz }: {
  values: EventFormValues; errors: Record<string, string>; invitees: { id: string; name: string }[]; tz: string;
}) {
  const publicEnabled = (await getSettings()).eventsPublicEnabled === "true";
  const indexing = publicEnabled && !!env.EVENTS_PUBLIC_INDEXING;
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
          <p class="text-xs opacity-70 mt-1" data-local-hint="event-start" hidden></p>
        </Field>
        <Field label={values.allDay ? t("events.form.endOptional") : t("events.form.end")} required={!values.allDay}
          after={<div id="event-durations" hidden={values.allDay} class="flex gap-1 flex-wrap mt-1">{DURATION_PRESETS.map((p) => <button type="button" class="btn btn-xs" data-duration={p.key}>{p.label}</button>)}</div>}>
          <input type={values.allDay ? "date" : "datetime-local"} id="event-end" name="endsAt" data-label={t("events.form.end")} data-label-optional={t("events.form.endOptional")} value={values.endsAt} class={`input w-full${errors.dates ? " input-error" : ""}`} required={!values.allDay} />
          <p class="text-xs opacity-70 mt-1" data-local-hint="event-end" hidden></p>
        </Field>
      </div>
      {errors.dates && <p class="text-error text-sm">{errors.dates}</p>}

      <Field label={t("events.form.location")} after={errors.location && <span class="text-error text-sm">{errors.location}</span>}>
        <input type="text" name="location" value={values.location} placeholder={t("events.form.location")} maxlength={200} class={`input w-full${errors.location ? " input-error" : ""}`} />
      </Field>

      <LocationPicker
        value={values.coordinates}
        error={errors.coordinates}
        labels={{
          coordinates: t("inventory.form.coordinates"), hint: t("inventory.form.coordinatesHint"), geoError: t("inventory.form.geoError"),
          useLocation: t("inventory.form.useLocation"), attribution: t("inventory.map.attribution"), mapAria: t("inventory.form.mapAria"),
          apply: t("inventory.form.applyCoordinates"),
        }}
      />

      <Field label={t("events.form.description")} after={errors.description && <span class="text-error text-sm">{errors.description}</span>}>
        <textarea name="description" rows={4} maxlength={5000} class={`textarea w-full${errors.description ? " textarea-error" : ""}`}>{values.description}</textarea>
      </Field>

      <ChipInput name="tags" label={t("events.form.tags")} placeholder={t("events.form.tagsPlaceholder")} values={sortEventTags(values.tags)} presets={EVENT_TAGS.map((d) => ({ key: d.key, label: eventTagLabel(d.key), badge: d.badge }))} splitOnComma caseSensitive={false} suggestionsFrom={`#${TAG_SUGGESTIONS_ID}`} />

      <FieldGroup legend={t("events.form.visibility")}>
        <div class="flex flex-col gap-2">
          {(["loggedIn", "members", "public"] as const).map((v) => {
            const pub = v === "public";
            return (
              <label class={`group flex items-start gap-3 rounded-box border border-base-300 p-3 cursor-pointer pointer-coarse:min-h-11 ${pub ? "has-[:checked]:border-warning has-[:checked]:bg-warning/10" : "has-[:checked]:border-primary has-[:checked]:bg-primary/5"}`}>
                <input type="radio" name="visibility" value={v} checked={values.visibility === v} class="radio mt-1" id={v === "members" ? "event-visibility-members" : undefined} />
                <span class="flex flex-col gap-1">
                  <span class="font-medium">{t(`events.form.visibility.${v}`)}</span>
                  <span class="text-sm text-base-content/70">{t(`events.form.visibility.${v}.desc`)}</span>
                  {pub && (
                    <span class="hidden group-has-[:checked]:flex flex-col gap-1 text-sm">
                      <span>{t(publicEnabled ? "events.form.visibility.public.warnEnabled" : "events.form.visibility.public.warnDisabled")}</span>
                      {indexing && <span>{t("events.form.visibility.public.warnIndexing")}</span>}
                      <span>{t("events.form.visibility.public.warnPersonal")}</span>
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </FieldGroup>

      <div id="event-members" hidden={values.visibility !== "members"} class="space-y-2">
        <FieldGroup legend={t("events.form.members")}>
          <div class="flex flex-col gap-2">
            <EntityPicker searchUrl="/events/search-members" placeholder={t("events.form.membersSearch")} />
            <div class="flex flex-wrap items-center gap-1" id="event-member-groups">
              {(["active", "youth", "children", "passive", "supporting"] as const).map((st) => (
                <button type="button" class="btn btn-xs btn-ghost" aria-pressed="false" data-status={st}>{t(`status.${st}`)}</button>
              ))}
              <button type="button" class="btn btn-xs btn-primary" id="event-member-add" data-label={t("events.form.membersAdd")} disabled>{t("events.form.membersAdd")}</button>
            </div>
            <div id="event-member-chips" class="flex flex-wrap gap-1" data-remove={t("common.remove")}>
              {invitees.map((m) => (
                <span class="badge badge-lg gap-1" data-member-chip={m.id}>
                  <input type="hidden" name="memberIds" value={m.id} />{m.name}
                  <button type="button" class="btn btn-ghost btn-xs btn-circle" aria-label={t("common.remove")} data-chip-remove>×</button>
                </span>
              ))}
            </div>
          </div>
        </FieldGroup>
      </div>

      <LocalTimes tz={tz} />
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const allDay = document.getElementById('event-allday');
          const start = document.getElementById('event-start');
          const end = document.getElementById('event-end');
          function setType(isAllDay) {
            document.getElementById('event-durations').hidden = isAllDay;
            start.type = isAllDay ? 'date' : 'datetime-local';
            end.type = isAllDay ? 'date' : 'datetime-local';
            end.required = !isAllDay;
            const lbl = end.parentElement.firstElementChild;
            lbl.textContent = isAllDay ? end.dataset.labelOptional : end.dataset.label;
            if (!isAllDay) { const star = document.createElement('span'); star.className = 'text-error ml-1'; star.textContent = '*'; lbl.appendChild(star); }
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
              document.getElementById('event-members').hidden = !document.getElementById('event-visibility-members').checked;
            });
          });
          // Mitgliederauswahl: Chips mit Hidden-Feld memberIds; Statusbuttons sind Oder-verknüpfte Toggles.
          const chips = document.getElementById('event-member-chips');
          const addBtn = document.getElementById('event-member-add');
          const box = document.getElementById('event-members');
          let found = [];
          function addChip(id, name) {
            if (chips.querySelector('[data-member-chip="' + id + '"]')) return;
            const span = document.createElement('span');
            span.className = 'badge badge-lg gap-1'; span.dataset.memberChip = id;
            const inp = document.createElement('input'); inp.type = 'hidden'; inp.name = 'memberIds'; inp.value = id;
            const x = document.createElement('button'); x.type = 'button'; x.className = 'btn btn-ghost btn-xs btn-circle'; x.dataset.chipRemove = ''; x.setAttribute('aria-label', chips.dataset.remove); x.textContent = '×';
            span.append(inp, name, x); chips.appendChild(span);
          }
          chips.addEventListener('click', function(e) { const x = e.target.closest('[data-chip-remove]'); if (x) x.parentElement.remove(); });
          box.addEventListener('picker:select', function(e) {
            addChip(e.detail.id, e.detail.name);
            const root = e.target.closest('[data-picker]'); const clr = root && root.querySelector('.picker-clear'); if (clr) clr.click();
          });
          function refreshGroups() {
            const sel = Array.from(document.querySelectorAll('#event-member-groups [data-status][aria-pressed=true]')).map(function(b) { return b.dataset.status; });
            if (!sel.length) { found = []; addBtn.disabled = true; addBtn.textContent = addBtn.dataset.label; return; }
            fetch('/events/members-by-status?' + sel.map(function(s) { return 'status=' + s; }).join('&'), { headers: { Accept: 'application/json' } })
              .then(function(r) { return r.json(); })
              .then(function(list) { found = list; addBtn.disabled = !list.length; addBtn.textContent = addBtn.dataset.label + ' (' + list.length + ')'; });
          }
          document.querySelectorAll('#event-member-groups [data-status]').forEach(function(b) {
            b.addEventListener('click', function() {
              const on = b.getAttribute('aria-pressed') !== 'true';
              b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('btn-ghost', !on); b.classList.toggle('btn-primary', on);
              refreshGroups();
            });
          });
          addBtn.addEventListener('click', function() { found.forEach(function(m) { addChip(m.id, m.name); }); });
        })();
      ` }} />
    </form>
  );
}

function emptyFormValues(): EventFormValues {
  return { title: "", location: "", coordinates: "", description: "", allDay: false, startsAt: "", endsAt: "", visibility: "loggedIn", tags: [], memberIds: [] };
}

// GET /events/search-members — Suche für die Mitgliederauswahl (nur aktive Mitglieder).
eventRoutes.get("/search-members", manage, async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");
  const needle = `%${q}%`;
  const rows = await db.select({ id: members.id, firstName: persons.firstName, lastName: persons.lastName }).from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(or(ilike(persons.firstName, needle), ilike(persons.lastName, needle)), isNull(members.exitDate), isNull(members.deathDate)))
    .orderBy(asc(persons.lastName), asc(persons.firstName)).limit(10);
  return c.html(<PickerOptions empty={t("picker.noResults", { query: q })} options={rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }))} />);
});

// GET /events/members-by-status?status=active&status=youth — aktive Mitglieder der Statusgruppen (Oder), für die Schnellbuttons.
eventRoutes.get("/members-by-status", manage, async (c) => c.json(await findMembersByStatus(c.req.queries("status") ?? [])));

eventRoutes.get("/new", manage, async (c) => {
  const user = c.get("user")!;
  const tz = resolveTimezone(c);
  return c.html(
    <Layout title={t("events.form.newTitle")} user={user}>
      <div class="max-w-2xl mx-auto">
      <PageHeader title={t("events.form.newTitle")} backHref="/events" actions={<FormActions formId="event-form" />} />
      <EventForm values={emptyFormValues()} errors={{}} invitees={[]} tz={tz} />
      <TagSuggestions {...user} />
      </div>
    </Layout>,
  );
});

eventRoutes.post("/new", manage, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody({ all: true });
  const values = parseEventForm(body);
  const tz = resolveTimezone(c);
  const result = validateEventForm(values, tz);

  if ("errors" in result) {
    const invitees = await loadMemberNames(values.memberIds);
    return c.html(
      <Layout title={t("events.form.newTitle")} user={user}>
        <div class="max-w-2xl mx-auto">
        <PageHeader title={t("events.form.newTitle")} backHref="/events" actions={<FormActions formId="event-form" />} />
        <EventForm values={values} errors={result.errors} invitees={invitees} tz={tz} />
        <TagSuggestions {...user} />
        </div>
      </Layout>,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }

  let newId = "";
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(events).values({
      title: values.title, location: values.location || null, ...dbCoords(values.coordinates), description: values.description || null,
      allDay: values.allDay, startsAt: result.startsAt, endsAt: result.endsAt, visibility: values.visibility,
    }).returning({ id: events.id });
    newId = row.id;
    await saveEventTagsAndInvitees(tx as never, row.id, values.tags, values.visibility, values.memberIds);
  });

  setFlash(c, t("events.form.created"), "success");
  return c.redirect(`/events/${newId}`);
});

async function fetchEventForEdit(id: string) {
  return db.query.events.findFirst({ where: eq(events.id, id), with: { tags: true, invitees: true } });
}

function toEventFormValues(ev: NonNullable<Awaited<ReturnType<typeof fetchEventForEdit>>>, tz: string): EventFormValues {
  return {
    title: ev.title,
    location: ev.location ?? "",
    coordinates: ev.latitude != null && ev.longitude != null ? `${ev.latitude}, ${ev.longitude}` : "",
    description: ev.description ?? "",
    allDay: ev.allDay,
    startsAt: ev.allDay ? toLocalInput(ev.startsAt, tz).slice(0, 10) : toLocalInput(ev.startsAt, tz),
    endsAt: ev.allDay ? toLocalInput(ev.endsAt, tz).slice(0, 10) : toLocalInput(ev.endsAt, tz),
    visibility: ev.visibility,
    tags: ev.tags.map((x) => x.tag),
    memberIds: ev.invitees.map((x) => x.memberId),
  };
}

eventRoutes.get("/:id", requireAuth(), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const ev = await db.query.events.findFirst({ where: and(eq(events.id, id), visibilityCondition(user)), with: { tags: true, invitees: true } });
  if (!ev) return c.notFound();
  const tz = resolveTimezone(c);
  const canManage = user.permissions.has("events:manage");
  return c.html(
    <Layout title={ev.title} user={user}>
      <div class="max-w-2xl mx-auto">
      <PageHeader title={ev.title} backHref="/events" actions={<DetailActions editHref={canManage ? `/events/${ev.id}/edit` : undefined} remove={canManage && <HeaderAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" attrs={{ "hx-post": `/events/${ev.id}/delete?from=detail`, "hx-confirm": t("events.confirmDelete", { title: ev.title }), "hx-swap": "none" }} />} />} />
      <LocalTimes tz={tz} />
      <ViewGrid>
        <div class="sm:col-span-2"><div class="text-sm opacity-60">{t("events.form.start")}</div><div class="font-medium"><EventTimeLabel ev={ev} tz={tz} /></div></div>
        <ViewField label={t("events.form.location")} value={ev.location} />
        {ev.latitude != null && ev.longitude != null && (
          <div class="sm:col-span-2 space-y-2">
            <link rel="stylesheet" href="/css/leaflet.css" />
            <div id="location-view-map" role="region" aria-label={t("events.location.mapAria")} data-lat={ev.latitude} data-lng={ev.longitude} data-status="none" data-icon={(<Icon name="calendar-days" />).toString()} data-attribution={t("inventory.map.attribution")} class="h-56 rounded-box border border-base-300 z-0" />
            <script src="/js/location-view.min.js" defer></script>
            <a href={osmUrl(ev.latitude, ev.longitude)} target="_blank" rel="noopener noreferrer" class="link">{t("inventory.location.osm")}</a>
          </div>
        )}
        <ViewField label={t("events.form.visibility")} value={t(`events.form.visibility.${ev.visibility as "public" | "loggedIn" | "members"}`)} />
        <div class="sm:col-span-2"><div class="text-sm opacity-60">{t("events.form.description")}</div><div class="font-medium whitespace-pre-wrap">{ev.description || "—"}</div></div>
        <div class="sm:col-span-2"><EventTagBadges tags={ev.tags.map((x) => x.tag)} /></div>
      </ViewGrid>
      </div>
    </Layout>,
  );
});

eventRoutes.get("/:id/edit", requireAuth(), async (c) => {
  const user = c.get("user")!;
  const ev = await fetchEventForEdit(c.req.param("id"));
  if (!ev) return c.notFound();
  if (!user.permissions.has("events:manage")) return c.redirect(`/events/${ev.id}`);
  const tz = resolveTimezone(c);
  const invitees = await loadMemberNames(ev.invitees.map((x) => x.memberId));
  return c.html(
    <Layout title={t("events.form.editTitle")} user={user}>
      <div class="max-w-2xl mx-auto">
      <PageHeader title={t("events.form.editTitle")} backHref="/events" actions={<FormActions formId="event-form" cancelHref={`/events/${ev.id}`} />} />
      <EventForm values={toEventFormValues(ev, tz)} errors={{}} invitees={invitees} tz={tz} />
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
  const tz = resolveTimezone(c);
  const result = validateEventForm(values, tz);

  if ("errors" in result) {
    const invitees = await loadMemberNames(values.memberIds);
    return c.html(
      <Layout title={t("events.form.editTitle")} user={user}>
        <div class="max-w-2xl mx-auto">
        <PageHeader title={t("events.form.editTitle")} backHref="/events" actions={<FormActions formId="event-form" cancelHref={`/events/${id}`} />} />
        <EventForm values={values} errors={result.errors} invitees={invitees} tz={tz} />
        <TagSuggestions {...user} />
        </div>
      </Layout>,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }

  await db.transaction(async (tx) => {
    await tx.update(events).set({
      title: values.title, location: values.location || null, ...dbCoords(values.coordinates), description: values.description || null,
      allDay: values.allDay, startsAt: result.startsAt, endsAt: result.endsAt, visibility: values.visibility,
    }).where(eq(events.id, id));
    await saveEventTagsAndInvitees(tx as never, id, values.tags, values.visibility, values.memberIds);
  });

  setFlash(c, t("events.form.saved"), "success");
  return c.redirect(`/events/${id}`);
});

eventRoutes.post("/:id/delete", manage, async (c) => {
  const id = c.req.param("id");
  await db.delete(events).where(eq(events.id, id));
  setFlash(c, t("events.form.deleted"), "success");
  if (c.req.query("from") === "detail") { c.header("HX-Redirect", "/events"); return c.body(null, 204); }

  return c.html(""); // htmx ersetzt die Zeile durch nichts
});
