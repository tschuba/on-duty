import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { toCurrency } from "n2words/de-DE";
import { db } from "../db/index.js";
import { persons, donors, donations } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { loadOrgConfig, isOrgConfigCompleteForReceipts } from "../lib/org-config.js";
import { DonorPickerFields, getOrCreateDonor, parseDonorPersonFields } from "./donors.js";

export const donationRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type DonorRow = typeof donors.$inferSelect;
type DonationRow = typeof donations.$inferSelect;
type DonationWithDonor = DonationRow & { donor: DonorRow & { person: Person } };

type DonationType = "cash" | "transfer";

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFlash(c: any, message: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message, type }), { path: "/", maxAge: 10, httpOnly: false });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function formatAmount(amount: string | number): string {
  return `${Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;
}

// Local date components, not toISOString() — avoids the timezone-shift bug
// already fixed once in lib/status.ts's age() helper.
function formatDateObj(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlEl(id: string, value: string): string {
  return `      <element id="${id}">${xmlEscape(value)}</element>`;
}

// Builds the FFW xml-data import file for the official Muster 034122 form
// (https://www.formulare-bfinv.de). Field IDs and the k1-k5/Finanzamt-block
// meaning were reverse-engineered against the live FMS, see the backlog doc's
// "Nachtrag 2026-09-29 (Fortsetzung)" section. Always uses the Freistellungsbescheid
// branch (k3) — the alternative §60a-AO branch (k4) is unused, org-config only
// models the Freistellungsbescheid fields.
function buildReceiptXml(d: DonationWithDonor, config: Record<string, string>): string {
  const aussteller = [config.orgName, `${config.orgStreet} ${config.orgHouseNumber}`, `${config.orgZip} ${config.orgCity}`].join("\n");
  const p = d.donor.person;
  const name = [`${p.firstName} ${p.lastName}`, `${p.street} ${p.houseNumber}`, `${p.zip} ${p.city}`].join("\n");
  const wert = Number(d.amount).toFixed(2).replace(".", ",");
  const amountWords = toCurrency(Number(d.amount));
  const wert2 = amountWords.charAt(0).toUpperCase() + amountWords.slice(1);
  const datum = `${formatDate(d.date)} 00:00:00`;
  const datum2 = `${formatDate(config.taxExemptionDate)} 00:00:00`;
  const ortDatum = `${config.orgCity}, ${formatDateObj(d.receiptIssuedAt ?? new Date())}`;

  const elements = [
    xmlEl("aussteller", aussteller),
    xmlEl("name", name),
    xmlEl("wert", wert),
    xmlEl("wert2", wert2),
    xmlEl("datum", datum),
    xmlEl("k1", "false"),
    xmlEl("k2", "true"),
    xmlEl("k3", "true"),
    xmlEl("zwecke2b", config.charitablePurpose),
    xmlEl("finamt", config.taxOffice),
    xmlEl("stnr", config.taxExemptionNumber),
    xmlEl("datum2", datum2),
    xmlEl("zeitraum", config.taxAssessmentPeriod),
    xmlEl("k4", "false"),
    xmlEl("zwecke", config.charitablePurpose),
    xmlEl("k5", "true"),
    xmlEl("ort_datum", ortDatum),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<xml-data xmlns="http://www.lucom.com/ffw/xml-data-1.0.xsd">\n  <form>catalog://Steuerformulare/gemein/034122</form>\n  <instance>\n    <datarow>\n${elements}\n    </datarow>\n  </instance>\n</xml-data>\n`;
}

const TYPE_LABELS: Record<DonationType, string> = {
  cash: t("donations.form.typeCash"),
  transfer: t("donations.form.typeTransfer"),
};

async function fetchDonations(): Promise<DonationWithDonor[]> {
  return db.query.donations.findMany({ with: { donor: { with: { person: true } } } }) as Promise<DonationWithDonor[]>;
}

async function fetchDonation(id: string): Promise<DonationWithDonor | undefined> {
  return db.query.donations.findFirst({ where: eq(donations.id, id), with: { donor: { with: { person: true } } } }) as Promise<DonationWithDonor | undefined>;
}

type DonationFieldValues = { amount: string; date: string; type: string; purpose: string };

function parseDonationFields(body: Record<string, any>): { values: DonationFieldValues; errors: Record<string, string> } {
  const values: DonationFieldValues = {
    amount: String(body.amount ?? "").trim(),
    date: String(body.date ?? "").trim(),
    type: String(body.type ?? "").trim(),
    purpose: String(body.purpose ?? "").trim(),
  };
  const errors: Record<string, string> = {};
  const amountNum = Number(values.amount.replace(",", "."));
  if (!values.amount || !Number.isFinite(amountNum) || amountNum <= 0) errors.amount = t("common.required");
  if (!values.date) errors.date = t("common.required");
  if (values.type !== "cash" && values.type !== "transfer") errors.type = t("common.required");
  return { values, errors };
}

function DonationFormFields({ values, errors }: { values?: Partial<DonationFieldValues>; errors?: Record<string, string> }) {
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("donations.form.amount")}<span class="text-error ml-1">*</span></span></label>
          <input
            type="text"
            inputmode="decimal"
            name="amount"
            value={values?.amount ?? ""}
            class={`input input-bordered w-full${errors?.amount ? " input-error" : ""}`}
          />
          {errors?.amount && <span class="text-error text-sm mt-1">{errors.amount}</span>}
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("donations.form.date")}<span class="text-error ml-1">*</span></span></label>
          <input
            type="date"
            name="date"
            value={values?.date ?? ""}
            class={`input input-bordered w-full${errors?.date ? " input-error" : ""}`}
          />
          {errors?.date && <span class="text-error text-sm mt-1">{errors.date}</span>}
        </div>
      </div>
      <div class="form-control">
        <label class="label"><span class="label-text">{t("donations.form.type")}<span class="text-error ml-1">*</span></span></label>
        <select name="type" class={`select select-bordered w-full${errors?.type ? " select-error" : ""}`}>
          <option value="" selected={!values?.type}>{t("donations.form.typeSelect")}</option>
          <option value="cash" selected={values?.type === "cash"}>{t("donations.form.typeCash")}</option>
          <option value="transfer" selected={values?.type === "transfer"}>{t("donations.form.typeTransfer")}</option>
        </select>
        {errors?.type && <span class="text-error text-sm mt-1">{errors.type}</span>}
      </div>
      <div class="form-control">
        <label class="label"><span class="label-text">{t("donations.form.purpose")}</span></label>
        <input type="text" name="purpose" value={values?.purpose ?? ""} class="input input-bordered w-full" />
      </div>
    </>
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /donations — list with donor-name search and date range (filtered in JS,
// same reasoning as members.tsx: the full set is small and already needs to be
// loaded for the filter to run over joined donor/person fields).
donationRoutes.get("/", requireAuth("donations:manage"), async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const search = q.search ?? "";
  const from = q.from ?? "";
  const to = q.to ?? "";

  const all = await fetchDonations();
  const needle = search.toLowerCase();
  const filtered = all.filter((d) => {
    if (search && !`${d.donor.person.firstName} ${d.donor.person.lastName}`.toLowerCase().includes(needle)) return false;
    if (from && d.date < from) return false;
    if (to && d.date > to) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  return c.html(
    <Layout title={t("donations.title")} user={user} activeNav="donations">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold" style="font-family: var(--font-heading)">{t("donations.title")}</h1>
        <a href="/donations/new" class="btn btn-primary btn-sm">{t("donations.newDonation")}</a>
      </div>

      <form method="get" class="flex flex-wrap gap-3 mb-4 items-end">
        <div class="form-control">
          <input type="search" name="search" placeholder={t("common.searchPlaceholder")} value={search} class="input input-bordered input-sm w-64" />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs">{t("donations.filter.from")}</span></label>
          <input type="date" name="from" value={from} class="input input-bordered input-sm" />
        </div>
        <div class="form-control">
          <label class="label py-0"><span class="label-text text-xs">{t("donations.filter.to")}</span></label>
          <input type="date" name="to" value={to} class="input input-bordered input-sm" />
        </div>
        <button type="submit" class="btn btn-sm">{t("common.show")}</button>
      </form>

      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("donations.table.date")}</th>
            <th>{t("donations.table.donor")}</th>
            <th class="text-right">{t("donations.table.amount")}</th>
            <th>{t("donations.table.type")}</th>
            <th>{t("donations.table.purpose")}</th>
            <th>{t("donations.table.receipt")}</th>
            <th>{t("donations.table.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colspan={7} class="text-center opacity-50 py-8">{t("donations.table.empty")}</td></tr>
          ) : sorted.map((d) => (
            <tr key={d.id}>
              <td>{formatDate(d.date)}</td>
              <td>{d.donor.person.firstName} {d.donor.person.lastName}</td>
              <td class="text-right">{formatAmount(d.amount)}</td>
              <td>{TYPE_LABELS[d.type]}</td>
              <td>{d.purpose ?? "—"}</td>
              <td>
                {d.receiptIssuedAt
                  ? <span class="badge badge-success badge-sm">{t("donations.table.receiptIssued")}</span>
                  : <span class="badge badge-ghost badge-sm">{t("donations.table.receiptOpen")}</span>}
              </td>
              <td class="whitespace-nowrap">
                <a href={`/donations/${d.id}/receipt`} class="link link-hover text-sm mr-2">{t("donations.receipt.title")}</a>
                <a href={`/donations/${d.id}/edit`} class="link link-hover text-sm">{t("common.edit")}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
});

// GET /donations/new
donationRoutes.get("/new", requireAuth("donations:manage"), async (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("donations.newDonation")} user={user} activeNav="donations">
      <div class="mb-4">
        <a href="/donations" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("donations.newDonation")}</h1>
        <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
      </div>
      <form method="post" action="/donations" class="space-y-4 max-w-xl">
        <DonorPickerFields />
        <div class="divider" />
        <DonationFormFields />
        <div class="flex gap-2 pt-4">
          <button type="submit" class="btn btn-primary">{t("common.save")}</button>
          <a href="/donations" class="btn btn-ghost">{t("common.cancel")}</a>
        </div>
      </form>
    </Layout>
  );
});

// POST /donations — creates the person (if new) / gets-or-creates the donor, then the donation
donationRoutes.post("/", requireAuth("donations:manage"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const personId = String(body.personId ?? "").trim() || undefined;
  const donorFields = parseDonorPersonFields(body);
  const donationFields = parseDonationFields(body);
  const errors = { ...donorFields.errors, ...donationFields.errors };

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donations.newDonation")} user={user} activeNav="donations">
        <div class="mb-4">
          <a href="/donations" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("donations.newDonation")}</h1>
          <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
        </div>
        <form method="post" action="/donations" class="space-y-4 max-w-xl">
          <DonorPickerFields personId={personId} values={donorFields.values} errors={errors} />
          <div class="divider" />
          <DonationFormFields values={donationFields.values} errors={errors} />
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">{t("common.save")}</button>
            <a href="/donations" class="btn btn-ghost">{t("common.cancel")}</a>
          </div>
        </form>
      </Layout>,
      422
    );
  }

  await db.transaction(async (tx) => {
    let pid = personId;
    if (pid) {
      await tx.update(persons).set(donorFields.values).where(eq(persons.id, pid));
    } else {
      const [person] = await tx.insert(persons).values(donorFields.values).returning();
      pid = person.id;
    }
    const donor = await getOrCreateDonor(tx as unknown as typeof db, pid);
    await tx.insert(donations).values({
      donorId: donor.id,
      amount: donationFields.values.amount.replace(",", "."),
      date: donationFields.values.date,
      type: donationFields.values.type as DonationType,
      purpose: donationFields.values.purpose || null,
    });
  });

  setFlash(c, t("donations.flash.created"), "success");
  return c.redirect("/donations");
});

// GET/POST /donations/:id/edit — donation fields only, donor is fixed once recorded
donationRoutes.get("/:id/edit", requireAuth("donations:manage"), async (c) => {
  const user = c.get("user");
  const d = await fetchDonation(c.req.param("id"));
  if (!d) return c.notFound();

  return c.html(
    <Layout title={t("donations.title")} user={user} activeNav="donations">
      <div class="mb-4">
        <a href="/donations" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{d.donor.person.firstName} {d.donor.person.lastName}</h1>
        <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
      </div>
      {d.receiptIssuedAt && <div class="alert alert-warning max-w-xl mb-4">{t("donations.warn.receiptIssued")}</div>}
      <form method="post" action={`/donations/${d.id}/edit`} class="space-y-4 max-w-xl">
        <DonationFormFields values={{ amount: d.amount, date: d.date, type: d.type, purpose: d.purpose ?? "" }} />
        <div class="flex gap-2 pt-4">
          <button type="submit" class="btn btn-primary">{t("common.save")}</button>
          <a href="/donations" class="btn btn-ghost">{t("common.cancel")}</a>
        </div>
      </form>
      <form method="post" action={`/donations/${d.id}/delete`} class="mt-4" onsubmit={`return confirm('${d.receiptIssuedAt ? t("donations.confirmDeleteIssued") : t("donations.confirmDelete")}')`}>
        <button type="submit" class="btn btn-outline btn-error btn-sm">{t("common.delete")}</button>
      </form>
    </Layout>
  );
});

donationRoutes.post("/:id/edit", requireAuth("donations:manage"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const d = await fetchDonation(id);
  if (!d) return c.notFound();

  const body = await c.req.parseBody();
  const { values, errors } = parseDonationFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donations.title")} user={user} activeNav="donations">
        <div class="mb-4">
          <a href="/donations" class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
          <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{d.donor.person.firstName} {d.donor.person.lastName}</h1>
          <p class="text-sm opacity-60 mt-1">{t("common.requiredLegend")}</p>
        </div>
        <form method="post" action={`/donations/${d.id}/edit`} class="space-y-4 max-w-xl">
          <DonationFormFields values={values} errors={errors} />
          <div class="flex gap-2 pt-4">
            <button type="submit" class="btn btn-primary">{t("common.save")}</button>
            <a href="/donations" class="btn btn-ghost">{t("common.cancel")}</a>
          </div>
        </form>
      </Layout>,
      422
    );
  }

  await db.update(donations).set({
    amount: values.amount.replace(",", "."),
    date: values.date,
    type: values.type as DonationType,
    purpose: values.purpose || null,
  }).where(eq(donations.id, id));

  setFlash(c, t("donations.flash.saved"), "success");
  return c.redirect("/donations");
});

// POST /donations/:id/delete
donationRoutes.post("/:id/delete", requireAuth("donations:manage"), async (c) => {
  const id = c.req.param("id");
  await db.delete(donations).where(eq(donations.id, id));
  setFlash(c, t("donations.flash.deleted"), "success");
  return c.redirect("/donations");
});

// GET /donations/:id/receipt — Einzelbestätigung, blocked if org config is incomplete
donationRoutes.get("/:id/receipt", requireAuth("donations:manage"), async (c) => {
  const user = c.get("user");
  const d = await fetchDonation(c.req.param("id"));
  if (!d) return c.notFound();

  const config = await loadOrgConfig();
  if (!isOrgConfigCompleteForReceipts(config)) {
    return c.html(
      <Layout title={t("donations.receipt.title")} user={user} activeNav="donations">
        <div class="alert alert-warning max-w-xl">
          <div>
            <h3 class="font-bold">{t("donations.receipt.blockedTitle")}</h3>
            <p>{t("donations.receipt.blockedBody")}</p>
            <a href="/admin/org-config" class="link">{t("donations.receipt.blockedLink")}</a>
          </div>
        </div>
      </Layout>
    );
  }

  return c.html(
    <Layout title={t("donations.receipt.title")} user={user} activeNav="donations">
      <div class="mb-4">
        <a href={`/donations/${d.id}/edit`} class="link link-hover text-sm opacity-70">{t("common.backToList")}</a>
        <h1 class="text-2xl font-bold mt-1" style="font-family: var(--font-heading)">{t("donations.receipt.title")}</h1>
      </div>

      {d.receiptIssuedAt && <div class="alert alert-info max-w-2xl mb-4">{t("donations.warn.receiptIssued")}</div>}

      <div class="max-w-xl border border-base-300 rounded-box p-6">
        <p class="mb-1"><span class="font-semibold">{t("donations.receipt.summaryDonor")}:</span> {d.donor.person.firstName} {d.donor.person.lastName}</p>
        <p class="mb-1"><span class="font-semibold">{t("donations.receipt.summaryAmount")}:</span> {formatAmount(d.amount)}</p>
        <p class="mb-4"><span class="font-semibold">{t("donations.receipt.summaryDate")}:</span> {formatDate(d.date)}</p>

        <p class="text-sm opacity-80 mb-4">{t("donations.receipt.explanation")}</p>
        <a href="https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034122" target="_blank" rel="noopener" class="link text-sm">{t("donations.receipt.officialFormLink")}</a>
      </div>

      <form method="post" action={`/donations/${d.id}/mark-issued`} class="mt-4">
        <button type="submit" class="btn btn-primary">{t("donations.receipt.download")}</button>
      </form>
    </Layout>
  );
});

// GET /donations/:id/receipt.xml — the FFW-schema XML file itself, downloadable
// standalone (e.g. to re-download after mark-issued already ran once)
donationRoutes.get("/:id/receipt.xml", requireAuth("donations:manage"), async (c) => {
  const d = await fetchDonation(c.req.param("id"));
  if (!d) return c.notFound();

  const config = await loadOrgConfig();
  if (!isOrgConfigCompleteForReceipts(config)) return c.notFound();

  const xml = buildReceiptXml(d, config);
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="Zuwendungsbestaetigung-${d.id}.xml"`);
  return c.body(xml);
});

// POST /donations/:id/mark-issued — set on every download click (re-issuing stays allowed)
donationRoutes.post("/:id/mark-issued", requireAuth("donations:manage"), async (c) => {
  const id = c.req.param("id");
  await db.update(donations).set({ receiptIssuedAt: new Date() }).where(eq(donations.id, id));
  return c.redirect(`/donations/${id}/receipt.xml`);
});
