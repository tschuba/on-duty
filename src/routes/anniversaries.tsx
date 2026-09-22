import { Hono } from "hono";
import { asc } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/index.js";
import { members, memberRoles, memberRoleAssignments, anniversaryYears } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { deriveMemberStatus, type MemberStatus } from "../lib/status.js";
import { generateEvents, type AnniversaryEvent } from "../lib/anniversaries.js";
import { env } from "../env.js";

export const anniversaryRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Role = typeof memberRoles.$inferSelect;
type Assignment = typeof memberRoleAssignments.$inferSelect & { role: Role };

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function formatDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

const STATUS_BADGE: Record<MemberStatus, string> = {
  aktiv: "badge badge-success badge-sm",
  jugend: "badge badge-info badge-sm",
  passiv: "badge badge-ghost badge-sm",
  archiviert: "badge badge-neutral badge-sm",
};
const STATUS_LABEL: Record<MemberStatus, string> = {
  aktiv: "Aktiv", jugend: "Jugend", passiv: "Passiv", archiviert: "Archiviert",
};

// ── Components ────────────────────────────────────────────────────────────────

function EventRow({ event: e, past, divider }: { event: AnniversaryEvent; past: boolean; divider: boolean }) {
  const yearsCol = e.kind === "birthday"
    ? `${e.years} Jahre`
    : e.title ? `${e.title} · ${e.years} Jahre` : `${e.years} Jahre`;
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
          ? <span class="badge badge-outline badge-sm">Geburtstag</span>
          : <span class="badge badge-warning badge-outline badge-sm">Jubiläum</span>
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
    return <p class="text-base-content/60 py-8">Keine Ereignisse im gewählten Zeitraum.</p>;
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
      <table class="table table-sm w-full [&_tbody_td]:border-b-0">
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
          <h3 class="font-bold text-lg mb-4">Excel-Export</h3>
          <p class="text-sm opacity-60 mb-4">Datum, Name, Status, Ereignistyp, Jahre und Jubiläumstitel sind immer enthalten.</p>
          <div class="space-y-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-ann-contact" class="checkbox checkbox-sm" />
              <span>Kontaktdaten <span class="opacity-50 text-xs">(Telefon, E-Mail)</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-ann-addr" class="checkbox checkbox-sm" />
              <span>Adressdaten <span class="opacity-50 text-xs">(Straße, Hausnummer, PLZ, Ort)</span></span>
            </label>
          </div>
          <div class="modal-action">
            <button id="ann-export-download" class="btn btn-primary">Herunterladen</button>
            <form method="dialog"><button class="btn btn-ghost">Abbrechen</button></form>
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
            el.checked=s===null?true:s==='1';
            el.addEventListener('change',function(){localStorage.setItem('ann_export_'+f,el.checked?'1':'0');});
          });
          document.getElementById('ann-export-download').addEventListener('click',function(){
            var url=new URL(window.location.href);
            var p=new URLSearchParams({
              start:url.searchParams.get('start')||'',
              end:url.searchParams.get('end')||'',
              filter:url.searchParams.get('filter')||'all',
            });
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

  const [memberRows, ayRows] = await Promise.all([
    db.query.members.findMany({ with: { assignments: { with: { role: true } } } }),
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.year)),
  ]);

  const membersWithStatus = memberRows.map((m) => ({
    ...m,
    status: deriveMemberStatus(m, m.assignments as Assignment[], env.YOUTH_AGE_LIMIT),
  }));

  const events = generateEvents(membersWithStatus, ayRows, env.ANNIVERSARY_CUTOFF, start, end);

  const quickLink = (months: number) => {
    const s = today;
    const e = addMonths(today, months);
    return `/anniversaries?start=${s}&end=${e}&filter=${filter}`;
  };

  const filterLink = (f: string) => `/anniversaries?start=${start}&end=${end}&filter=${f}`;

  const isDefault = start === today && end === addMonths(today, 12);
  const is3m = start === today && end === addMonths(today, 3);
  const is6m = start === today && end === addMonths(today, 6);

  const thisYear = today.slice(0, 4);
  const nextYear = String(parseInt(thisYear, 10) + 1);
  const yearLink = (y: string) => `/anniversaries?start=${y}-01-01&end=${y}-12-31&filter=${filter}`;
  const isThisYear = start === `${thisYear}-01-01` && end === `${thisYear}-12-31`;
  const isNextYear = start === `${nextYear}-01-01` && end === `${nextYear}-12-31`;

  return c.html(
    <Layout title="Jubiläen & Geburtstage" user={user} activeNav="anniversaries">
      <div class="max-w-4xl mx-auto">
      <div class="mb-6">
        <h1 class="text-2xl font-bold mb-4" style="font-family: var(--font-heading)">
          Jubiläen &amp; Geburtstage
        </h1>

        {/* Controls */}
        <div class="flex flex-wrap gap-3 items-end">

          {/* Quick buttons */}
          <div class="flex gap-1">
            <a href={quickLink(3)} class={`btn btn-sm${is3m ? " btn-primary" : " btn-ghost"}`}>3 Monate</a>
            <a href={quickLink(6)} class={`btn btn-sm${is6m ? " btn-primary" : " btn-ghost"}`}>6 Monate</a>
            <a href={quickLink(12)} class={`btn btn-sm${isDefault ? " btn-primary" : " btn-ghost"}`}>12 Monate</a>
            <a href={yearLink(thisYear)} class={`btn btn-sm${isThisYear ? " btn-primary" : " btn-ghost"}`}>Dieses Jahr</a>
            <a href={yearLink(nextYear)} class={`btn btn-sm${isNextYear ? " btn-primary" : " btn-ghost"}`}>Nächstes Jahr</a>
          </div>

          {/* Manual date range */}
          <form method="get" action="/anniversaries" class="flex gap-2 items-center flex-wrap">
            <input type="date" name="start" value={start} class="input input-sm input-bordered w-36" />
            <span class="text-base-content/50">–</span>
            <input type="date" name="end" value={end} class="input input-sm input-bordered w-36" />
            <input type="hidden" name="filter" value={filter} />
            <button type="submit" class="btn btn-sm">Anzeigen</button>
          </form>

          {/* Filter toggle */}
          <div class="join">
            <a href={filterLink("all")} class={`join-item btn btn-sm${filter === "all" ? " btn-active" : ""}`}>Alle</a>
            <a href={filterLink("anniversaries")} class={`join-item btn btn-sm${filter === "anniversaries" ? " btn-active" : ""}`}>Nur Jubiläen</a>
            <a href={filterLink("birthdays")} class={`join-item btn btn-sm${filter === "birthdays" ? " btn-active" : ""}`}>Nur Geburtstage</a>
          </div>

          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('ann-export-modal').showModal()">
            Export
          </button>
        </div>
      </div>

      <EventList events={events} today={today} filter={filter} />
      <AnniversariesExportModal />
      </div>
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

  const [memberRows, ayRows] = await Promise.all([
    db.query.members.findMany({ with: { assignments: { with: { role: true } } } }),
    db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.year)),
  ]);

  const membersWithStatus = memberRows.map((m) => ({
    ...m,
    status: deriveMemberStatus(m, m.assignments as Assignment[], env.YOUTH_AGE_LIMIT),
  }));

  let events = generateEvents(membersWithStatus, ayRows, env.ANNIVERSARY_CUTOFF, start, end);
  if (filter === "anniversaries") events = events.filter((e) => e.kind === "anniversary");
  else if (filter === "birthdays") events = events.filter((e) => e.kind === "birthday");

  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  const STATUS_LABEL: Record<string, string> = {
    aktiv: "Aktiv", passiv: "Passiv", jugend: "Jugend", archiviert: "Archiviert",
  };

  const header: string[] = ["Datum", "Nachname", "Vorname", "Status", "Ereignistyp", "Jahre", "Jubiläumstitel"];
  if (inclContact) header.push("Telefon", "E-Mail");
  if (inclAddr) header.push("Straße", "Hausnummer", "PLZ", "Ort");

  const rows = events.map((e) => {
    const row: (string | Date | number | null)[] = [
      new Date(e.date + "T00:00:00"),
      e.lastName,
      e.firstName,
      STATUS_LABEL[e.status] ?? e.status,
      e.kind === "birthday" ? "Geburtstag" : "Jubiläum",
      e.years,
      e.title ?? "",
    ];
    const m = memberMap.get(e.memberId);
    if (inclContact) row.push(m?.phone ?? "", m?.email ?? "");
    if (inclAddr) row.push(m?.street ?? "", m?.houseNumber ?? "", m?.zip ?? "", m?.city ?? "");
    return row;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), "Jubiläen");

  const buf = XLSX.write(wb, { type: "array", bookType: "ods" }) as Uint8Array;
  const exportDate = today.replace(/-/g, "");
  const filename = `${env.ORG_NAME.replace(/\s+/g, "_")}_jubilaeuen_${exportDate}_${start.replace(/-/g, "")}_${end.replace(/-/g, "")}.ods`;

  c.header("Content-Type", "application/vnd.oasis.opendocument.spreadsheet");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(buf.buffer as ArrayBuffer);
});
