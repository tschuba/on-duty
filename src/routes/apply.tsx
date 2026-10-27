import { Hono } from "hono";
import { EmailField, EmailInput, Field, PhoneField, PhoneInput } from "../components/field.js";
import { db } from "../db/index.js";
import { persons, applications, applicationGuardians } from "../db/schema/index.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { checkRateLimit, recordFailedAttempt } from "../lib/ratelimit.js";
import { loadOrgConfig, notificationRecipient } from "../lib/org-config.js";
import { isApplicationFormActive } from "../lib/application-forms.js";
import { sendMail } from "../lib/mail.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { ContactFooter, Honeypot, PrivacyNotice, clientIp } from "../components/public-form.js";

export const applyRoutes = new Hono();

// ── Applicant fields (shared by /apply and /apply/youth) ───────────────────────

type ApplicantValues = {
  lastName: string; firstName: string; birthDate: string;
  street: string; houseNumber: string; zip: string; city: string;
  email: string; phone: string; message: string;
};

function parseApplicantFields(body: Record<string, any>): { values: ApplicantValues; errors: Record<string, string> } {
  const values: ApplicantValues = {
    lastName: String(body.lastName ?? "").trim(),
    firstName: String(body.firstName ?? "").trim(),
    birthDate: String(body.birthDate ?? "").trim(),
    street: String(body.street ?? "").trim(),
    houseNumber: String(body.houseNumber ?? "").trim(),
    zip: String(body.zip ?? "").trim(),
    city: String(body.city ?? "").trim(),
    email: String(body.email ?? "").trim(),
    phone: String(body.phone ?? "").trim(),
    message: String(body.message ?? "").trim(),
  };
  const errors: Record<string, string> = {};
  for (const key of ["lastName", "firstName", "birthDate", "street", "houseNumber", "zip", "city"] as const) {
    if (!values[key]) errors[key] = t("common.required");
  }
  if (!values.email && !values.phone) errors.contact = t("apply.error.contactRequired");
  return { values, errors };
}

function textField(
  name: string,
  label: string,
  value: string,
  error: string | undefined,
  opts: { type?: string; required?: boolean; hideErrorText?: boolean } = {},
) {
  if (opts.type === "email") return <EmailField label={label} name={name} value={value} error={!!error} />;
  if (opts.type === "tel") return <PhoneField label={label} name={name} value={value} error={!!error} />;
  const date = opts.type === "date";
  return (
    <Field label={label} required={opts.required} floating={!date}>
      <input
        type={opts.type ?? "text"}
        name={name}
        value={value}
        placeholder={label}
        class={`input w-full${error ? " input-error" : ""}`}
      />
      {error && !opts.hideErrorText && <span class="text-error text-sm mt-1">{error}</span>}
    </Field>
  );
}

function ApplicantFormFields({ values, errors }: { values: ApplicantValues; errors: Record<string, string> }) {
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {textField("lastName", t("apply.form.lastName"), values.lastName, errors.lastName, { required: true })}
        {textField("firstName", t("apply.form.firstName"), values.firstName, errors.firstName, { required: true })}
      </div>
      {textField("birthDate", t("apply.form.birthDate"), values.birthDate, errors.birthDate, { type: "date", required: true })}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {textField("street", t("apply.form.street"), values.street, errors.street, { required: true })}
        {textField("houseNumber", t("apply.form.houseNumber"), values.houseNumber, errors.houseNumber, { required: true })}
        {textField("zip", t("apply.form.zip"), values.zip, errors.zip, { required: true })}
      </div>
      {textField("city", t("apply.form.city"), values.city, errors.city, { required: true })}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {textField("email", t("apply.form.email"), values.email, errors.contact, { type: "email", hideErrorText: true })}
        {textField("phone", t("apply.form.phone"), values.phone, errors.contact, { type: "tel", hideErrorText: true })}
      </div>
      {errors.contact
        ? <p class="text-error text-sm">{errors.contact}</p>
        : <p class="text-sm opacity-60">{t("apply.error.contactRequired")}</p>}
      <Field label={t("apply.form.message")}>
        <textarea name="message" class="textarea w-full" rows={3} placeholder={t("apply.form.message")}>{values.message}</textarea>
      </Field>
    </>
  );
}

// ── Guardian fields (youth form only) ───────────────────────────────────────────

type GuardianValues = { firstName: string; lastName: string; email: string; phone: string };

type GuardianRowError = { nameError: string | null; contactError: string | null };

function parseGuardianRows(body: Record<string, any>): { rows: GuardianValues[]; rowErrors: GuardianRowError[]; hasGuardianError: boolean } {
  const firstNames = [body["guardian_firstName[]"]].flat().map((v) => String(v ?? "").trim());
  const lastNames = [body["guardian_lastName[]"]].flat().map((v) => String(v ?? "").trim());
  const emails = [body["guardian_email[]"]].flat().map((v) => String(v ?? "").trim());
  const phones = [body["guardian_phone[]"]].flat().map((v) => String(v ?? "").trim());

  const rows = firstNames
    .map((_, i) => ({ firstName: firstNames[i] ?? "", lastName: lastNames[i] ?? "", email: emails[i] ?? "", phone: phones[i] ?? "" }))
    .filter((r) => r.firstName || r.lastName || r.email || r.phone);

  let hasGuardianError = false;
  const rowErrors = rows.map((r) => {
    const nameError = (!r.firstName || !r.lastName) ? t("common.required") : null;
    const contactError = (!r.email && !r.phone) ? t("apply.youth.error.guardianContactRequired") : null;
    if (nameError || contactError) hasGuardianError = true;
    return { nameError, contactError };
  });

  return { rows, rowErrors, hasGuardianError };
}

// index === -1 renders a "__N__" placeholder instead of a number — used only for
// the <template> row, which client-side JS clones and renumbers on "add" clicks
// (avoids duplicating the translated label string in the inline script).
function GuardianRow({ index, values, error }: { index: number; values?: GuardianValues; error?: GuardianRowError | null }) {
  const label = t("apply.youth.guardian.title", { index: index === -1 ? "__N__" : String(index + 1) });
  const nameError = error?.nameError;
  const contactError = error?.contactError;
  return (
    <div class="guardian-row border border-base-300 rounded-box p-4 mb-3">
      <div class="flex items-center justify-between mb-2">
        <span class="font-medium text-sm">{label}</span>
        <button type="button" class="btn btn-ghost btn-sm guardian-remove" onclick="this.closest('.guardian-row').remove()">
          {t("apply.youth.guardian.remove")}
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="text" name="guardian_firstName[]" placeholder={t("apply.youth.guardian.firstName")} value={values?.firstName ?? ""} class={`input w-full${nameError ? " input-error" : ""}`} />
        <input type="text" name="guardian_lastName[]" placeholder={t("apply.youth.guardian.lastName")} value={values?.lastName ?? ""} class={`input w-full${nameError ? " input-error" : ""}`} />
        <EmailInput name="guardian_email[]" placeholder={t("apply.youth.guardian.email")} value={values?.email ?? ""} error={!!contactError} />
        <PhoneInput name="guardian_phone[]" placeholder={t("apply.youth.guardian.phone")} value={values?.phone ?? ""} error={!!contactError} />
      </div>
      {nameError && <p class="text-error text-sm mt-1">{nameError}</p>}
      {contactError
        ? <p class="text-error text-sm mt-1">{contactError}</p>
        : <p class="text-sm opacity-60 mt-1">{t("apply.youth.error.guardianContactRequired")}</p>}
    </div>
  );
}

// ── Pages ────────────────────────────────────────────────────────────────────────

function MembershipPage({ values, errors }: { values: ApplicantValues; errors: Record<string, string> }) {
  return (
    <Layout title={t("apply.title")}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("apply.title")} subtitle={t("common.requiredLegend")} />
        <form method="post" action="/apply" class="space-y-4">
          <Honeypot />
          <ApplicantFormFields values={values} errors={errors} />
          <PrivacyNotice />
          <button type="submit" class="btn btn-primary">{t("apply.form.submit")}</button>
        </form>
        <ContactFooter />
      </div>
    </Layout>
  );
}

function YouthPage({
  values, errors, guardianRows, guardianErrors, consentError,
}: {
  values: ApplicantValues;
  errors: Record<string, string>;
  guardianRows: GuardianValues[];
  guardianErrors: GuardianRowError[];
  consentError?: string;
}) {
  const rows = guardianRows.length > 0 ? guardianRows : [{ firstName: "", lastName: "", email: "", phone: "" }];
  return (
    <Layout title={t("apply.youth.title")}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("apply.youth.title")} subtitle={t("common.requiredLegend")} />
        <form method="post" action="/apply/youth" class="space-y-4">
          <Honeypot />
          <ApplicantFormFields values={values} errors={errors} />
          <div class="divider">{t("applications.detail.guardians")}</div>
          <div id="guardian-rows">
            {rows.map((g, i) => (
              <GuardianRow key={i} index={i} values={g} error={guardianErrors[i]} />
            ))}
          </div>
          <button type="button" id="add-guardian" class="btn btn-ghost">{t("apply.youth.guardian.add")}</button>
          <template id="guardian-template">
            <GuardianRow index={-1} />
          </template>
          <div class="flex flex-col">
            <label class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
              <input type="checkbox" name="consent" class="checkbox" />
              <span class="text-sm">{t("apply.youth.consent")}</span>
            </label>
            {consentError && <span class="text-error text-sm">{consentError}</span>}
          </div>
          <PrivacyNotice />
          <button type="submit" class="btn btn-primary">{t("apply.form.submit")}</button>
        </form>
        <ContactFooter />
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var count = ${rows.length};
          document.getElementById('add-guardian').addEventListener('click', function() {
            var html = document.getElementById('guardian-template').innerHTML.replaceAll('__N__', String(count + 1));
            document.getElementById('guardian-rows').insertAdjacentHTML('beforeend', html);
            count++;
          });
        })();
      ` }} />
    </Layout>
  );
}

function InactivePage() {
  return (
    <Layout title={t("apply.inactive.title")}>
      <div class="max-w-xl mx-auto text-center py-12">
        <PageHeader title={t("apply.inactive.title")} />
        <p class="opacity-70">{t("apply.inactive.body")}</p>
      </div>
    </Layout>
  );
}

function SuccessPage() {
  return (
    <Layout title={t("apply.success.title")}>
      <div class="max-w-xl mx-auto text-center py-12">
        <PageHeader title={t("apply.success.title")} />
        <p class="opacity-70">{t("apply.success.body")}</p>
      </div>
    </Layout>
  );
}

// ── Shared submit handling ──────────────────────────────────────────────────────

async function notifySubmission(name: string) {
  const config = await loadOrgConfig();
  const to = notificationRecipient(config);
  if (!to) return;
  await sendMail(
    to,
    t("applications.mail.submitNotifySubject", { name }),
    `Neuer Antrag von ${name} ist eingegangen und wartet auf Prüfung.`,
    { "X-On-Duty-Type": "membership-application" },
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────────

applyRoutes.get("/", async (c) => {
  if (!(await isApplicationFormActive("membership"))) return c.html(<InactivePage />);
  const empty: ApplicantValues = { lastName: "", firstName: "", birthDate: "", street: "", houseNumber: "", zip: "", city: "", email: "", phone: "", message: "" };
  return c.html(<MembershipPage values={empty} errors={{}} />);
});

applyRoutes.post("/", async (c) => {
  if (!(await isApplicationFormActive("membership"))) return c.html(<InactivePage />);
  const ip = clientIp(c);
  if (!checkRateLimit(ip).allowed) {
    const { values } = parseApplicantFields(await c.req.parseBody());
    return c.html(<MembershipPage values={values} errors={{ _global: t("apply.error.rateLimited") }} />, HTTP_STATUS.TOO_MANY_REQUESTS);
  }
  recordFailedAttempt(ip);

  const body = await c.req.parseBody();
  if (String(body.website ?? "").trim()) return c.redirect("/apply/success");

  const { values, errors } = parseApplicantFields(body);
  if (Object.keys(errors).length > 0) {
    return c.html(<MembershipPage values={values} errors={errors} />, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  }

  await db.transaction(async (tx) => {
    const [person] = await tx.insert(persons).values({
      lastName: values.lastName, firstName: values.firstName, birthDate: values.birthDate,
      street: values.street, houseNumber: values.houseNumber, zip: values.zip, city: values.city,
      email: values.email || null, phone: values.phone || null,
    }).returning();
    await tx.insert(applications).values({ personId: person.id, type: "membership", message: values.message || null });
  });

  await notifySubmission(`${values.firstName} ${values.lastName}`);
  return c.redirect("/apply/success");
});

applyRoutes.get("/youth", async (c) => {
  if (!(await isApplicationFormActive("youth"))) return c.html(<InactivePage />);
  const empty: ApplicantValues = { lastName: "", firstName: "", birthDate: "", street: "", houseNumber: "", zip: "", city: "", email: "", phone: "", message: "" };
  return c.html(<YouthPage values={empty} errors={{}} guardianRows={[]} guardianErrors={[]} />);
});

applyRoutes.post("/youth", async (c) => {
  if (!(await isApplicationFormActive("youth"))) return c.html(<InactivePage />);
  const ip = clientIp(c);
  if (!checkRateLimit(ip).allowed) {
    const body = await c.req.parseBody({ all: true });
    const { values } = parseApplicantFields(body);
    const { rows, rowErrors } = parseGuardianRows(body);
    return c.html(<YouthPage values={values} errors={{ _global: t("apply.error.rateLimited") }} guardianRows={rows} guardianErrors={rowErrors} />, HTTP_STATUS.TOO_MANY_REQUESTS);
  }
  recordFailedAttempt(ip);

  const body = await c.req.parseBody({ all: true });
  if (String(body.website ?? "").trim()) return c.redirect("/apply/success");

  const { values, errors } = parseApplicantFields(body);
  const { rows, rowErrors, hasGuardianError } = parseGuardianRows(body);
  const consentGiven = body.consent === "on";
  if (rows.length === 0) errors._guardians = t("common.required");
  if (!consentGiven) errors._consent = t("apply.youth.error.consentRequired");

  if (Object.keys(errors).length > 0 || hasGuardianError) {
    return c.html(
      <YouthPage values={values} errors={errors} guardianRows={rows} guardianErrors={rowErrors} consentError={errors._consent} />,
      422,
    );
  }

  await db.transaction(async (tx) => {
    const [person] = await tx.insert(persons).values({
      lastName: values.lastName, firstName: values.firstName, birthDate: values.birthDate,
      street: values.street, houseNumber: values.houseNumber, zip: values.zip, city: values.city,
      email: values.email || null, phone: values.phone || null,
    }).returning();
    const [application] = await tx.insert(applications).values({ personId: person.id, type: "youth", message: values.message || null }).returning();
    for (const g of rows) {
      const [guardianPerson] = await tx.insert(persons).values({
        lastName: g.lastName, firstName: g.firstName, email: g.email || null, phone: g.phone || null,
      }).returning();
      await tx.insert(applicationGuardians).values({ applicationId: application.id, personId: guardianPerson.id, consentGiven: true });
    }
  });

  await notifySubmission(`${values.firstName} ${values.lastName}`);
  return c.redirect("/apply/success");
});

applyRoutes.get("/success", (c) => c.html(<SuccessPage />));
