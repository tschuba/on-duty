import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq, or, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import { members, memberRoles, memberRoleAssignments } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { deriveMemberStatus, type MemberStatus } from "../lib/status.js";
import { env } from "../env.js";

export const memberRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Member = typeof members.$inferSelect;
type Role = typeof memberRoles.$inferSelect;
type Assignment = typeof memberRoleAssignments.$inferSelect & { role: Role };
type MemberWithStatus = Member & { assignments: Assignment[]; status: MemberStatus };

// ── DB helpers ───────────────────────────────────────────────────────────────

async function fetchMembersWithStatus(search?: string): Promise<MemberWithStatus[]> {
  const rows = await db.query.members.findMany({
    where: search
      ? or(ilike(members.lastName, `%${search}%`), ilike(members.firstName, `%${search}%`))
      : undefined,
    with: {
      assignments: { with: { role: true } },
    },
  });

  return rows.map((m) => ({
    ...m,
    assignments: m.assignments as Assignment[],
    status: deriveMemberStatus(m, m.assignments as Assignment[], env.YOUTH_AGE_LIMIT),
  }));
}

async function fetchMember(id: string): Promise<MemberWithStatus | null> {
  const m = await db.query.members.findFirst({
    where: eq(members.id, id),
    with: { assignments: { with: { role: true } } },
  });
  if (!m) return null;
  return {
    ...m,
    assignments: m.assignments as Assignment[],
    status: deriveMemberStatus(m, m.assignments as Assignment[], env.YOUTH_AGE_LIMIT),
  };
}

// ── Sort / filter helpers ────────────────────────────────────────────────────

type SortKey = "lastName" | "birthDate" | "entryDate";
const DATE_SORT_KEYS: SortKey[] = ["birthDate", "entryDate"];

function sortMembers(list: MemberWithStatus[], sort: SortKey, dir: "asc" | "desc"): MemberWithStatus[] {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (sort === "lastName") {
      cmp = a.lastName.localeCompare(b.lastName, "de");
    } else {
      cmp = (a[sort] ?? "").localeCompare(b[sort] ?? "");
    }
    if (cmp === 0) cmp = a.lastName.localeCompare(b.lastName, "de");
    if (cmp === 0) cmp = a.firstName.localeCompare(b.firstName, "de");
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── Flash cookie helpers ─────────────────────────────────────────────────────

function setFlash(c: any, message: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message, type }), { path: "/", maxAge: 10, httpOnly: false });
}

// ── JSX components ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<MemberStatus, string> = {
  aktiv: "Aktiv",
  passiv: "Passiv",
  jugend: "Jugend",
  archiviert: "Archiviert",
};

const STATUS_BADGE_CLASS: Record<MemberStatus, string> = {
  aktiv: "badge badge-success",
  passiv: "badge badge-neutral",
  jugend: "badge badge-info",
  archiviert: "badge badge-ghost opacity-60",
};

function StatusBadge({ status }: { status: MemberStatus }) {
  return <span class={STATUS_BADGE_CLASS[status]}>{STATUS_LABELS[status]}</span>;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function SortIcon({ col, active, dir }: { col: SortKey; active: SortKey; dir: "asc" | "desc" }) {
  if (col !== active) return <span class="opacity-30 ml-1">↕</span>;
  return <span class="ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

function StatsCards({ all }: { all: MemberWithStatus[] }) {
  const counts = { aktiv: 0, passiv: 0, jugend: 0, archiviert: 0 };
  const genderCount = (status: "aktiv" | "jugend") => {
    const subset = all.filter((m) => m.status === status);
    return {
      m: subset.filter((m) => m.gender === "male").length,
      w: subset.filter((m) => m.gender === "female").length,
      o: subset.filter((m) => !m.gender).length,
    };
  };

  for (const m of all) counts[m.status]++;
  const aktiv = genderCount("aktiv");
  const jugend = genderCount("jugend");

  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">Aktiv</div>
        <div class="stat-value text-success">{counts.aktiv}</div>
        <div class="stat-desc">{aktiv.m} m / {aktiv.w} w / {aktiv.o} o.A.</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">Passiv</div>
        <div class="stat-value">{counts.passiv}</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">Jugend</div>
        <div class="stat-value text-info">{counts.jugend}</div>
        <div class="stat-desc">{jugend.m} m / {jugend.w} w / {jugend.o} o.A.</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">Archiviert</div>
        <div class="stat-value text-base-content/40">{counts.archiviert}</div>
      </div>
    </div>
  );
}

function MembersTable({
  items, sort, dir, page, pageSize, totalPages, search, statusFilter, isEditor,
}: {
  items: MemberWithStatus[];
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  totalPages: number;
  search: string;
  statusFilter: MemberStatus[];
  isEditor: boolean;
}) {
  function sortUrl(col: SortKey) {
    const defaultDir = DATE_SORT_KEYS.includes(col) ? "desc" : "asc";
    const newDir = sort === col ? (dir === "asc" ? "desc" : "asc") : defaultDir;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    for (const s of statusFilter) params.append("status", s);
    params.set("sort", col);
    params.set("sort_dir", newDir);
    params.set("page", "1");
    params.set("pageSize", String(pageSize));
    return `/members?${params}`;
  }

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    for (const s of statusFilter) params.append("status", s);
    params.set("sort", sort);
    params.set("sort_dir", dir);
    params.set("page", String(p));
    params.set("pageSize", String(pageSize));
    return `/members?${params}`;
  }

  const openRoles = (m: MemberWithStatus) =>
    m.assignments.filter((a) => !a.to).map((a) => a.role.title);

  return (
    <div id="members-results">
      <div class="overflow-x-auto">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th><a href={sortUrl("lastName")} class="link link-hover">Nachname <SortIcon col="lastName" active={sort} dir={dir} /></a></th>
              <th>Vorname</th>
              <th><a href={sortUrl("birthDate")} class="link link-hover">Geburtsdatum <SortIcon col="birthDate" active={sort} dir={dir} /></a></th>
              <th><a href={sortUrl("entryDate")} class="link link-hover">Eintrittsdatum <SortIcon col="entryDate" active={sort} dir={dir} /></a></th>
              <th>Funktion(en)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colspan={6} class="text-center opacity-50 py-8">Keine Mitglieder gefunden.</td></tr>
            ) : items.map((m) => (
              <tr
                key={m.id}
                class="cursor-pointer hover"
                onclick={`window.location='/members/${m.id}'`}
              >
                <td class="font-medium">{m.lastName}</td>
                <td>{m.firstName}</td>
                <td>{formatDate(m.birthDate)}</td>
                <td>{formatDate(m.entryDate)}</td>
                <td>
                  <div class="flex flex-wrap gap-1">
                    {openRoles(m).map((r) => <span class="badge badge-outline badge-sm">{r}</span>)}
                  </div>
                </td>
                <td><StatusBadge status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination + page size */}
      <div class="flex flex-wrap items-center justify-between gap-4 mt-4">
        <div class="join">
          {page > 1 && <a href={pageUrl(page - 1)} class="join-item btn btn-sm">«</a>}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={pageUrl(p)}
              class={`join-item btn btn-sm${p === page ? " btn-active" : ""}`}
            >
              {p}
            </a>
          ))}
          {page < totalPages && <a href={pageUrl(page + 1)} class="join-item btn btn-sm">»</a>}
        </div>

        <div class="flex items-center gap-2 text-sm opacity-70">
          <span>Einträge pro Seite:</span>
          <select
            class="select select-bordered select-sm"
            onchange={`
              const v = this.value;
              localStorage.setItem('members_pageSize', v);
              const url = new URL(window.location.href);
              url.searchParams.set('pageSize', v);
              url.searchParams.set('page', '1');
              window.location = url.toString();
            `}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n} selected={n === pageSize}>{n}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function RoleRow({
  index,
  roles,
  assignment,
}: {
  index: number;
  roles: Role[];
  assignment?: Assignment;
}) {
  return (
    <tr id={`role-row-${index}`}>
      <td>
        <input type="hidden" name="assignment_id[]" value={assignment?.id ?? ""} />
        <select name="assignment_role[]" class="select select-bordered select-sm w-full" required>
          <option value="">— Funktion wählen —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id} selected={r.id === assignment?.memberRoleId}>
              {r.title}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="date"
          name="assignment_from[]"
          class="input input-bordered input-sm w-full"
          value={assignment?.from ?? ""}
          required
        />
      </td>
      <td>
        <input
          type="date"
          name="assignment_to[]"
          class="input input-bordered input-sm w-full"
          value={assignment?.to ?? ""}
        />
      </td>
      <td>
        <button
          type="button"
          class="btn btn-ghost btn-sm text-error"
          onclick={`this.closest('tr').remove()`}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function MemberFormFields({
  m,
  errors,
}: {
  m?: Partial<Member>;
  errors?: Record<string, string>;
}) {
  function field(
    name: keyof Member,
    label: string,
    type = "text",
    required = false
  ) {
    const value = m?.[name] ?? "";
    const err = errors?.[name as string];
    return (
      <div class="form-control">
        <label class="label">
          <span class="label-text">{label}{required && <span class="text-error ml-1">*</span>}</span>
        </label>
        <input
          type={type}
          name={name as string}
          value={value as string}
          class={`input input-bordered${err ? " input-error" : ""}`}
          {...(required ? { required: true } : {})}
        />
        {err && <span class="text-error text-sm mt-1">{err}</span>}
      </div>
    );
  }

  const genderErr = errors?.gender;
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("lastName", "Nachname", "text", true)}
        {field("firstName", "Vorname", "text", true)}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {field("street", "Straße")}
        {field("houseNumber", "Hausnummer")}
        {field("zip", "PLZ")}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("city", "Ort")}
        <div class="form-control">
          <label class="label"><span class="label-text">Geschlecht</span></label>
          <select name="gender" class={`select select-bordered${genderErr ? " select-error" : ""}`}>
            <option value="" selected={!m?.gender}>Keine Angabe</option>
            <option value="male" selected={m?.gender === "male"}>Männlich</option>
            <option value="female" selected={m?.gender === "female"}>Weiblich</option>
          </select>
          {genderErr && <span class="text-error text-sm mt-1">{genderErr}</span>}
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("birthDate", "Geburtsdatum", "date", true)}
        {field("entryDate", "Eintrittsdatum", "date", true)}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("exitDate", "Austrittsdatum", "date")}
        {field("deathDate", "Sterbedatum", "date")}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("phone", "Telefon")}
        {field("email", "E-Mail", "email")}
      </div>
    </>
  );
}

function ReactivationModal({
  memberId,
  formData,
}: {
  memberId: string;
  formData: Record<string, string | string[]>;
}) {
  return (
    <dialog class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Automatisch geschlossene Funktionszuweisungen wieder öffnen?</h3>
        <p class="py-4 opacity-70">
          Dieses Mitglied wird reaktiviert. Es existieren Funktionszuweisungen, die beim Archivieren
          automatisch geschlossen wurden.
        </p>
        <div class="modal-action flex gap-2">
          <form method="post" action={`/members/${memberId}?reactivate=1`}>
            {Object.entries(formData).flatMap(([k, v]) =>
              Array.isArray(v)
                ? v.map((val, i) => <input key={`${k}-${i}`} type="hidden" name={k} value={val} />)
                : [<input key={k} type="hidden" name={k} value={v} />]
            )}
            <button type="submit" class="btn btn-primary">Ja</button>
          </form>
          <form method="post" action={`/members/${memberId}?reactivate=0`}>
            {Object.entries(formData).flatMap(([k, v]) =>
              Array.isArray(v)
                ? v.map((val, i) => <input key={`${k}-${i}`} type="hidden" name={k} value={val} />)
                : [<input key={k} type="hidden" name={k} value={v} />]
            )}
            <button type="submit" class="btn btn-ghost">Nein</button>
          </form>
          <a href={`/members/${memberId}`} class="btn btn-ghost">Abbrechen</a>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <a href={`/members/${memberId}`}>×</a>
      </form>
    </dialog>
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /members — list
memberRoutes.get("/", requireAuth("read"), async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const search = q.search ?? "";
  const sort = (q.sort as SortKey) || "lastName";
  const dir = (q.sort_dir as "asc" | "desc") || "asc";
  const statusFilter: MemberStatus[] =
    (c.req.queries("status") as MemberStatus[]) || (["aktiv", "passiv", "jugend"] as MemberStatus[]);
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;

  const all = await fetchMembersWithStatus(search || undefined);
  const filtered = all.filter((m) => statusFilter.includes(m.status));
  const sorted = sortMembers(filtered, sort, dir);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  const isEditor = user.appRole === "editor" || user.appRole === "admin";
  const isHtmx = c.req.header("HX-Request") === "true";

  const tableEl = (
    <MembersTable
      items={pageItems}
      sort={sort}
      dir={dir}
      page={page}
      pageSize={pageSize}
      totalPages={totalPages}
      search={search}
      statusFilter={statusFilter}
      isEditor={isEditor}
    />
  );

  if (isHtmx) return c.html(tableEl);

  function filterToggleUrl(s: MemberStatus) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const next = statusFilter.includes(s)
      ? statusFilter.filter((x) => x !== s)
      : [...statusFilter, s];
    for (const f of next) params.append("status", f);
    params.set("sort", sort);
    params.set("sort_dir", dir);
    params.set("page", "1");
    params.set("pageSize", String(pageSize));
    return `/members?${params}`;
  }

  return c.html(
    <Layout title="Mitglieder" user={user} activeNav="members">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">Mitglieder</h1>
        {isEditor && (
          <a href="/members/new" class="btn btn-primary btn-sm">+ Neues Mitglied</a>
        )}
      </div>

      <StatsCards all={all} />

      {/* Toolbar */}
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="search"
          name="search"
          placeholder="Suchen…"
          value={search}
          class="input input-bordered input-sm w-64"
          hx-get="/members"
          hx-trigger="input changed delay:300ms"
          hx-target="#members-results"
          hx-include="[name='search']"
          hx-vals={JSON.stringify({ sort, sort_dir: dir, status: statusFilter.join(","), page: 1, pageSize })}
        />
        <div class="flex gap-1">
          {(["aktiv", "passiv", "jugend", "archiviert"] as MemberStatus[]).map((s) => (
            <a
              key={s}
              href={filterToggleUrl(s)}
              class={`btn btn-sm${statusFilter.includes(s) ? " btn-primary" : " btn-ghost"}`}
            >
              {STATUS_LABELS[s]}
            </a>
          ))}
        </div>
        {isEditor && (
          <button class="btn btn-sm btn-ghost opacity-50" disabled title="Noch nicht implementiert">
            Excel-Export
          </button>
        )}
      </div>

      {tableEl}

      {/* Restore pageSize from localStorage on first load */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const saved = localStorage.getItem('members_pageSize');
          const url = new URL(window.location.href);
          if (saved && !url.searchParams.has('pageSize')) {
            url.searchParams.set('pageSize', saved);
            url.searchParams.set('page', '1');
            history.replaceState(null, '', url.toString());
            window.location.reload();
          }
        })();
      ` }} />
    </Layout>
  );
});

// GET /members/new — new member form
memberRoutes.get("/new", requireAuth("editor"), async (c) => {
  const user = c.get("user");
  const roles = await db.select().from(memberRoles).orderBy(memberRoles.title);
  return c.html(
    <Layout title="Neues Mitglied" user={user} activeNav="members">
      <div class="mb-4">
        <a href="/members" class="link link-hover text-sm opacity-70">← Zurück zur Liste</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">Neues Mitglied</h1>
        <p class="text-sm opacity-60 mt-1">* Pflichtfeld</p>
      </div>
      <form method="post" action="/members/new" class="space-y-4 max-w-2xl">
        <MemberFormFields />
        <div class="divider">Funktionszuweisungen</div>
        <div class="overflow-x-auto">
          <table class="table table-sm w-full">
            <thead>
              <tr>
                <th>Funktion</th>
                <th>Von</th>
                <th>Bis</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="role-rows"></tbody>
          </table>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          hx-get="/members/role-row"
          hx-target="#role-rows"
          hx-swap="beforeend"
          hx-include="[id='role-rows'] input[name='assignment_id[]']"
        >
          + Zuweisung hinzufügen
        </button>
        <input type="hidden" id="roles-json" value={JSON.stringify(roles)} />
        <div class="flex gap-2 pt-4">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <a href="/members" class="btn btn-ghost">Abbrechen</a>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: `
        // pass roles to role-row endpoint via hx-vals
        document.querySelector('[hx-get="/members/role-row"]').addEventListener('htmx:configRequest', function(e) {
          const rows = document.querySelectorAll('#role-rows tr').length;
          e.detail.parameters['index'] = rows;
        });
      ` }} />
    </Layout>
  );
});

// GET /members/role-row — HTMX fragment: one assignment row
memberRoutes.get("/role-row", requireAuth("editor"), async (c) => {
  const index = Number(c.req.query("index") ?? 0);
  const roles = await db.select().from(memberRoles).orderBy(memberRoles.title);
  return c.html(<RoleRow index={index} roles={roles} />);
});

// POST /members/new — create member
memberRoutes.post("/new", requireAuth("editor"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody({ all: true });
  const errors: Record<string, string> = {};

  const lastName = String(body.lastName ?? "").trim();
  const firstName = String(body.firstName ?? "").trim();
  const birthDate = String(body.birthDate ?? "").trim();
  const entryDate = String(body.entryDate ?? "").trim();

  if (!lastName) errors.lastName = "Pflichtfeld";
  if (!firstName) errors.firstName = "Pflichtfeld";
  if (!birthDate) errors.birthDate = "Pflichtfeld";
  if (!entryDate) errors.entryDate = "Pflichtfeld";

  // Parse assignments
  const assignmentRoles = [body["assignment_role[]"]].flat().filter(Boolean) as string[];
  const assignmentFroms = [body["assignment_from[]"]].flat() as string[];
  const assignmentTos = [body["assignment_to[]"]].flat() as string[];

  // Check for duplicate open assignments (same role without to-date)
  const openRoles = assignmentRoles.filter((_, i) => !assignmentTos[i]);
  const dupRole = openRoles.find((r, i) => openRoles.indexOf(r) !== i);
  if (dupRole) {
    const role = await db.select().from(memberRoles).where(eq(memberRoles.id, dupRole)).then((r) => r[0]);
    errors._assignments = `Funktion „${role?.title ?? dupRole}" ist mehrfach offen zugewiesen.`;
  }

  if (Object.keys(errors).length > 0) {
    const roles = await db.select().from(memberRoles).orderBy(memberRoles.title);
    const m: Partial<Member> = {
      lastName, firstName,
      street: body.street as string,
      houseNumber: body.houseNumber as string,
      zip: body.zip as string,
      city: body.city as string,
      gender: (body.gender as any) || null,
      birthDate,
      entryDate,
      exitDate: (body.exitDate as string) || null,
      deathDate: (body.deathDate as string) || null,
      phone: body.phone as string,
      email: body.email as string,
    };
    return c.html(
      <Layout title="Neues Mitglied" user={user} activeNav="members">
        <div class="mb-4">
          <a href="/members" class="link link-hover text-sm opacity-70">← Zurück zur Liste</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">Neues Mitglied</h1>
          <p class="text-sm opacity-60 mt-1">* Pflichtfeld</p>
        </div>
        {errors._assignments && (
          <div class="alert alert-error mb-4">{errors._assignments}</div>
        )}
        <form method="post" action="/members/new" class="space-y-4 max-w-2xl">
          <MemberFormFields m={m} errors={errors} />
          <div class="divider">Funktionszuweisungen</div>
          <div class="overflow-x-auto">
            <table class="table table-sm w-full">
              <thead><tr><th>Funktion</th><th>Von</th><th>Bis</th><th></th></tr></thead>
              <tbody id="role-rows">
                {assignmentRoles.map((_, i) => (
                  <RoleRow key={i} index={i} roles={roles} assignment={{
                    id: "",
                    memberId: "",
                    memberRoleId: assignmentRoles[i],
                    from: assignmentFroms[i] ?? "",
                    to: assignmentTos[i] || null,
                    autoClosed: false,
                    role: roles.find((r) => r.id === assignmentRoles[i])!,
                  }} />
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" class="btn btn-ghost btn-sm"
            hx-get="/members/role-row" hx-target="#role-rows" hx-swap="beforeend">
            + Zuweisung hinzufügen
          </button>
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">Speichern</button>
            <a href="/members" class="btn btn-ghost">Abbrechen</a>
          </div>
        </form>
      </Layout>,
      422
    );
  }

  const [newMember] = await db.transaction(async (tx) => {
    const [m] = await tx.insert(members).values({
      lastName, firstName,
      street: (body.street as string) || null,
      houseNumber: (body.houseNumber as string) || null,
      zip: (body.zip as string) || null,
      city: (body.city as string) || null,
      gender: (body.gender as any) || null,
      birthDate,
      entryDate,
      exitDate: (body.exitDate as string) || null,
      deathDate: (body.deathDate as string) || null,
      phone: (body.phone as string) || null,
      email: (body.email as string) || null,
    }).returning();

    for (let i = 0; i < assignmentRoles.length; i++) {
      if (!assignmentRoles[i]) continue;
      await tx.insert(memberRoleAssignments).values({
        memberId: m.id,
        memberRoleId: assignmentRoles[i],
        from: assignmentFroms[i],
        to: assignmentTos[i] || null,
      });
    }

    return [m];
  });

  setFlash(c, "Mitglied erfolgreich angelegt.", "success");
  return c.redirect(`/members/${newMember.id}`);
});

// GET /members/:id — view or edit
memberRoutes.get("/:id", requireAuth("read"), async (c) => {
  const user = c.get("user");
  const m = await fetchMember(c.req.param("id"));
  if (!m) return c.notFound();

  const isEditor = user.appRole === "editor" || user.appRole === "admin";
  const roles = isEditor ? await db.select().from(memberRoles).orderBy(memberRoles.title) : [];

  if (!isEditor) {
    // Read-only view
    const openRoles = m.assignments.filter((a) => !a.to);
    return c.html(
      <Layout title={`${m.firstName} ${m.lastName}`} user={user} activeNav="members">
        <div class="mb-4">
          <a href="/members" class="link link-hover text-sm opacity-70">← Zurück zur Liste</a>
          <div class="flex items-center gap-3 mt-1">
            <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
              {m.firstName} {m.lastName}
            </h1>
            <StatusBadge status={m.status} />
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
          <ViewField label="Nachname" value={m.lastName} />
          <ViewField label="Vorname" value={m.firstName} />
          <ViewField label="Geburtsdatum" value={formatDate(m.birthDate)} />
          <ViewField label="Eintrittsdatum" value={formatDate(m.entryDate)} />
          <ViewField label="Geschlecht" value={m.gender === "male" ? "Männlich" : m.gender === "female" ? "Weiblich" : "Keine Angabe"} />
          <ViewField label="Straße / Nr." value={[m.street, m.houseNumber].filter(Boolean).join(" ") || null} />
          <ViewField label="PLZ / Ort" value={[m.zip, m.city].filter(Boolean).join(" ") || null} />
          <ViewField label="Telefon" value={m.phone} />
          <ViewField label="E-Mail" value={m.email} />
          {m.exitDate && <ViewField label="Austrittsdatum" value={formatDate(m.exitDate)} />}
          {m.deathDate && <ViewField label="Sterbedatum" value={formatDate(m.deathDate)} />}
        </div>
        {openRoles.length > 0 && (
          <div class="mt-6">
            <h2 class="font-semibold mb-2">Aktive Funktionen</h2>
            <div class="flex flex-wrap gap-2">
              {openRoles.map((a) => (
                <span class="badge badge-outline">{a.role.title} (seit {formatDate(a.from)})</span>
              ))}
            </div>
          </div>
        )}
      </Layout>
    );
  }

  return c.html(
    <Layout title={`${m.firstName} ${m.lastName}`} user={user} activeNav="members">
      <div class="mb-4">
        <a href="/members" class="link link-hover text-sm opacity-70">← Zurück zur Liste</a>
        <div class="flex items-center gap-3 mt-1">
          <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">
            {m.firstName} {m.lastName}
          </h1>
          <StatusBadge status={m.status} />
        </div>
        <p class="text-sm opacity-60 mt-1">* Pflichtfeld</p>
      </div>
      <form method="post" action={`/members/${m.id}`} class="space-y-4 max-w-2xl">
        <MemberFormFields m={m} />
        <div class="divider">Funktionszuweisungen</div>
        <div class="overflow-x-auto">
          <table class="table table-sm w-full">
            <thead><tr><th>Funktion</th><th>Von</th><th>Bis</th><th></th></tr></thead>
            <tbody id="role-rows">
              {m.assignments.map((a, i) => (
                <RoleRow key={a.id} index={i} roles={roles} assignment={a} />
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" class="btn btn-ghost btn-sm"
          hx-get="/members/role-row" hx-target="#role-rows" hx-swap="beforeend">
          + Zuweisung hinzufügen
        </button>
        <div class="flex gap-2 pt-4">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <a href="/members" class="btn btn-ghost">Abbrechen</a>
        </div>
      </form>
    </Layout>
  );
});

// POST /members/:id — update member
memberRoutes.post("/:id", requireAuth("editor"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const reactivateParam = c.req.query("reactivate");

  const existing = await fetchMember(id);
  if (!existing) return c.notFound();

  const body = await c.req.parseBody({ all: true });
  const errors: Record<string, string> = {};

  const lastName = String(body.lastName ?? "").trim();
  const firstName = String(body.firstName ?? "").trim();
  const birthDate = String(body.birthDate ?? "").trim();
  const entryDate = String(body.entryDate ?? "").trim();
  const exitDate = (body.exitDate as string) || null;
  const deathDate = (body.deathDate as string) || null;

  if (!lastName) errors.lastName = "Pflichtfeld";
  if (!firstName) errors.firstName = "Pflichtfeld";
  if (!birthDate) errors.birthDate = "Pflichtfeld";
  if (!entryDate) errors.entryDate = "Pflichtfeld";

  const assignmentIds = [body["assignment_id[]"]].flat() as string[];
  const assignmentRoles = [body["assignment_role[]"]].flat().filter(Boolean) as string[];
  const assignmentFroms = [body["assignment_from[]"]].flat() as string[];
  const assignmentTos = [body["assignment_to[]"]].flat() as string[];

  const openRoles = assignmentRoles.filter((_, i) => !assignmentTos[i]);
  const dupRole = openRoles.find((r, i) => openRoles.indexOf(r) !== i);
  if (dupRole) {
    const role = await db.select().from(memberRoles).where(eq(memberRoles.id, dupRole)).then((r) => r[0]);
    errors._assignments = `Funktion „${role?.title ?? dupRole}" ist mehrfach offen zugewiesen.`;
  }

  if (Object.keys(errors).length > 0) {
    const roles = await db.select().from(memberRoles).orderBy(memberRoles.title);
    const m = { ...existing, lastName, firstName, birthDate, entryDate, exitDate, deathDate,
      street: body.street as string, houseNumber: body.houseNumber as string,
      zip: body.zip as string, city: body.city as string,
      gender: (body.gender as any) || null,
      phone: body.phone as string, email: body.email as string };
    return c.html(
      <Layout title={`${firstName} ${lastName}`} user={user} activeNav="members">
        <div class="mb-4">
          <a href="/members" class="link link-hover text-sm opacity-70">← Zurück zur Liste</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{firstName} {lastName}</h1>
          <p class="text-sm opacity-60 mt-1">* Pflichtfeld</p>
        </div>
        {errors._assignments && <div class="alert alert-error mb-4">{errors._assignments}</div>}
        <form method="post" action={`/members/${id}`} class="space-y-4 max-w-2xl">
          <MemberFormFields m={m} errors={errors} />
          <div class="divider">Funktionszuweisungen</div>
          <div class="overflow-x-auto">
            <table class="table table-sm w-full">
              <thead><tr><th>Funktion</th><th>Von</th><th>Bis</th><th></th></tr></thead>
              <tbody id="role-rows">
                {assignmentRoles.map((_, i) => (
                  <RoleRow key={i} index={i} roles={roles} assignment={{
                    id: assignmentIds[i] ?? "",
                    memberId: id,
                    memberRoleId: assignmentRoles[i],
                    from: assignmentFroms[i] ?? "",
                    to: assignmentTos[i] || null,
                    autoClosed: false,
                    role: roles.find((r) => r.id === assignmentRoles[i])!,
                  }} />
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" class="btn btn-ghost btn-sm"
            hx-get="/members/role-row" hx-target="#role-rows" hx-swap="beforeend">
            + Zuweisung hinzufügen
          </button>
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">Speichern</button>
            <a href={`/members/${id}`} class="btn btn-ghost">Abbrechen</a>
          </div>
        </form>
      </Layout>,
      422
    );
  }

  // Reactivation check: was archived before, will not be after save
  const wasArchived = existing.status === "archiviert";
  const willBeArchived = !!(exitDate || deathDate);
  const isReactivation = wasArchived && !willBeArchived;
  const autoClosedAssignments = existing.assignments.filter((a) => a.autoClosed);

  if (isReactivation && autoClosedAssignments.length > 0 && reactivateParam === undefined) {
    const roles = await db.select().from(memberRoles).orderBy(memberRoles.title);
    const formData: Record<string, string | string[]> = {
      lastName, firstName,
      street: (body.street as string) ?? "",
      houseNumber: (body.houseNumber as string) ?? "",
      zip: (body.zip as string) ?? "",
      city: (body.city as string) ?? "",
      gender: (body.gender as string) ?? "",
      birthDate, entryDate,
      exitDate: exitDate ?? "",
      deathDate: deathDate ?? "",
      phone: (body.phone as string) ?? "",
      email: (body.email as string) ?? "",
      "assignment_id[]": assignmentIds,
      "assignment_role[]": assignmentRoles,
      "assignment_from[]": assignmentFroms,
      "assignment_to[]": assignmentTos.map((t) => t ?? ""),
    };

    return c.html(
      <Layout title={`${firstName} ${lastName}`} user={user} activeNav="members">
        <div class="mb-4">
          <a href="/members" class="link link-hover text-sm opacity-70">← Zurück zur Liste</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{firstName} {lastName}</h1>
          <p class="text-sm opacity-60 mt-1">* Pflichtfeld</p>
        </div>
        <form method="post" action={`/members/${id}`} class="space-y-4 max-w-2xl">
          <MemberFormFields m={{ ...existing, lastName, firstName, birthDate, entryDate, exitDate, deathDate,
            street: body.street as string, houseNumber: body.houseNumber as string,
            zip: body.zip as string, city: body.city as string, gender: (body.gender as any) || null,
            phone: body.phone as string, email: body.email as string }} />
          <div class="divider">Funktionszuweisungen</div>
          <div class="overflow-x-auto">
            <table class="table table-sm w-full">
              <thead><tr><th>Funktion</th><th>Von</th><th>Bis</th><th></th></tr></thead>
              <tbody id="role-rows">
                {assignmentRoles.map((_, i) => (
                  <RoleRow key={i} index={i} roles={roles} assignment={{
                    id: assignmentIds[i] ?? "",
                    memberId: id,
                    memberRoleId: assignmentRoles[i],
                    from: assignmentFroms[i] ?? "",
                    to: assignmentTos[i] || null,
                    autoClosed: false,
                    role: roles.find((r) => r.id === assignmentRoles[i])!,
                  }} />
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" class="btn btn-ghost btn-sm"
            hx-get="/members/role-row" hx-target="#role-rows" hx-swap="beforeend">
            + Zuweisung hinzufügen
          </button>
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">Speichern</button>
            <a href={`/members/${id}`} class="btn btn-ghost">Abbrechen</a>
          </div>
        </form>
        <ReactivationModal memberId={id} formData={formData} />
      </Layout>
    );
  }

  await db.transaction(async (tx) => {
    // Update member fields
    await tx.update(members).set({
      lastName, firstName,
      street: (body.street as string) || null,
      houseNumber: (body.houseNumber as string) || null,
      zip: (body.zip as string) || null,
      city: (body.city as string) || null,
      gender: (body.gender as any) || null,
      birthDate, entryDate,
      exitDate: exitDate || null,
      deathDate: deathDate || null,
      phone: (body.phone as string) || null,
      email: (body.email as string) || null,
    }).where(eq(members.id, id));

    // Archive: close open assignments when exitDate or deathDate set
    if ((exitDate || deathDate) && !(existing.exitDate || existing.deathDate)) {
      await tx.update(memberRoleAssignments)
        .set({ to: (exitDate || deathDate)!, autoClosed: true })
        .where(eq(memberRoleAssignments.memberId, id));
    }

    // Reactivation: reopen auto_closed if requested
    if (isReactivation && reactivateParam === "1") {
      await tx.update(memberRoleAssignments)
        .set({ to: null, autoClosed: false })
        .where(eq(memberRoleAssignments.memberId, id));
    }

    // Reconcile role assignments: delete removed, upsert existing/new
    const submittedIds = assignmentIds.filter(Boolean);
    const existingIds = existing.assignments.map((a) => a.id);
    const deletedIds = existingIds.filter((eid) => !submittedIds.includes(eid));

    for (const did of deletedIds) {
      await tx.delete(memberRoleAssignments).where(eq(memberRoleAssignments.id, did));
    }

    for (let i = 0; i < assignmentRoles.length; i++) {
      if (!assignmentRoles[i]) continue;
      const aid = assignmentIds[i];
      const vals = {
        memberId: id,
        memberRoleId: assignmentRoles[i],
        from: assignmentFroms[i],
        to: assignmentTos[i] || null,
      };
      if (aid) {
        await tx.update(memberRoleAssignments).set(vals).where(eq(memberRoleAssignments.id, aid));
      } else {
        await tx.insert(memberRoleAssignments).values(vals);
      }
    }
  });

  setFlash(c, "Mitglied gespeichert.", "success");
  return c.redirect(`/members/${id}`);
});

// ── Read-only view field helper ───────────────────────────────────────────────

function ViewField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div class="text-sm opacity-60">{label}</div>
      <div class="font-medium">{value || "—"}</div>
    </div>
  );
}
