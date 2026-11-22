import { Hono } from "hono";
import { Address, AddressFields, AddressView } from "../components/address.js";
import { eq, or, ilike, asc, desc, and, exists, sql } from "drizzle-orm";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { db } from "../db/index.js";
import { persons, donors, donations, members } from "../db/schema/index.js";
import { readableMemberIds } from "../lib/member-scope.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { recipientName } from "../lib/donations.js";
import { formatDate } from "../lib/format.js";
import { Layout } from "../components/layout.js";
import { MemberMark, MemberLink } from "../components/member-mark.js";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";
import { DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { buildListUrl } from "../lib/list-query.js";
import { trimmed } from "../lib/forms.js";

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
    <Field label={label} required={!optional} after={err && <span class="text-error text-sm mt-1 block">{err}</span>}>
      <input
        type="text"
        id={`donor-${name}`}
        name={name}
        value={values?.[name] ?? ""}
        placeholder={label}
        class={`input w-full${err ? " input-error" : ""}`}
      />
    </Field>
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
      <AddressFields street={personField("street", t("donors.form.street"), values, errors)} houseNumber={personField("houseNumber", t("donors.form.houseNumber"), values, errors)} zip={personField("zip", t("donors.form.zip"), values, errors)} city={personField("city", t("donors.form.city"), values, errors)} />
    </>
  );
}

// Search-and-pick-or-create picker — used by /donors/new and /donations/new. Search
// results carry only the narrow field set (see search-persons route); selecting one
// or choosing "create new" both land on the same 6 editable fields, so an existing
// person's address can be corrected/completed inline either way.
export function DonorPickerFields({ personId, values, errors }: { personId?: string; values?: PersonFieldInput; errors?: Record<string, string> }) {
  const showFields = Boolean(personId) || Object.values(values ?? {}).some(Boolean);
  const selectedName = personId && values ? recipientName({ firstName: values.firstName ?? "", lastName: values.lastName ?? "", companyName: values.companyName }) : undefined;
  return (
    <div class="space-y-3" id="donor-picker">
      <div>
        <p class="fieldset-legend">{t("donations.form.donor")}</p>
        <EntityPicker id="donor-personId" name="personId" searchUrl="/donors/search-persons" selectedId={personId} selectedName={selectedName} placeholder={t("donations.form.donorSearchPlaceholder")} />
      </div>
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
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var root = document.getElementById('donor-picker'), fields = ['firstName','lastName','street','houseNumber','zip','city','companyName'];
          var show = function(on, d) {
            fields.forEach(function(f) { document.getElementById('donor-' + f).value = (d && d[f]) || ''; });
            document.getElementById('donor-fields').classList.toggle('hidden', !on);
          };
          root.addEventListener('picker:select', function(e) { show(true, e.detail); });
          root.addEventListener('picker:create', function() { document.getElementById('donor-personId').value = ''; show(true); });
          root.addEventListener('picker:clear', function() { show(false); });
        })();
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

  return c.html(
    <PickerOptions
      empty={t("picker.noResults", { query: q })}
      createLabel={t("donations.form.donorNoMatch")}
      options={results.map((p) => ({
        id: p.id,
        name: recipientName(p),
        sub: formatAddress(p),
        data: { firstName: p.firstName, lastName: p.lastName, street: p.street, houseNumber: p.houseNumber, zip: p.zip, city: p.city, companyName: p.companyName },
      }))}
    />
  );
});

// GET /donors — the list lives in /donations?view=donors; keep old links working.
donorRoutes.get("/", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), (c) => {
  const { view: _view, ...rest } = c.req.query();
  return c.redirect(buildListUrl("/donations", { ...rest, view: "donors" }));
});

// GET /donors/new — create a donor directly (search-or-create picker)
donorRoutes.get("/new", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("donors.newDonor")} user={user}>
      <PageHeader title={t("donors.newDonor")} backHref="/donations?view=donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" />} />
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
      <Layout title={t("donors.newDonor")} user={user}>
        <PageHeader title={t("donors.newDonor")} backHref="/donations?view=donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" />} />
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
  return c.redirect(`/donors/${donor.id}`);
});

async function fetchDonorWithPerson(id: string) {
  return db.query.donors.findFirst({ where: eq(donors.id, id), with: { person: { with: { member: true } } } }) as Promise<DonorWithPerson | undefined>;
}

// GET /donors/:id — read-only; everyone who can see the list
donorRoutes.get("/:id", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const donor = await fetchDonorWithPerson(c.req.param("id"));
  if (!donor) return c.notFound();
  const canLink = user.permissions.has("members:read") && (await readableMemberIds(user.memberScope?.read));
  const canRecord = user.permissions.has("donations:record");
  const history = await db.select().from(donations).where(eq(donations.donorId, donor.id)).orderBy(desc(donations.date));

  return c.html(
    <Layout title={recipientName(donor.person)} user={user}>
      <PageHeader title={<><MemberLink memberId={donor.person.member?.id} canLink={canLink}>{recipientName(donor.person)}</MemberLink><MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donations?view=donors" actions={<DetailActions editHref={canRecord ? `/donors/${donor.id}/edit` : undefined} />} />
      <ViewGrid>
        <ViewField label={t("donors.table.companyName")} value={donor.person.companyName} />
        <ViewField label={t("donors.form.lastName")} value={donor.person.lastName} />
        <ViewField label={t("donors.form.firstName")} value={donor.person.firstName} />
        <AddressView p={donor.person} />
      </ViewGrid>
      <h2 class="font-semibold mt-6 mb-2">{t("donations.history")}</h2>
      <div class="overflow-x-auto max-w-xl">
        <table class="table table-zebra w-full">
          <thead><tr><th>{t("donations.table.date")}</th><th class="text-right">{t("donations.table.amount")}</th><th>{t("donations.table.purpose")}</th></tr></thead>
          <tbody>
            {history.length === 0 ? (
              <tr><td colspan={3} class="text-center opacity-50 py-4">{t("donations.table.empty")}</td></tr>
            ) : history.map((d) => (
              <tr key={d.id} class="cursor-pointer hover" onclick={`window.location='/donations/${d.id}'`}>
                <td><a href={`/donations/${d.id}`} class="link">{formatDate(d.date)}</a></td>
                <td class="text-right whitespace-nowrap">{Number(d.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</td>
                <td>{d.purpose ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

// GET/POST /donors/:id/edit — name + address only, even if the person is also a member
donorRoutes.get("/:id/edit", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const donor = await fetchDonorWithPerson(c.req.param("id"));
  if (!donor) return c.notFound();
  if (!user.permissions.has("donations:record")) return c.redirect(`/donors/${donor.id}`);
  const canLink = user.permissions.has("members:read") && (await readableMemberIds(user.memberScope?.read));

  return c.html(
    <Layout title={t("donors.editDonor")} user={user}>
      <PageHeader title={<><MemberLink memberId={donor.person.member?.id} canLink={canLink}>{recipientName(donor.person)}</MemberLink><MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donations?view=donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" cancelHref={`/donors/${donor.id}`} />} />
      <form id="donor-form" method="post" action={`/donors/${donor.id}/edit`} class="space-y-4 max-w-xl">
        <DonorPersonFields values={donor.person} />
      </form>
    </Layout>
  );
});

donorRoutes.post("/:id/edit", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const donor = await fetchDonorWithPerson(id);
  if (!donor) return c.notFound();
  const canLink = user.permissions.has("members:read") && (await readableMemberIds(user.memberScope?.read));

  const body = await c.req.parseBody();
  const { values, errors } = parseDonorPersonFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donors.editDonor")} user={user}>
        <PageHeader title={<><MemberLink memberId={donor.person.member?.id} canLink={canLink}>{recipientName(donor.person)}</MemberLink><MemberMark memberId={donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donations?view=donors" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donor-form" cancelHref={`/donors/${donor.id}`} />} />
        <form id="donor-form" method="post" action={`/donors/${donor.id}/edit`} class="space-y-4 max-w-xl">
          <DonorPersonFields values={values} errors={errors} />
        </form>
      </Layout>,
      422
    );
  }

  await db.update(persons).set(values).where(eq(persons.id, donor.personId));
  setFlash(c, t("donors.flash.saved"), "success");
  return c.redirect(`/donors/${id}`);
});

