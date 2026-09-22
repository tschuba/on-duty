import { Hono } from "hono";
import { asc } from "drizzle-orm";
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
                <td colspan="5" class={`text-base font-semibold text-base-content/70 pb-1${i > 0 ? " pt-8" : " pt-2"}`}>
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
        </div>
      </div>

      <EventList events={events} today={today} filter={filter} />
      </div>
    </Layout>
  );
});
