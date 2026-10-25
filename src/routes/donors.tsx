import { Hono } from "hono";
import { eq, or, ilike, asc, and, exists, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { persons, donors, members } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { countOpenReceipts, recipientName } from "../lib/donations.js";
import { ClickToEditHint, DonationTabs, Layout } from "../components/layout.js";
import { ToggleFilter, pairToggles } from "../components/toggle-filter.js";
import { MemberMark, MemberLink } from "../components/member-mark.js";
import { Icon } from "../components/icon.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { SortIcon } from "./members.js";
import { Pager } from "../components/pager.js";
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
  companyName: string | null;
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
    companyName: trimmed(body, "companyName") || null,
  };
  const errors: Record<string, string> = {};
  // With a company name the contact person (first/last name) is optional; without one both are required.
  const required = ["firstName", "lastName", "street", "houseNumber", "zip", "city"] as const;
  for (const key of required) {
    if (!values[key] && !(values.companyName && (key === "firstName" || key === "lastName"))) errors[key] = t("common.required");
  }
  return { values, errors };
}

// For "create new person": a member/donor with the same name probably means the user skipped the search.
// Returns an error for DonorPickerFields unless the user ticked "create anyway".
export async function duplicatePersonError(body: Record<string, any>, values: PersonFieldValues): Promise<string | undefined> {
  if (trimmed(body, "personId") || trimmed(body, "confirmDuplicate") || !values.firstName || !values.lastName) return undefined;
  const [hit] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(
      sql`lower(${persons.firstName}) = ${values.firstName.toLowerCase()}`,
      sql`lower(${persons.lastName}) = ${values.lastName.toLowerCase()}`,
      or(exists(db.select({ x: members.id }).from(members).where(eq(members.personId, persons.id))), exists(db.select({ x: donors.id }).from(donors).where(eq(donors.personId, persons.id)))),
    ))
    .limit(1);
  return hit ? t("donations.form.duplicateWarning") : undefined;
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

function personField(name: keyof PersonFieldValues, label: string, values: PersonFieldInput | undefined, errors: Record<string, string> | undefined, optional = false) {
  const err = errors?.[name];
  return (
    <div class="flex flex-col">
      <label class="label">
        <span class="text-sm">{label}{!optional && <span class="text-error ml-1">*</span>}</span>
      </label>
      <input
        type="text"
        id={`donor-${name}`}
        name={name}
        value={values?.[name] ?? ""}
        class={`input input w-full${err ? " input-error" : ""}`}
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
      {personField("companyName", t("donors.form.companyName"), values, errors, true)}
      <p class="text-xs opacity-60 -mt-2">{t("donors.form.nameHint")}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {personField("lastName", t("donors.form.lastName"), values, errors, true)}
        {personField("firstName", t("donors.form.firstName"), values, errors, true)}
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
          <span class="text-sm">{t("donations.form.donor")}</span>
        </label>
        <label class="input input flex items-center gap-2 w-full">
          <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
          <input
            type="text"
            name="q"
            autocomplete="off"
            placeholder={t("donations.form.donorSearchPlaceholder")}
            class="grow min-w-0"
            hx-get="/donors/search-persons"
            hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
            hx-target="#donor-picker-results"
          />
        </label>
        <div id="donor-picker-results" class="mt-1 border border-base-300 rounded-box divide-y empty:border-none" />
        <button type="button" class="link link-primary text-sm mt-2 donor-create-new">{t("donations.form.donorCreateNew")}</button>
      </div>
      <input type="hidden" id="donor-personId" name="personId" value={personId ?? ""} />
      <div id="donor-fields" class={`space-y-4${showFields ? "" : " hidden"}`}>
        {errors?.duplicate && (
          <div class="alert alert-warning">
            <div>
              <p>{errors.duplicate}</p>
              <label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">
                <input type="checkbox" name="confirmDuplicate" value="1" class="checkbox checkbox-sm" />
                <span class="text-sm">{t("donations.form.duplicateConfirm")}</span>
              </label>
            </div>
          </div>
        )}
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
              ['firstName','lastName','street','houseNumber','zip','city','companyName'].forEach(function(f) {
                document.getElementById('donor-' + f).value = resEl.dataset[f] || '';
              });
              document.getElementById('donor-fields').classList.remove('hidden');
              document.getElementById('donor-picker-search').classList.add('hidden');
              return;
            }
            if (e.target.closest('.donor-create-new')) {
              document.getElementById('donor-personId').value = '';
              ['firstName','lastName','street','houseNumber','zip','city','companyName'].forEach(function(f) {
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
      companyName: persons.companyName,
    })
    .from(persons)
    .where(and(
      or(ilike(persons.firstName, needle), ilike(persons.lastName, needle), ilike(persons.companyName, needle)),
      // Only members and existing donors: persons that exist solely for applications/guardians would show up as duplicates.
      or(exists(db.select({ x: members.id }).from(members).where(eq(members.personId, persons.id))), exists(db.select({ x: donors.id }).from(donors).where(eq(donors.personId, persons.id)))),
    ))
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
          data-company-name={p.companyName ?? ""}
        >
          <span class="font-medium">{recipientName(p)}</span>
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
donorRoutes.get("/", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const { search, sort, dir, page, pageSize, member } = parseListQuery(c.req.query());
  const canLink = Boolean(user.permissions.has("members:read"));
  const canRecord = user.permissions.has("donations:record");
  const openReceipts = user.permissions.has("donations:issue-receipts") ? await countOpenReceipts() : 0;

  const all = (await db.query.donors.findMany({ with: { person: { with: { member: true } } } })) as DonorWithPerson[];
  const needle = search.toLowerCase();
  const filtered = all
    .filter((d) => !search || `${d.person.companyName ?? ""} ${d.person.firstName} ${d.person.lastName}`.toLowerCase().includes(needle))
    .filter((d) => !member || Boolean(d.person.member) === (member === "yes"));
  const sorted = [...filtered].sort((a, b) => {
    const cmp = a.person[sort].localeCompare(b.person[sort], "de");
    return dir === "asc" ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  return c.html(
    <Layout title={t("donors.title")} user={user} activeNav="donations">
      <DonationTabs active="donors" openReceiptsCount={openReceipts} />
      <PageHeader title={t("donors.title")} actions={canRecord && <HeaderAction variant="primary" icon="plus" label={t("donors.addDonor")} href="/donors/new" class="btn-primary" />} />

      <div class="filter-bar flex flex-wrap gap-3 mb-4 items-center">
        <form method="get" class="flex gap-2 w-full md:w-auto">
          <label class="input input flex items-center gap-2 min-w-0 flex-1 md:w-64 md:flex-none">
            <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
            <input
              type="search"
              name="search"
              placeholder={t("common.searchPlaceholder")}
              value={search}
              class="grow min-w-0"
            />
          </label>
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="sort_dir" value={dir} />
          <input type="hidden" name="pageSize" value={pageSize} />
          <input type="hidden" name="member" value={member} />
          <button type="submit" class="btn">{t("common.show")}</button>
        </form>
        <ToggleFilter items={pairToggles(member,
          [{ value: "yes", label: t("common.filter.members") }, { value: "no", label: t("common.filter.nonMembers") }],
          (m) => donorListUrl({ search, sort, sort_dir: dir, pageSize, member: m }))} />
      </div>

      <ClickToEditHint />
      <div class="overflow-x-auto">
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th><a href={donorListUrl({ search, sort: "lastName", sort_dir: sort === "lastName" && dir === "asc" ? "desc" : "asc", pageSize, member })} class="link link-hover">{t("donors.table.lastName")} <SortIcon col="lastName" active={sort} dir={dir} /></a></th>
            <th><a href={donorListUrl({ search, sort: "firstName", sort_dir: sort === "firstName" && dir === "asc" ? "desc" : "asc", pageSize, member })} class="link link-hover">{t("donors.table.firstName")} <SortIcon col="firstName" active={sort} dir={dir} /></a></th>
            <th>{t("donors.table.companyName")}</th>
            <th>{t("donors.table.address")}</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr><td colspan={4} class="text-center opacity-50 py-8">{t("donors.table.empty")}</td></tr>
          ) : pageItems.map((d) => (
            <tr key={d.id} class="cursor-pointer hover" onclick={canRecord ? `window.location='/donors/${d.id}/edit'` : undefined}>
              <td class="font-medium"><MemberLink memberId={d.person.member?.id} canLink={canLink}>{d.person.lastName || "—"}</MemberLink><MemberMark memberId={d.person.member?.id} canLink={canLink} /></td>
              <td>{d.person.firstName}</td>
              <td>{d.person.companyName ?? "—"}</td>
              <td>{formatAddress(d.person)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <Pager
        countLabel={t("donors.table.count", { count: sorted.length })}
        page={page}
        totalPages={totalPages}
        pageUrl={(p) => donorListUrl({ search, sort, sort_dir: dir, pageSize, member, page: p })}
      />
    </Layout>
  );
});

// GET /donors/new — create a donor directly (search-or-create picker)
donorRoutes.get("/new", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("donors.newDonor")} user={user} activeNav="donations">
      <PageHeader title={t("donors.newDonor")} backHref="/donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" />} />
      <form id="donor-form" method="post" action="/donors/new" class="space-y-4 max-w-xl">
        <DonorPickerFields />
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
  const dup = await duplicatePersonError(body, values);
  if (dup) errors.duplicate = dup;

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donors.newDonor")} user={user} activeNav="donations">
        <PageHeader title={t("donors.newDonor")} backHref="/donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" />} />
        <form id="donor-form" method="post" action="/donors/new" class="space-y-4 max-w-xl">
          <DonorPickerFields personId={personId} values={values} errors={errors} />
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
  const canRecord = user.permissions.has("donations:record");

  return c.html(
    <Layout title={t("donors.editDonor")} user={user} activeNav="donations">
      <PageHeader title={<><MemberLink memberId={donor.person.member?.id} canLink={canLink}>{recipientName(donor.person)}</MemberLink><MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" />} />
      <form id="donor-form" method="post" action={`/donors/${donor.id}/edit`} class="space-y-4 max-w-xl">
        <DonorPersonFields values={donor.person} />
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
  const canRecord = user.permissions.has("donations:record");

  const body = await c.req.parseBody();
  const { values, errors } = parseDonorPersonFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donors.editDonor")} user={user} activeNav="donations">
        <PageHeader title={<><MemberLink memberId={donor.person.member?.id} canLink={canLink}>{recipientName(donor.person)}</MemberLink><MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" />} />
        <form id="donor-form" method="post" action={`/donors/${donor.id}/edit`} class="space-y-4 max-w-xl">
          <DonorPersonFields values={values} errors={errors} />
        </form>
      </Layout>,
      422
    );
  }

  await db.update(persons).set(values).where(eq(persons.id, donor.personId));
  setFlash(c, t("donors.flash.saved"), "success");
  return c.redirect("/donors");
});

