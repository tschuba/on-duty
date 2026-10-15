import { Hono } from "hono";
import { eq, or, ilike, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { persons, donors } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { MemberMark, MemberFilter } from "../components/member-mark.js";
import { SortIcon } from "./members.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { parsePagination, buildListUrl } from "../lib/list-query.js";
import { trimmed } from "../lib/forms.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

export const donorRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type DonorRow = typeof donors.$inferSelect;
type DonorWithPerson = DonorRow & { person: Person & { member?: { id: string } | null } };

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

function formatAddress(p: Pick<Person, "street" | "houseNumber" | "zip" | "city">): string {
  const line1 = [p.street, p.houseNumber].filter(Boolean).join(" ");
  const line2 = [p.zip, p.city].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ") || "—";
}

export function parseDonorPersonFields(body: Record<string, any>): { values: PersonFieldValues; errors: Record<string, string> } {
  const values: PersonFieldValues = {
    firstName: trimmed(body, "firstName"),
    lastName: trimmed(body, "lastName"),
    street: trimmed(body, "street"),
    houseNumber: trimmed(body, "houseNumber"),
    zip: trimmed(body, "zip"),
    city: trimmed(body, "city"),
  };
  const errors: Record<string, string> = {};
  for (const key of ["firstName", "lastName", "street", "houseNumber", "zip", "city"] as const) {
    if (!values[key]) errors[key] = t("common.required");
  }
  return { values, errors };
}

// Get-or-create by personId — keeps every donation for a person under one
// `donors` row (donors.personId is UNIQUE).
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
          hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
          hx-target="#donor-picker-results"
        />
        <div id="donor-picker-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
      </div>
      <input type="hidden" id="donor-personId" name="personId" value={personId ?? ""} />
      <div id="donor-fields" class={`space-y-4${showFields ? "" : " hidden"}`}>
        <DonorPersonFields values={values} errors={errors} />
        <button type="button" class="btn btn-ghost donor-change-selection">
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
        <button type="button" class="btn btn-ghost btn-sm donor-create-new">{t("donations.form.donorNoMatch")}</button>
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
        <button type="button" class="btn btn-ghost btn-sm donor-create-new">{t("donations.form.donorNoMatch")}</button>
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
  const { page, pageSize } = parsePagination(q);
  const member = q.member === "yes" || q.member === "no" ? q.member : "";
  return { search, sort, dir, page, pageSize, member };
}

function donorListUrl(base: Record<string, string | number>) {
  return buildListUrl("/donors", {}, base);
}

// GET /donors — sortable/paginated/searchable list, name + address only (see
// Berechtigungsgrenze in the backlog note — no member-only data here).
donorRoutes.get("/", requireAuth(["donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const { search, sort, dir, page, pageSize, member } = parseListQuery(c.req.query());
  const canLink = Boolean(user.permissions.has("members:read"));

  const all = (await db.query.donors.findMany({ with: { person: { with: { member: true } } } })) as DonorWithPerson[];
  const needle = search.toLowerCase();
  const filtered = all
    .filter((d) => !search || `${d.person.firstName} ${d.person.lastName}`.toLowerCase().includes(needle))
    .filter((d) => !member || Boolean(d.person.member) === (member === "yes"));
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
        <a href="/donors/new" class="btn btn-primary">{t("donors.addDonor")}</a>
      </div>

      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <form method="get" class="flex gap-2">
          <input
            type="search"
            name="search"
            placeholder={t("common.searchPlaceholder")}
            value={search}
            class="input input-bordered w-64"
          />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="sort_dir" value={dir} />
          <input type="hidden" name="pageSize" value={pageSize} />
          <input type="hidden" name="member" value={member} />
          <button type="submit" class="btn">{t("common.show")}</button>
        </form>
        <MemberFilter
          value={member}
          options={[{ value: "", label: t("common.filter.all") }, { value: "yes", label: t("common.filter.members") }, { value: "no", label: t("common.filter.nonMembers") }]}
          href={(m) => donorListUrl({ search, sort, sort_dir: dir, pageSize, member: m })}
        />
      </div>

      <ClickToEditHint />
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th><a href={donorListUrl({ search, sort: "lastName", sort_dir: sort === "lastName" && dir === "asc" ? "desc" : "asc", pageSize, member })} class="link link-hover">{t("donors.table.lastName")} <SortIcon col="lastName" active={sort} dir={dir} /></a></th>
            <th><a href={donorListUrl({ search, sort: "firstName", sort_dir: sort === "firstName" && dir === "asc" ? "desc" : "asc", pageSize, member })} class="link link-hover">{t("donors.table.firstName")} <SortIcon col="firstName" active={sort} dir={dir} /></a></th>
            <th>{t("donors.table.address")}</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr><td colspan={3} class="text-center opacity-50 py-8">{t("donors.table.empty")}</td></tr>
          ) : pageItems.map((d) => (
            <tr key={d.id} class="cursor-pointer hover" onclick={`window.location='/donors/${d.id}/edit'`}>
              <td class="font-medium">{d.person.lastName}</td>
              <td>{d.person.firstName}<MemberMark memberId={d.person.member?.id} canLink={canLink} /></td>
              <td>{formatAddress(d.person)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div class="flex flex-wrap items-center justify-end gap-4 mt-4">
        <span class="text-sm opacity-70 mr-auto">{t("donors.table.count", { count: sorted.length })}</span>
        <div class="join">
          {page > 1 && <a href={donorListUrl({ search, sort, sort_dir: dir, pageSize, member, page: page - 1 })} class="join-item btn">«</a>}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a key={p} href={donorListUrl({ search, sort, sort_dir: dir, pageSize, member, page: p })} class={`join-item btn${p === page ? " btn-active" : ""}`}>{p}</a>
          ))}
          {page < totalPages && <a href={donorListUrl({ search, sort, sort_dir: dir, pageSize, member, page: page + 1 })} class="join-item btn">»</a>}
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
  const personId = trimmed(body, "personId") || undefined;
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
  const donor = await db.query.donors.findFirst({ where: eq(donors.id, c.req.param("id")), with: { person: { with: { member: true } } } }) as DonorWithPerson | undefined;
  if (!donor) return c.notFound();
  const canLink = Boolean(user.permissions.has("members:read"));

  return c.html(
    <Layout title={t("donors.editDonor")} user={user} activeNav="donors">
      <div class="mb-4">
        <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{donor.person.firstName} {donor.person.lastName}<MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></h1>
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
  const donor = await db.query.donors.findFirst({ where: eq(donors.id, id), with: { person: { with: { member: true } } } }) as DonorWithPerson | undefined;
  if (!donor) return c.notFound();
  const canLink = Boolean(user.permissions.has("members:read"));

  const body = await c.req.parseBody();
  const { values, errors } = parseDonorPersonFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donors.editDonor")} user={user} activeNav="donors">
        <div class="mb-4">
          <a href="/donors" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{donor.person.firstName} {donor.person.lastName}<MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></h1>
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

