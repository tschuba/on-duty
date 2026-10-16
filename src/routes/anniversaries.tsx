import { Hono } from "hono";
import { asc } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/index.js";
import { members, persons, memberRoles, memberRoleAssignments, anniversaryYears } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout, MemberTabs } from "../components/layout.js";
import { deriveMemberStatus, type MemberStatus } from "../lib/status.js";
import { generateEvents, type AnniversaryEvent } from "../lib/anniversaries.js";
import { buildListUrl } from "../lib/list-query.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { addMonths, rangePresets, todayStr } from "../lib/quick-range.js";
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

function EventRow({ event: e, past, divider }: { event: AnniversaryEvent; past: boolean; divider: boolean }) {
  const yearsCol = e.kind === "birthday"
    ? t("anniversaries.event.yearsDisplay", { years: e.years })
    : e.title
      ? t("anniversaries.event.yearsWithTitle", { title: e.title, years: e.years })
      : t("anniversaries.event.yearsDisplay", { years: e.years });
  const border = divider ? " border-t border-base-300" : "";

  return (
    <tr class={past ? "opacity-40" : ""}>
      <td class={`whitespace-nowrap text-sm pl-6${border}`}>{formatDate(e.date)}</td>
      <td class={border}>
        <a href={`/members/${e.memberId}`} class="link link-hover font-medium">
          {e.lastName}, {e.firstName}
        </a>
      </td>
      <td class={border}><span class={STATUS_BADGE[e.status]}>{STATUS_LABEL[e.status]}</span></td>
      <td class={border}>
        {e.kind === "birthday"
          ? <span class="badge badge-outline badge-sm">{t("anniversaries.event.birthday")}</span>
          : <span class="badge badge-warning badge-outline badge-sm">{t("anniversaries.event.anniversary")}</span>
        }
      </td>
      <td class={`text-right text-sm tabular-nums${border}`}>{yearsCol}</td>
    </tr>
  );
}

function EventList({ events, today, filter }: { events: AnniversaryEvent[]; today: string; filter: string }) {
  const filtered = filter === "anniversaries"
    ? events.filter((e) => e.kind === "anniversary")
    : filter === "birthdays"
    ? events.filter((e) => e.kind === "birthday")
    : events;

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
            var p=new URLSearchParams({
              start:url.searchParams.get('start')||'',
              end:url.searchParams.get('end')||'',
              filter:url.searchParams.get('filter')||'all',
            });
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

anniversaryRoutes.get("/", requireAuth(), async (c) => {
  const user = c.get("user")!;
  const today = todayStr();

  const start = c.req.query("start") || today;
  const end = c.req.query("end") || addMonths(today, 12);
  const filter = c.req.query("filter") || "all";
  const gteRaw = c.req.query("gte") || "";
  const gte = parseInt(gteRaw, 10) || 0;
  const mods = c.req.queries("mod") ?? [];

  const [memberRows, ayRows] = await Promise.all([
    db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } }),
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.year)),
  ]);

  const membersWithStatus = memberRows.map((row) => {
    const m = flattenMember(row as any);
    return {
      ...m,
      status: deriveMemberStatus(m, row.assignments as Assignment[], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT),
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
    buildListUrl("/anniversaries", { start, end, filter, gte: gte > 0 ? gte : undefined, mod: mods }, extra);

  const filterLink = (f: string) => qs({ filter: f });
  // toggle a mod value in/out of the active set
  const modToggle = (m: string) => {
    const next = mods.includes(m) ? mods.filter((x) => x !== m) : [...mods, m];
    return qs({ mod: next });
  };
  const modReset = () => qs({ mod: [] });

  const presets = rangePresets(today, "future");

  return c.html(
    <Layout title={t("anniversaries.title")} user={user} activeNav="members">
      <div class="max-w-4xl mx-auto">
      <MemberTabs active="anniversaries" user={user} />
      <div class="mb-6">
        <div class="flex justify-between items-center mb-4">
          <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
            {t("anniversaries.title")}
          </h1>
          <button class="btn btn-neutral" onclick="document.getElementById('ann-export-modal').showModal()">
            {t("common.export")}
          </button>
        </div>

        {/* Controls */}
        <div class="flex flex-wrap gap-3 items-end">
          <QuickRangeFilter presets={presets} start={start} end={end} href={(p) => qs({ start: p.start, end: p.end })} />

          {/* Manual date range */}
          <form method="get" action="/anniversaries" class="flex gap-2 items-center flex-wrap">
            <input type="date" name="start" value={start} class="input input-bordered w-36" />
            <span class="text-base-content/50">–</span>
            <input type="date" name="end" value={end} class="input input-bordered w-36" />
            <input type="hidden" name="filter" value={filter} />
            {mods.map((m) => <input type="hidden" name="mod" value={m} />)}
            {gte > 0 && <input type="hidden" name="gte" value={String(gte)} />}
            <button type="submit" class="btn">{t("common.show")}</button>
          </form>

          {/* Typ-Filter */}
          <div class="join">
            <a href={filterLink("all")} class={`join-item btn${filter === "all" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.all")}</a>
            <a href={filterLink("anniversaries")} class={`join-item btn${filter === "anniversaries" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.anniversariesOnly")}</a>
            <a href={filterLink("birthdays")} class={`join-item btn${filter === "birthdays" ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.birthdaysOnly")}</a>
          </div>

          {/* Jahre + Mod */}
          <div class="flex gap-3 items-center">
            <form method="get" action="/anniversaries" id="gte-form" class="flex items-center gap-2">
              <input type="hidden" name="start" value={start} />
              <input type="hidden" name="end" value={end} />
              <input type="hidden" name="filter" value={filter} />
              {mods.map((m) => <input type="hidden" name="mod" value={m} />)}
              <label class="text-sm text-base-content/70" for="gte-input">{t("anniversaries.minYears.label")}</label>
              <input
                id="gte-input"
                type="number"
                name="gte"
                value={gte > 0 ? String(gte) : ""}
                min="0"
                class="input nput-bordered w-20"
                placeholder="–"
              />
            </form>
            <div class="join">
              <a href={modReset()} class={`join-item btn${mods.length === 0 ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.all")}</a>
              <a href={modToggle("5")} class={`join-item btn${mods.includes("5") ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.halfRoundYears")}</a>
              <a href={modToggle("10")} class={`join-item btn${mods.includes("10") ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.roundYears")}</a>
            </div>
          </div>
        </div>
      </div>

      <EventList events={events} today={today} filter={filter} />
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
anniversaryRoutes.get("/export", requireAuth(), async (c) => {
  const q = c.req.query();
  const today = todayStr();
  const start = q.start || today;
  const end = q.end || addMonths(today, 12);
  const filter = q.filter || "all";
  const inclContact = q.contact === "1";
  const inclAddr = q.addr === "1";
  const gte = parseInt(q.gte || "", 10) || 0;
  const mod = q.mod || "";

  const [memberRows, ayRows] = await Promise.all([
    db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } }),
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.year)),
  ]);

  const flatMembers = memberRows.map((row) => flattenMember(row as any));

  const membersWithStatus = flatMembers.map((m, i) => ({
    ...m,
    status: deriveMemberStatus(m, memberRows[i].assignments as Assignment[], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT),
  }));

  let events = generateEvents(membersWithStatus, ayRows, env.ANNIVERSARY_CUTOFF, start, end);
  if (filter === "anniversaries") events = events.filter((e) => e.kind === "anniversary");
  else if (filter === "birthdays") events = events.filter((e) => e.kind === "birthday");
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
  if (inclContact) header.push(t("members.form.phone"), t("members.form.email"));
  if (inclAddr) header.push(t("members.form.street"), t("members.form.houseNumber"), t("members.form.zip"), t("members.form.city"));

  const rows = events.map((e) => {
    const row: (string | Date | number | null)[] = [
      new Date(e.date + "T00:00:00"),
      e.lastName,
      e.firstName,
      STATUS_LABEL[e.status] ?? e.status,
      e.kind === "birthday" ? t("anniversaries.event.birthday") : t("anniversaries.event.anniversary"),
      e.years,
      e.title ?? "",
    ];
    const m = memberMap.get(e.memberId);
    if (inclContact) row.push(m?.phone ?? "", m?.email ?? "");
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
