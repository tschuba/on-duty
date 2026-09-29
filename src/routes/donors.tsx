import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { eq, or, ilike, asc, gte, lte, isNull, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { persons, donors, donations } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { SortIcon } from "./members.js";
import { t } from "../i18n/index.js";
import { loadOrgConfig, isOrgConfigCompleteForReceipts } from "../lib/org-config.js";

export const donorRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type DonorRow = typeof donors.$inferSelect;
type DonorWithPerson = DonorRow & { person: Person };

// Narrow field set the donations:record permission is allowed to see/edit on a
// person — never gender/birthDate/phone/email, which belong to the members
// feature (members:read/write). Kept separate from members.tsx's own field
// helpers for the same reason the routes are separate: different permission gate.
type PersonFieldValues = {
  firstName: string;
  lastName: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFlash(c: any, message: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message, type }), { path: "/", maxAge: 10, httpOnly: false });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function formatAddress(p: Pick<Person, "street" | "houseNumber" | "zip" | "city">): string {
  const line1 = [p.street, p.houseNumber].filter(Boolean).join(" ");
  const line2 = [p.zip, p.city].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ") || "—";
}

export function parseDonorPersonFields(body: Record<string, any>): { values: PersonFieldValues; errors: Record<string, string> } {
  const values: PersonFieldValues = {
    firstName: String(body.firstName ?? "").trim(),
    lastName: String(body.lastName ?? "").trim(),
    street: String(body.street ?? "").trim(),
    houseNumber: String(body.houseNumber ?? "").trim(),
    zip: String(body.zip ?? "").trim(),
    city: String(body.city ?? "").trim(),
  };
  const errors: Record<string, string> = {};
  for (const key of ["firstName", "lastName", "street", "houseNumber", "zip", "city"] as const) {
    if (!values[key]) errors[key] = t("common.required");
  }
  return { values, errors };
}

// Get-or-create by personId — keeps every donation for a person under one
// `donors` row (donors.personId is UNIQUE), required for the Sammelbestätigung's
// "no other receipts for this donor" guarantee to hold.
export async function getOrCreateDonor(tx: typeof db, personId: string): Promise<DonorRow> {
  const [existing] = await tx.select().from(donors).where(eq(donors.personId, personId));
  if (existing) return existing;
  const [created] = await tx.insert(donors).values({ personId }).returning();
  return created;
}

// ── Shared form fields (donor picker) ───────────────────────────────────────

// Accepts nulls too so a `persons` row (nullable address columns) can be passed
// straight through as prefill values without a manual conversion step.
type PersonFieldInput = Partial<Record<keyof PersonFieldValues, string | null>>;

function personField(name: keyof PersonFieldValues, label: string, values: PersonFieldInput | undefined, errors: Record<string, string> | undefined) {
  const err = errors?.[name];
  return (
    <div class="form-control">
      <label class="label">
        <span class="label-text">{label}<span class="text-error ml-1">*</span></span>
      </label>
      <input
        type="text"
        id={`donor-${name}`}
        name={name}
        value={values?.[name] ?? ""}
        class={`input input-bordered w-full${err ? " input-error" : ""}`}
      />
      {err && <span class="text-error text-sm mt-1">{err}</span>}
    </div>
  );
}

// Plain 6-field form (no search picker) — used by /donors/new and /donors/:id/edit,
// where the person is already known.
export function DonorPersonFields({ values, errors }: { values?: PersonFieldInput; errors?: Record<string, string> }) {
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {personField("lastName", t("donors.form.lastName"), values, errors)}
        {personField("firstName", t("donors.form.firstName"), values, errors)}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {personField("street", t("donors.form.street"), values, errors)}
        {personField("houseNumber", t("donors.form.houseNumber"), values, errors)}
        {personField("zip", t("donors.form.zip"), values, errors)}
      </div>
      {personField("city", t("donors.form.city"), values, errors)}
    </>
  );
}

// Search-and-pick-or-create picker — used by /donors/new and /donations/new. Search
// results carry only the narrow field set (see search-persons route); selecting one
// or choosing "create new" both land on the same 6 editable fields, so an existing
// person's address can be corrected/completed inline either way.
export function DonorPickerFields({ personId, values, errors }: { personId?: string; values?: PersonFieldInput; errors?: Record<string, string> }) {
  const showFields = Boolean(personId) || Object.values(values ?? {}).some(Boolean);
  return (
    <div class="space-y-3">
      <div id="donor-picker-search" class={showFields ? "hidden" : ""}>
        <label class="label">
          <span class="label-text">{t("donations.form.donor")}<span class="text-error ml-1">*</span></span>
        </label>
        <input
          type="text"
          name="q"
          autocomplete="off"
          placeholder={t("donations.form.donorSearchPlaceholder")}
          class="input input-bordered w-full"
          hx-get="/donors/search-persons"
          hx-trigger="input changed delay:300ms"
          hx-target="#donor-picker-results"
        />
        <div id="donor-picker-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
      </div>
      <input type="hidden" id="donor-personId" name="personId" value={personId ?? ""} />
      <div id="donor-fields" class={`space-y-4${showFields ? "" : " hidden"}`}>
        <DonorPersonFields values={values} errors={errors} />
        <button type="button" class="btn btn-ghost btn-sm donor-change-selection">
          {t("donations.form.donorChangeSelection")}
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__donorPickerBound) {
          window.__donorPickerBound = true;
          document.body.addEventListener('click', function(e) {
            var resEl = e.target.closest('.donor-result');
            if (resEl) {
              document.getElementById('donor-personId').value = resEl.dataset.id;
              ['firstName','lastName','street','houseNumber','zip','city'].forEach(function(f) {
                document.getElementById('donor-' + f).value = resEl.dataset[f] || '';
              });
              document.getElementById('donor-fields').classList.remove('hidden');
              document.getElementById('donor-picker-search').classList.add('hidden');
              return;
            }
            if (e.target.closest('.donor-create-new')) {
              document.getElementById('donor-personId').value = '';
              ['firstName','lastName','street','houseNumber','zip','city'].forEach(function(f) {
                document.getElementById('donor-' + f).value = '';
              });
              document.getElementById('donor-fields').classList.remove('hidden');
              document.getElementById('donor-picker-search').classList.add('hidden');
              return;
            }
            if (e.target.closest('.donor-change-selection')) {
              document.getElementById('donor-personId').value = '';
              document.getElementById('donor-fields').classList.add('hidden');
              document.getElementById('donor-picker-search').classList.remove('hidden');
              document.getElementById('donor-picker-results').innerHTML = '';
              var input = document.querySelector('#donor-picker-search input[name=q]');
              if (input) { input.value = ''; input.focus(); }
            }
          });
        }
      ` }} />
    </div>
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /donors/search-persons — debounced live search for the donor picker.
// Own route (not /members' search) so the field/permission boundary is enforced
// by the query itself, not by trusting the caller to strip fields.
donorRoutes.get("/search-persons", requireAuth("donations:record"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.html("");

  const needle = `%${q}%`;
  const results = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      street: persons.street,
      houseNumber: persons.houseNumber,
      zip: persons.zip,
      city: persons.city,
    })
    .from(persons)
    .where(or(ilike(persons.firstName, needle), ilike(persons.lastName, needle)))
    .orderBy(asc(persons.lastName))
    .limit(10);

  if (results.length === 0) {
    return c.html(
      <div class="p-2">
        <p class="text-sm opacity-60 mb-1">{t("donations.form.donorNoResults", { query: q })}</p>
        <button type="button" class="btn btn-ghost btn-xs donor-create-new">{t("donations.form.donorNoMatch")}</button>
      </div>
    );
  }

  return c.html(
    <>
      {results.map((p) => (
        <div
          key={p.id}
          class="donor-result p-2 hover:bg-base-200 cursor-pointer text-sm"
          data-id={p.id}
          data-first-name={p.firstName}
          data-last-name={p.lastName}
          data-street={p.street ?? ""}
          data-house-number={p.houseNumber ?? ""}
          data-zip={p.zip ?? ""}
          data-city={p.city ?? ""}
        >
          <span class="font-medium">{p.firstName} {p.lastName}</span>
          {" — "}{formatAddress(p)}
        </div>
      ))}
      <div class="p-2">
        <button type="button" class="btn btn-ghost btn-xs donor-create-new">{t("donations.form.donorNoMatch")}</button>
      </div>
    </>
  );
});

// ── List query parsing ──────────────────────────────────────────────────────

type SortKey = "lastName" | "firstName";

function parseListQuery(q: Record<string, string>) {
  const search = q.search ?? "";
  const sort: SortKey = q.sort === "firstName" ? "firstName" : "lastName";
  const dir: "asc" | "desc" = q.sort_dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  return { search, sort, dir, page, pageSize };
}

function donorListUrl(base: Record<string, string | number>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== "" && v != null) params.set(k, String(v));
  return `/donors?${params}`;
}

// GET /donors — sortable/paginated/searchable list, name + address only (see
// Berechtigungsgrenze in the backlog note — no member-only data here).
donorRoutes.get("/", requireAuth(["donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const { search, sort, dir, page, pageSize } = parseListQuery(c.req.query());

  const all = (await db.query.donors.findMany({ with: { person: true } })) as DonorWithPerson[];
  const needle = search.toLowerCase();
  const filtered = search
    ? all.filter((d) => `${d.person.firstName} ${d.person.lastName}`.toLowerCase().includes(needle))
    : all;
  const sorted = [...filtered].sort((a, b) => {
    const cmp = a.person[sort].localeCompare(b.person[sort], "de");
    return dir === "asc" ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  return c.html(
    <Layout title={t("donors.title")} user={user} activeNav="donors">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("donors.title")}</h1>
        <a href="/donors/new" class="btn btn-primary btn-sm">{t("donors.addDonor")}</a>
      </div>

      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <form method="get" class="flex gap-2">
          <input
            type="search"
            name="search"
            placeholder={t("common.searchPlaceholder")}
            value={search}
            class="input input-bordered input-sm w-64"
          />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="sort_dir" value={dir} />
          <input type="hidden" name="pageSize" value={pageSize} />
          <button type="submit" class="btn btn-sm">{t("common.show")}</button>
        </form>
      </div>

      <ClickToEditHint />
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th><a href={donorListUrl({ search, sort: "lastName", sort_dir: sort === "lastName" && dir === "asc" ? "desc" : "asc", pageSize })} class="link link-hover">{t("donors.table.lastName")} <SortIcon col="lastName" active={sort} dir={dir} /></a></th>
            <th><a href={donorListUrl({ search, sort: "firstName", sort_dir: sort === "firstName" && dir === "asc" ? "desc" : "asc", pageSize })} class="link link-hover">{t("donors.table.firstName")} <SortIcon col="firstName" active={sort} dir={dir} /></a></th>
            <th>{t("donors.table.address")}</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr><td colspan={3} class="text-center opacity-50 py-8">{t("donors.table.empty")}</td></tr>
          ) : pageItems.map((d) => (
            <tr key={d.id} class="cursor-pointer hover" onclick={`window.location='/donors/${d.id}/edit'`}>
              <td class="font-medium">{d.person.lastName}</td>
              <td>{d.person.firstName}</td>
              <td>{formatAddress(d.person)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div class="flex flex-wrap items-center justify-end gap-4 mt-4">
        <span class="text-sm opacity-70 mr-auto">{t("donors.table.count", { count: sorted.length })}</span>
        <div class="join">
          {page > 1 && <a href={donorListUrl({ search, sort, sort_dir: dir, pageSize, page: page - 1 })} class="join-item btn btn-sm">«</a>}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a key={p} href={donorListUrl({ search, sort, sort_dir: dir, pageSize, page: p })} class={`join-item btn btn-sm${p === page ? " btn-active" : ""}`}>{p}</a>
          ))}
          {page < totalPages && <a href={donorListUrl({ search, sort, sort_dir: dir, pageSize, page: page + 1 })} class="join-item btn btn-sm">»</a>}
        </div>
      </div>
    </Layout>
  );
});

// GET /donors/new — create a donor directly (search-or-create picker)
donorRoutes.get("/new", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("donors.newDonor")} user={user} activeNav="donors">
      <div class="mb-4">
        <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("donors.newDonor")}</h1>
        <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
      </div>
      <form method="post" action="/donors/new" class="space-y-4 max-w-xl">
        <DonorPickerFields />
        <div class="flex gap-2 pt-4">
          <button type="submit" class="btn btn-primary">{t("common.save")}</button>
          <a href="/donors" class="btn btn-ghost">{t("common.cancel")}</a>
        </div>
      </form>
    </Layout>
  );
});

// POST /donors/new — get-or-create by personId
donorRoutes.post("/new", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const personId = String(body.personId ?? "").trim() || undefined;
  const { values, errors } = parseDonorPersonFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donors.newDonor")} user={user} activeNav="donors">
        <div class="mb-4">
          <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("donors.newDonor")}</h1>
          <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
        </div>
        <form method="post" action="/donors/new" class="space-y-4 max-w-xl">
          <DonorPickerFields personId={personId} values={values} errors={errors} />
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">{t("common.save")}</button>
            <a href="/donors" class="btn btn-ghost">{t("common.cancel")}</a>
          </div>
        </form>
      </Layout>,
      422
    );
  }

  const donor = await db.transaction(async (tx) => {
    let pid = personId;
    if (pid) {
      await tx.update(persons).set(values).where(eq(persons.id, pid));
    } else {
      const [person] = await tx.insert(persons).values(values).returning();
      pid = person.id;
    }
    return getOrCreateDonor(tx as unknown as typeof db, pid);
  });

  setFlash(c, t("donors.flash.created"), "success");
  return c.redirect(`/donors/${donor.id}/edit`);
});

// GET/POST /donors/:id/edit — name + address only, even if the person is also a member
donorRoutes.get("/:id/edit", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  const donor = await db.query.donors.findFirst({ where: eq(donors.id, c.req.param("id")), with: { person: true } }) as DonorWithPerson | undefined;
  if (!donor) return c.notFound();

  return c.html(
    <Layout title={t("donors.editDonor")} user={user} activeNav="donors">
      <div class="mb-4">
        <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{donor.person.firstName} {donor.person.lastName}</h1>
        <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
      </div>
      <form method="post" action={`/donors/${donor.id}/edit`} class="space-y-4 max-w-xl">
        <DonorPersonFields values={donor.person} />
        <div class="flex gap-2 pt-4">
          <button type="submit" class="btn btn-primary">{t("common.save")}</button>
          <a href="/donors" class="btn btn-ghost">{t("common.cancel")}</a>
        </div>
      </form>
    </Layout>
  );
});

donorRoutes.post("/:id/edit", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const donor = await db.query.donors.findFirst({ where: eq(donors.id, id), with: { person: true } }) as DonorWithPerson | undefined;
  if (!donor) return c.notFound();

  const body = await c.req.parseBody();
  const { values, errors } = parseDonorPersonFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donors.editDonor")} user={user} activeNav="donors">
        <div class="mb-4">
          <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{donor.person.firstName} {donor.person.lastName}</h1>
          <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
        </div>
        <form method="post" action={`/donors/${donor.id}/edit`} class="space-y-4 max-w-xl">
          <DonorPersonFields values={values} errors={errors} />
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">{t("common.save")}</button>
            <a href="/donors" class="btn btn-ghost">{t("common.cancel")}</a>
          </div>
        </form>
      </Layout>,
      422
    );
  }

  await db.update(persons).set(values).where(eq(persons.id, donor.personId));
  setFlash(c, t("donors.flash.saved"), "success");
  return c.redirect("/donors");
});

// ── Sammelbestätigung ────────────────────────────────────────────────────────

function currentYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

// GET /donors/:id/summary-receipt — period defaults to the current calendar year;
// already individually-issued donations are excluded (see Doppelbestätigungs-Sperre).
donorRoutes.get("/:id/summary-receipt", requireAuth("donations:issue-receipts"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const donor = await db.query.donors.findFirst({ where: eq(donors.id, id), with: { person: true } }) as DonorWithPerson | undefined;
  if (!donor) return c.notFound();

  const def = currentYearRange();
  const from = c.req.query("from") || def.from;
  const to = c.req.query("to") || def.to;

  const config = await loadOrgConfig();
  if (!isOrgConfigCompleteForReceipts(config)) {
    return c.html(
      <Layout title={t("donors.summaryReceipt.title")} user={user} activeNav="donors">
        <div class="alert alert-warning">
          <div>
            <h3 class="font-bold">{t("donations.receipt.blockedTitle")}</h3>
            <p>{t("donations.receipt.blockedBody")}</p>
            <a href="/admin/org-config" class="link">{t("donations.receipt.blockedLink")}</a>
          </div>
        </div>
      </Layout>
    );
  }

  const allInPeriod = await db.select().from(donations).where(
    and(eq(donations.donorId, donor.id), gte(donations.date, from), lte(donations.date, to))
  );
  const included = allInPeriod.filter((d) => !d.receiptIssuedAt).sort((a, b) => a.date.localeCompare(b.date));
  const excludedCount = allInPeriod.length - included.length;
  const total = included.reduce((sum, d) => sum + Number(d.amount), 0);

  const qs = `from=${from}&to=${to}`;
  const print = c.req.query("print") === "1";

  return c.html(
    <Layout title={t("donors.summaryReceipt.title")} user={user} activeNav="donors">
      <div class="mb-4 print:hidden">
        <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("donors.summaryReceipt.title")}</h1>
      </div>

      <form method="get" class="flex flex-wrap items-end gap-3 mb-6 print:hidden">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("donors.summaryReceipt.from")}</span></label>
          <input type="date" name="from" value={from} class="input input-bordered input-sm" />
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("donors.summaryReceipt.to")}</span></label>
          <input type="date" name="to" value={to} class="input input-bordered input-sm" />
        </div>
        <button type="submit" class="btn btn-sm">{t("common.apply")}</button>
      </form>

      {excludedCount > 0 && (
        <div class="alert alert-info max-w-2xl mb-4 print:hidden">
          <span>{t("donors.summaryReceipt.excludedNote", { count: excludedCount })}</span>
        </div>
      )}

      <div class="max-w-2xl border border-base-300 rounded-box p-8 print:border-none print:p-0">
        <p class="text-xs opacity-60 mb-6">{t("donors.summaryReceipt.musterRef")}</p>

        <p class="mb-1">{config.orgName}</p>
        <p class="mb-1">{[config.orgStreet, config.orgHouseNumber].filter(Boolean).join(" ")}</p>
        <p class="mb-6">{[config.orgZip, config.orgCity].filter(Boolean).join(" ")}</p>

        <p class="mb-1 font-semibold">{t("donors.summaryReceipt.donorLabel")}</p>
        <p class="mb-1">{donor.person.firstName} {donor.person.lastName}</p>
        <p class="mb-6">{formatAddress(donor.person)}</p>

        <p class="mb-4">{t("donors.summaryReceipt.period")}: {formatDate(from)} – {formatDate(to)}</p>

        {included.length === 0 ? (
          <p class="opacity-60 mb-4">{t("donors.summaryReceipt.empty")}</p>
        ) : (
          <table class="table table-sm w-full mb-4">
            <thead>
              <tr>
                <th>{t("donors.summaryReceipt.tableDate")}</th>
                <th>{t("donors.summaryReceipt.tableType")}</th>
                <th>{t("donors.summaryReceipt.tableWaiver")}</th>
                <th class="text-right">{t("donors.summaryReceipt.tableAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {included.map((d) => (
                <tr key={d.id}>
                  <td>{formatDate(d.date)}</td>
                  <td>{d.type === "cash" ? t("donations.form.typeCash") : t("donations.form.typeTransfer")}</td>
                  <td>{t("donors.summaryReceipt.waiverNo")}</td>
                  <td class="text-right">{Number(d.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr class="font-semibold">
                <td colspan={3}>{t("donors.summaryReceipt.total")}</td>
                <td class="text-right">{total.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</td>
              </tr>
            </tfoot>
          </table>
        )}

        <p class="mb-4">{t("donors.summaryReceipt.confirmText")}</p>
        <p class="mb-4">{t("donors.summaryReceipt.noOtherReceipts")}</p>
        <p class="mb-4">{t("donors.summaryReceipt.exemptionText", { taxOffice: config.taxOffice, taxExemptionDate: formatDate(config.taxExemptionDate), taxExemptionNumber: config.taxExemptionNumber })}</p>
        <p class="text-xs mb-8">{t("donors.summaryReceipt.liabilityText")}</p>

        <div class="flex justify-between mt-12 pt-2">
          <span class="border-t border-base-content/40 pt-1 text-sm w-48">{t("donors.summaryReceipt.place")}</span>
          <span class="border-t border-base-content/40 pt-1 text-sm w-48">{t("donors.summaryReceipt.signature")}</span>
        </div>

        <p class="text-xs opacity-50 mt-8 print:hidden">{t("donors.summaryReceipt.disclaimer")}</p>
      </div>

      {included.length > 0 && (
        <form method="post" action={`/donors/${donor.id}/summary-receipt/mark-issued?${qs}`} class="mt-4 print:hidden">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <button type="submit" class="btn btn-primary">{t("donors.summaryReceipt.print")}</button>
        </form>
      )}

      {print && <script dangerouslySetInnerHTML={{ __html: "window.print();" }} />}
    </Layout>
  );
});

// POST /donors/:id/summary-receipt/mark-issued — re-derives the included set
// server-side from from/to (never trusts a client-submitted id list) and stamps
// receiptIssuedAt on all of them.
donorRoutes.post("/:id/summary-receipt/mark-issued", requireAuth("donations:issue-receipts"), async (c) => {
  const id = c.req.param("id");
  const donor = await db.query.donors.findFirst({ where: eq(donors.id, id) });
  if (!donor) return c.notFound();

  const body = await c.req.parseBody();
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");

  await db.update(donations).set({ receiptIssuedAt: new Date() }).where(
    and(eq(donations.donorId, id), gte(donations.date, from), lte(donations.date, to), isNull(donations.receiptIssuedAt))
  );

  return c.redirect(`/donors/${id}/summary-receipt?from=${from}&to=${to}&print=1`);
});
