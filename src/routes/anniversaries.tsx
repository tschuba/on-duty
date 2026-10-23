import { Hono } from "hono";
import { asc } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/index.js";
import { members, persons, memberRoles, memberRoleAssignments, anniversaryYears } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout, MemberTabs } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { deriveMemberStatus, type MemberStatus } from "../lib/status.js";
import { generateEvents, type AnniversaryEvent } from "../lib/anniversaries.js";
import { buildListUrl, parseMulti } from "../lib/list-query.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { addMonths, parseRange, rangeParams, rangePresets, todayStr } from "../lib/quick-range.js";
import { formatDate } from "../lib/format.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";

export const anniversaryRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type MemberRow = typeof members.$inferSelect;
// birthDate is nullable in `persons` (donor-only persons need none) but every
// member is guaranteed one at the app layer (members.tsx form validation).
type Member = Omit<Person, "id" | "birthDate"> & MemberRow & { birthDate: string };
type Role = typeof memberRoles.$inferSelect;
type Assignment = typeof memberRoleAssignments.$inferSelect & { role: Role };

function flattenMember({ person, ...m }: { person: Person | null } & MemberRow & Record<string, unknown>): Member {
  return { ...(person as Person), ...m } as Member;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_KEYS = [
  "month.january", "month.february", "month.march", "month.april",
  "month.may", "month.june", "month.july", "month.august",
  "month.september", "month.october", "month.november", "month.december",
] as const satisfies ReadonlyArray<Parameters<typeof t>[0]>;

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  return `${t(MONTH_KEYS[parseInt(m, 10) - 1])} ${y}`;
}

const STATUS_BADGE: Partial<Record<MemberStatus, string>> = {
  aktiv: "badge badge-success badge-sm",
  kinder: "badge badge-warning badge-sm",
  jugend: "badge badge-info badge-sm",
  passiv: "badge badge-ghost badge-sm",
};
// Ausgeschiedene werden nie aufgelistet, daher kein Eintrag für ausgetreten/verstorben.
const STATUS_LABEL: Partial<Record<MemberStatus, string>> = {
  aktiv: t("status.aktiv"), kinder: t("status.kinder"), jugend: t("status.jugend"), passiv: t("status.passiv"),
};

// ── Components ────────────────────────────────────────────────────────────────

const KIND_FILTERS = ["service", "membership", "birthdays"] as const;
const BIRTHDAYS_FILTER = "birthdays";

// Empty/invalid selection means "all kinds active" (also covers legacy ?filter=all).
function parseKindFilters(raw: string[] | undefined): string[] {
  const parsed = parseMulti(raw, KIND_FILTERS);
  return parsed.length ? parsed : [...KIND_FILTERS];
}

// OR across the active kinds.
function filterEvents(events: AnniversaryEvent[], filters: string[]): AnniversaryEvent[] {
  return events.filter((e) =>
    e.kind === "birthday" ? filters.includes(BIRTHDAYS_FILTER) : e.types?.some((ty) => filters.includes(ty)),
  );
}

function anniversaryLabel(e: AnniversaryEvent): string {
  if (e.types?.length === 2) return t("anniversaries.event.serviceAndMembership");
  return t(e.types?.[0] === "membership" ? "anniversaries.event.membership" : "anniversaries.event.service");
}

function EventRow({ event: e, past, divider }: { event: AnniversaryEvent; past: boolean; divider: boolean }) {
  const yearsCol = e.kind === "birthday"
    ? t("anniversaries.event.yearsDisplay", { years: e.years })
    : e.title
      ? t("anniversaries.event.yearsWithTitle", { title: e.title, years: e.years })
      : t("anniversaries.event.yearsDisplay", { years: e.years });
  const border = divider ? " border-t border-base-300" : "";

  return (
    <tr class={past ? "opacity-40" : ""}>
      <td class={`whitespace-nowrap text-sm pl-6${border}`}>
        {formatDate(e.refDate ?? e.date)}
        {e.kind === "anniversary" && <div class="text-xs text-base-content/60">{t("anniversaries.event.jubDate", { date: formatDate(e.date) })}</div>}
      </td>
      <td class={border}>
        <a href={`/members/${e.memberId}`} class="link link-hover font-medium">
          {e.lastName}, {e.firstName}
        </a>
      </td>
      <td class={border}><span class={STATUS_BADGE[e.status]}>{STATUS_LABEL[e.status]}</span></td>
      <td class={border}>
        {e.kind === "birthday"
          ? <span class="badge badge-outline badge-sm">{t("anniversaries.event.birthday")}</span>
          : <span class="badge badge-warning badge-outline badge-sm">{anniversaryLabel(e)}</span>
        }
      </td>
      <td class={`text-right text-sm tabular-nums${border}`}>{yearsCol}</td>
    </tr>
  );
}

function EventList({ events, today, filters }: { events: AnniversaryEvent[]; today: string; filters: string[] }) {
  const filtered = filterEvents(events, filters);

  if (!filtered.length) {
    return <p class="text-base-content/60 py-8">{t("anniversaries.empty")}</p>;
  }

  const groups = new Map<string, AnniversaryEvent[]>();
  for (const e of filtered) {
    const key = e.date.slice(0, 7);
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(e);
  }

  return (
    <div class="overflow-x-auto">
      <table class="table table-zebra w-full [&_tbody_td]:border-b-0">
        <tbody>
          {[...groups.entries()].map(([month, evs], i) => (
            <>
              <tr>
                <td colspan={5} class={`text-base font-semibold text-base-content/70 pb-1${i > 0 ? " pt-8" : " pt-2"}`}>
                  {formatMonth(month)}
                </td>
              </tr>
              {evs.map((e, i) => (
                <EventRow event={e} past={e.date < today} divider={i > 0} />
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Export modal ─────────────────────────────────────────────────────────────

function AnniversariesExportModal() {
  return (
    <>
      <dialog id="ann-export-modal" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg mb-4">{t("common.excelExport")}</h3>
          <p class="text-sm opacity-60 mb-4">{t("anniversaries.export.subtitle")}</p>
          <div class="space-y-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-ann-contact" class="checkbox checkbox-sm" />
              <span>{t("anniversaries.export.contact")} <span class="opacity-50 text-xs">{t("anniversaries.export.contactHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-ann-addr" class="checkbox checkbox-sm" />
              <span>{t("anniversaries.export.address")} <span class="opacity-50 text-xs">{t("anniversaries.export.addressHint")}</span></span>
            </label>
          </div>
          <div class="modal-action">
            <button id="ann-export-download" class="btn btn-primary">{t("common.download")}</button>
            <form method="dialog"><button class="btn btn-ghost">{t("common.cancel")}</button></form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button>×</button></form>
      </dialog>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var fields=['contact','addr'];
          fields.forEach(function(f){
            var el=document.getElementById('exp-ann-'+f);
            var s=localStorage.getItem('ann_export_'+f);
            el.checked=s===null?false:s==='1';
            el.addEventListener('change',function(){localStorage.setItem('ann_export_'+f,el.checked?'1':'0');});
          });
          document.getElementById('ann-export-download').addEventListener('click',function(){
            var url=new URL(window.location.href);
            var p=new URLSearchParams();
            ['range','rel','dir','start','end'].forEach(function(k){var v=url.searchParams.get(k);if(v)p.set(k,v);});
            url.searchParams.getAll('filter').forEach(function(f){p.append('filter',f)});
            var gte=url.searchParams.get('gte');if(gte)p.set('gte',gte);
            url.searchParams.getAll('mod').forEach(function(m){p.append('mod',m)});
            if(document.getElementById('exp-ann-contact').checked)p.set('contact','1');
            if(document.getElementById('exp-ann-addr').checked)p.set('addr','1');
            window.location='/anniversaries/export?'+p;
            document.getElementById('ann-export-modal').close();
          });
        })();
      ` }} />
    </>
  );
}

// ── Route ─────────────────────────────────────────────────────────────────────

anniversaryRoutes.get("/", requireAuth("members:read"), async (c) => {
  const user = c.get("user")!;
  const today = todayStr();

  const range = parseRange(c.req.query(), today, "future", { start: today, end: addMonths(today, 12) });
  const { start, end } = range;
  const rp = rangeParams(range);
  const filters = parseKindFilters(c.req.queries("filter"));
  const gteRaw = c.req.query("gte") || "";
  const gte = parseInt(gteRaw, 10) || 0;
  const mods = c.req.queries("mod") ?? [];

  const [memberRows, ayRows] = await Promise.all([
    db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } }),
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.kind), asc(anniversaryYears.year)),
  ]);

  const membersWithStatus = memberRows.map((row) => {
    const m = flattenMember(row as any);
    return {
      ...m,
      status: deriveMemberStatus(m, row.assignments as Assignment[], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT),
    };
  });

  let events = generateEvents(membersWithStatus, ayRows, env.ANNIVERSARY_CUTOFF, start, end);
  if (gte > 0) events = events.filter((e) => e.years >= gte);
  if (mods.length > 0) {
    const want10 = mods.includes("10");
    const want5 = mods.includes("5");
    events = events.filter((e) =>
      (want10 && e.years % 10 === 0) ||
      (want5 && e.years % 5 === 0 && e.years % 10 !== 0)
    );
  }

  const qs = (extra: Record<string, string | string[]>) =>
    buildListUrl("/anniversaries", { ...rp, filter: filters, gte: gte > 0 ? gte : undefined, mod: mods }, extra);

  const allKindsActive = filters.length === KIND_FILTERS.length;
  const filterAll = () => qs({ filter: [...KIND_FILTERS] });
  // toggle a kind in/out; the last active kind cannot be removed
  const filterToggle = (f: string) => {
    if (!filters.includes(f)) return qs({ filter: [...filters, f] });
    return filters.length === 1 ? qs({}) : qs({ filter: filters.filter((x) => x !== f) });
  };
  const kindBtn = (f: string, label: string) => {
    const active = filters.includes(f);
    const locked = active && filters.length === 1;
    return <a href={filterToggle(f)} class={`join-item btn${active ? " btn-primary btn-outline" : " btn-ghost"}${locked ? " pointer-events-none" : ""}`}>{label}</a>;
  };
  // toggle a mod value in/out of the active set
  const modToggle = (m: string) => {
    const next = mods.includes(m) ? mods.filter((x) => x !== m) : [...mods, m];
    return qs({ mod: next });
  };
  const modReset = () => qs({ mod: [] });

  const presets = rangePresets(today, "future");

  // Mobile (< md): Mehrfachauswahl als Dropdown-Formular statt join-Buttongruppe
  const kindOpts = [["service", t("anniversaries.filter.service")], ["membership", t("anniversaries.filter.membership")], ["birthdays", t("anniversaries.filter.birthdays")]] as const;
  const modOpts = [["5", t("anniversaries.filter.halfRoundYears")], ["10", t("anniversaries.filter.roundYears")]] as const;
  const kindSummary = allKindsActive ? t("anniversaries.filter.all") : kindOpts.filter(([v]) => filters.includes(v)).map(([, l]) => l).join(", ");
  const modSummary = mods.length === 0 ? t("anniversaries.filter.all") : modOpts.filter(([v]) => mods.includes(v)).map(([, l]) => l).join(", ");
  const mobileFilter = (summary: string, name: string, opts: readonly (readonly [string, string])[], active: string[], allHref: string, hidden: [string, string][]) => (
    <div class="dropdown md:hidden max-w-full">
      <button tabindex={0} type="button" class="btn max-w-full"><span class="truncate">{summary}</span></button>
      <form method="get" action="/anniversaries" tabindex={0} class="dropdown-content bg-base-200 rounded-box z-50 fixed left-4 right-4 w-auto p-3 shadow flex flex-col gap-2">
        {hidden.map(([n, v]) => <input type="hidden" name={n} value={v} />)}
        {opts.map(([v, l]) => (
          <label class="flex items-center gap-2 py-1"><input type="checkbox" class="checkbox" name={name} value={v} checked={active.includes(v) && !(name === "filter" && allKindsActive)} />{l}</label>
        ))}
        <div class="flex gap-2">
          <a href={allHref} class="btn btn-ghost flex-1">{t("anniversaries.filter.all")}</a>
          <button type="submit" class="btn btn-primary flex-1">{t("common.apply")}</button>
        </div>
      </form>
    </div>
  );
  const rpHidden = Object.entries(rp).filter(([, v]) => v !== undefined) as [string, string][];
  const commonHidden = (): [string, string][] => [...rpHidden, ...(gte > 0 ? [["gte", String(gte)] as [string, string]] : [])];

  return c.html(
    <Layout title={t("anniversaries.title")} user={user} activeNav="members">
      <div class="max-w-4xl mx-auto">
      <MemberTabs active="anniversaries" user={user} />
      <div class="contents">
        <PageHeader title={t("anniversaries.title")} actions={<HeaderAction icon="arrow-down-tray" label={t("common.export")} onclick="document.getElementById('ann-export-modal').showModal()" />} />

        {/* Controls */}
        <div class="filter-bar mb-6 flex flex-wrap gap-3 items-end">
          <QuickRangeFilter presets={presets} range={range} dir="future" action="/anniversaries"
            hidden={[...filters.map((f): [string, string] => ["filter", f]), ...mods.map((m): [string, string] => ["mod", m]), ...(gte > 0 ? [["gte", String(gte)] as [string, string]] : [])]}
            href={(p) => qs(p)} />

          {/* Typ-Filter */}
          {mobileFilter(`${t("admin.anniversaries.table.kind")}: ${kindSummary}`, "filter", kindOpts, filters, filterAll(), [...commonHidden(), ...mods.map((m): [string, string] => ["mod", m])])}
          <div class="join hidden md:inline-flex">
            <a href={filterAll()} class={`join-item btn${allKindsActive ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.all")}</a>
            {kindBtn("service", t("anniversaries.filter.service"))}
            {kindBtn("membership", t("anniversaries.filter.membership"))}
            {kindBtn("birthdays", t("anniversaries.filter.birthdays"))}
          </div>

          {/* Jahre + Mod */}
          <div class="flex gap-3 items-center">
            <form method="get" action="/anniversaries" id="gte-form" class="flex items-center gap-2">
              {rpHidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
              {filters.map((f) => <input type="hidden" name="filter" value={f} />)}
              {mods.map((m) => <input type="hidden" name="mod" value={m} />)}
              <label class="text-sm text-base-content/70" for="gte-input">{t("anniversaries.minYears.label")}</label>
              <input
                id="gte-input"
                type="number"
                name="gte"
                value={gte > 0 ? String(gte) : ""}
                min="0"
                class="input input-bordered w-20"
                placeholder="–"
              />
            </form>
            {mobileFilter(modSummary, "mod", modOpts, mods, modReset(), [...commonHidden(), ...filters.map((f): [string, string] => ["filter", f])])}
            <div class="join hidden md:inline-flex">
              <a href={modReset()} class={`join-item btn${mods.length === 0 ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.all")}</a>
              <a href={modToggle("5")} class={`join-item btn${mods.includes("5") ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.halfRoundYears")}</a>
              <a href={modToggle("10")} class={`join-item btn${mods.includes("10") ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.roundYears")}</a>
            </div>
          </div>
        </div>
      </div>

      <EventList events={events} today={today} filters={filters} />
      <AnniversariesExportModal />
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var inp=document.getElementById('gte-input');
          var form=document.getElementById('gte-form');
          var stored=localStorage.getItem('ann_gte');
          if(stored&&inp.value==='')inp.value=stored;
          function submit(){
            if(inp.value)localStorage.setItem('ann_gte',inp.value);
            else localStorage.removeItem('ann_gte');
            form.submit();
          }
          inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();submit();}});
          inp.addEventListener('blur',function(){submit();});
        })();
      ` }} />
    </Layout>
  );
});

// GET /anniversaries/export — xlsx download
anniversaryRoutes.get("/export", requireAuth("members:read"), async (c) => {
  const q = c.req.query();
  const today = todayStr();
  const { start, end } = parseRange(q, today, "future", { start: today, end: addMonths(today, 12) });
  const filters = parseKindFilters(c.req.queries("filter"));
  const inclContact = q.contact === "1";
  const inclAddr = q.addr === "1";
  const gte = parseInt(q.gte || "", 10) || 0;
  const mod = q.mod || "";

  const [memberRows, ayRows] = await Promise.all([
    db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } }),
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.kind), asc(anniversaryYears.year)),
  ]);

  const flatMembers = memberRows.map((row) => flattenMember(row as any));

  const membersWithStatus = flatMembers.map((m, i) => ({
    ...m,
    status: deriveMemberStatus(m, memberRows[i].assignments as Assignment[], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT),
  }));

  let events = generateEvents(membersWithStatus, ayRows, env.ANNIVERSARY_CUTOFF, start, end);
  events = filterEvents(events, filters);
  if (gte > 0) events = events.filter((e) => e.years >= gte);
  if (mod === "10") events = events.filter((e) => e.years % 10 === 0);
  else if (mod === "5") events = events.filter((e) => e.years % 5 === 0 && e.years % 10 !== 0);

  const memberMap = new Map(flatMembers.map((m) => [m.id, m]));

  const STATUS_LABEL: Record<string, string> = {
    aktiv: t("status.aktiv"), passiv: t("status.passiv"), kinder: t("status.kinder"), jugend: t("status.jugend"),
  };

  const header: string[] = [
    t("anniversaries.export.colDate"), t("members.form.lastName"), t("members.form.firstName"),
    t("members.table.status"), t("anniversaries.export.colEventType"), t("anniversaries.export.colYears"), t("anniversaries.export.colTitle"),
  ];
  if (inclContact) header.push(t("members.form.phone"), t("members.form.mobile"), t("members.form.email"));
  if (inclAddr) header.push(t("members.form.street"), t("members.form.houseNumber"), t("members.form.zip"), t("members.form.city"));

  const rows = events.map((e) => {
    const row: (string | Date | number | null)[] = [
      new Date(e.date + "T00:00:00"),
      e.lastName,
      e.firstName,
      STATUS_LABEL[e.status] ?? e.status,
      e.kind === "birthday" ? t("anniversaries.event.birthday") : anniversaryLabel(e),
      e.years,
      e.title ?? "",
    ];
    const m = memberMap.get(e.memberId);
    if (inclContact) row.push(m?.phone ?? "", m?.mobile ?? "", m?.email ?? "");
    if (inclAddr) row.push(m?.street ?? "", m?.houseNumber ?? "", m?.zip ?? "", m?.city ?? "");
    return row;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), t("anniversaries.export.sheetName"));

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const exportDate = today.replace(/-/g, "");
  const filename = `${env.ORG_NAME.replace(/\s+/g, "_")}_jubilaeen_${exportDate}_${start.replace(/-/g, "")}_${end.replace(/-/g, "")}.xlsx`;

  c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
});
