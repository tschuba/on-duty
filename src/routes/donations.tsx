import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { toCurrency } from "n2words/de-DE";
import { db } from "../db/index.js";
import { persons, donors, donations, users } from "../db/schema/index.js";
import { Section } from "../components/section.js";
import { Icon } from "../components/icon.js";
import type { IconName } from "../components/icons.generated.js";
import { ActionContent, DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { loadOrgConfig, isOrgConfigCompleteForReceipts, missingReceiptFields, canReadOrgTab, ORG_TABS, type OrgTab } from "../lib/org-config.js";
import { MemberMark, MemberLink } from "../components/member-mark.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { parseRange, rangePresets, todayStr } from "../lib/quick-range.js";
import { buildListUrl } from "../lib/list-query.js";
import { nextReceiptStatus, recipientName, type ReceiptAction } from "../lib/donations.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { DonorPickerFields, duplicatePersonError, getOrCreateDonor, parseDonorPersonFields } from "./donors.js";

// Names the missing fields and links only to org tabs the viewer may read.
function OrgIncompleteAlert({ config, perms }: { config: Record<string, string>; perms: Set<string> }) {
  const missing = missingReceiptFields(config);
  const tabs = (["master", "tax"] as OrgTab[]).filter((tab) => missing[tab].length > 0);
  const linkable = tabs.filter((tab) => canReadOrgTab(perms, tab));
  return (
    <div class="alert alert-warning mb-4">
      <div>
        <h3 class="font-bold">{t("donations.receipt.blockedTitle")}</h3>
        <p>{t("donations.receipt.blockedBody")}</p>
        <p>{t("donations.receipt.blockedMissing")} {tabs.flatMap((tab) => missing[tab]).map((k) => t(`admin.orgConfig.field.${k}` as never)).join(", ")}</p>
        {linkable.length === 0
          ? <p>{t("donations.receipt.blockedContactAdmin")}</p>
          : linkable.map((tab) => <a href={`/organisation#${ORG_TABS[tab].path}`} class="link mr-4">{t(`organisation.tabs.${tab}` as never)} →</a>)}
      </div>
    </div>
  );
}

// Status changes only here (detail area); offers only transitions valid from the current status.
function ReceiptStatusButtons({ d }: { d: DonationRow }) {
  const actions: { action: ReceiptAction; icon: IconName; label: string; hint: string; confirm?: string }[] = [
    { action: "markNotRequired", icon: "no-symbol", label: t("donations.receiptStatus.markNotRequired"), hint: t("donations.receiptStatus.markNotRequiredHint") },
    { action: "reopen", icon: "arrow-uturn-left", label: t("donations.receiptStatus.reopen"), hint: t("donations.receiptStatus.reopenHint") },
    { action: "revoke", icon: "x-mark", label: t("donations.receiptStatus.revoke"), hint: t("donations.receiptStatus.revokeHint"), confirm: t("donations.receiptStatus.revokeConfirm") },
  ];
  return (
    <>
      {actions.filter((a) => nextReceiptStatus(d.receiptStatus, a.action)).map((a) => (
        <form method="post" action={`/donations/${d.id}/receipt-status`} onsubmit={a.confirm ? `return confirm(${JSON.stringify(a.confirm)})` : undefined}>
          <input type="hidden" name="action" value={a.action} />
          <button type="submit" class="btn btn-outline btn-sm" title={a.hint} aria-label={a.label}><ActionContent icon={a.icon} label={a.label} /></button>
        </form>
      ))}
    </>
  );
}

// Standalone variant with its own label (edit page; detail page when no section is shown).
function ReceiptStatusActions({ d, canIssue }: { d: DonationRow; canIssue: boolean }) {
  if (!canIssue || !(["markNotRequired", "reopen", "revoke"] as ReceiptAction[]).some((a) => nextReceiptStatus(d.receiptStatus, a))) return null;
  return (
    <div class="flex flex-wrap items-center gap-2 max-w-xl mb-4">
      <span class="font-semibold">{t("donations.receiptStatus.heading")}:</span>
      <ReceiptStatusButtons d={d} />
    </div>
  );
}

export const donationRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type DonorRow = typeof donors.$inferSelect;
type DonationRow = typeof donations.$inferSelect;
type Issuer = typeof users.$inferSelect;
type DonationWithDonor = DonationRow & { donor: DonorRow & { person: Person & { member: { id: string } | null } }; issuer: Issuer | null };

type DonationType = "cash" | "transfer";

// ── Helpers ──────────────────────────────────────────────────────────────────
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

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue" };

function receiptFilename(d: DonationWithDonor): string {
  const slug = (s: string) =>
    s
      .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTS[c])
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
  const p = d.donor.person;
  const who = p.companyName ? slug(p.companyName) : `${slug(p.lastName)}_${slug(p.firstName)}`;
  return `Zuwendungsbestaetigung_${who}_${d.date}_${d.id.slice(0, 8)}.xml`;
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
  const name = [recipientName(p), `${p.street} ${p.houseNumber}`, `${p.zip} ${p.city}`].join("\n");
  const wert = Number(d.amount).toFixed(2).replace(".", ",");
  const amountWords = toCurrency(Number(d.amount));
  const wert2 = amountWords.charAt(0).toUpperCase() + amountWords.slice(1);
  const datum = `${formatDate(d.date)} 00:00:00`;
  const datum2 = `${formatDate(config.taxExemptionDate)} 00:00:00`;
  const ortDatum = `${config.orgCity}, ${formatDateObj(d.receiptIssuedAt ?? new Date())}`;
  const zeitraum =
    config.taxAssessmentPeriodFrom === config.taxAssessmentPeriodTo
      ? config.taxAssessmentPeriodFrom
      : `${config.taxAssessmentPeriodFrom} bis ${config.taxAssessmentPeriodTo}`;

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
    xmlEl("zeitraum", zeitraum),
    xmlEl("k4", "false"),
    xmlEl("k5", "true"),
    xmlEl("ort_datum", ortDatum),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<xml-data xmlns="http://www.lucom.com/ffw/xml-data-1.0.xsd">\n  <form>catalog://Steuerformulare/gemein/034122</form>\n  <instance>\n    <datarow>\n${elements}\n    </datarow>\n  </instance>\n</xml-data>\n`;
}

const TYPE_LABELS: Record<DonationType, string> = {
  cash: t("donations.form.typeCash"),
  transfer: t("donations.form.typeTransfer"),
};
const typeLabel = (ty: DonationType | null) => (ty ? TYPE_LABELS[ty] : "–");

async function fetchDonations(): Promise<DonationWithDonor[]> {
  return db.query.donations.findMany({ with: { donor: { with: { person: { with: { member: true } } } }, issuer: true } }) as Promise<DonationWithDonor[]>;
}

async function fetchDonation(id: string): Promise<DonationWithDonor | undefined> {
  return db.query.donations.findFirst({ where: eq(donations.id, id), with: { donor: { with: { person: { with: { member: true } } } }, issuer: true } }) as Promise<DonationWithDonor | undefined>;
}

type DonationFieldValues = { amount: string; date: string; type: string; purpose: string };

function parseDonationFields(body: Record<string, any>): { values: DonationFieldValues; errors: Record<string, string> } {
  const values: DonationFieldValues = {
    amount: trimmed(body, "amount"),
    date: trimmed(body, "date"),
    type: trimmed(body, "type"),
    purpose: trimmed(body, "purpose"),
  };
  const errors: Record<string, string> = {};
  const amountNum = Number(values.amount.replace(",", "."));
  if (!values.amount || !Number.isFinite(amountNum) || amountNum <= 0) errors.amount = t("common.required");
  if (!values.date) errors.date = t("common.required");
  if (values.type && values.type !== "cash" && values.type !== "transfer") errors.type = t("common.required");
  return { values, errors };
}

function DonationFormFields({ values, errors, showTodayButton }: { values?: Partial<DonationFieldValues>; errors?: Record<string, string>; showTodayButton?: boolean }) {
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("donations.form.amount")} required>
          <input
            type="text"
            inputmode="decimal"
            name="amount"
            value={values?.amount ?? ""}
            class={`input w-full${errors?.amount ? " input-error" : ""}`} placeholder={t("donations.form.amount")}
          />
          {errors?.amount && <span class="text-error text-sm mt-1">{errors.amount}</span>}
        </Field>
        <Field label={t("donations.form.date")} required>
          <div class="join w-full">
            <input
              type="date"
              name="date"
              value={values?.date ?? ""}
              class={`input join-item w-full${errors?.date ? " input-error" : ""}`}
            />
            {showTodayButton && (
              <button
                type="button"
                class="btn btn-outline join-item"
                onclick="const d=new Date();this.previousElementSibling.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')"
              >
                {t("common.today")}
              </button>
            )}
          </div>
          {errors?.date && <span class="text-error text-sm mt-1">{errors.date}</span>}
        </Field>
      </div>
      <Field label={t("donations.form.type")} floating={false}>
        <div class={`join w-full${errors?.type ? " border border-error rounded-lg" : ""}`}>
          <label class="join-item btn flex-1 has-[:checked]:btn-primary">
            <input type="radio" name="type" value="" checked={!values?.type} class="hidden" />
            {t("donations.form.typeNone")}
          </label>
          <label class="join-item btn flex-1 has-[:checked]:btn-primary">
            <input type="radio" name="type" value="cash" checked={values?.type === "cash"} class="hidden" />
            {t("donations.form.typeCash")}
          </label>
          <label class="join-item btn flex-1 has-[:checked]:btn-primary">
            <input type="radio" name="type" value="transfer" checked={values?.type === "transfer"} class="hidden" />
            {t("donations.form.typeTransfer")}
          </label>
        </div>
        {errors?.type && <span class="text-error text-sm mt-1">{errors.type}</span>}
      </Field>
      <Field label={t("donations.form.purpose")}>
        <input type="text" name="purpose" value={values?.purpose ?? ""} class="input w-full" placeholder={t("donations.form.purpose")} />
      </Field>
    </>
  );
}

// Receipt preview + XML button for the donation detail page (open/issued only).
function ReceiptSection({ d, config, perms }: { d: NonNullable<Awaited<ReturnType<typeof fetchDonation>>>; config: Record<string, string>; perms: Set<string> }) {
  const orgComplete = isOrgConfigCompleteForReceipts(config);
  const missingOrg = new Set(Object.values(missingReceiptFields(config)).flat());
  const p = d.donor.person;
  const addressMissing = !p.street || !p.houseNumber || !p.zip || !p.city;

  const row = (label: string, value: string | null | undefined, missing = false) => (
    <tr>
      <th class="font-semibold w-48">{label}</th>
      <td class={missing || !value ? "text-error" : ""}>{value || t("donations.receipt.missing")}</td>
    </tr>
  );

  const issued = d.receiptStatus === "issued";
  const mainLabel = t(issued ? "donations.receipt.download" : "donations.receipt.generate");

  return (
    <Section title={t("donations.receipt.title")} collapsible={false} actions={
      <div class="flex flex-wrap justify-end gap-2">
        <ReceiptStatusButtons d={d} />
        <form method="post" action={`/donations/${d.id}/mark-issued`}>
          <button type="submit" class="btn btn-primary btn-sm" disabled={!orgComplete} title={t(issued ? "donations.receipt.downloadHint" : "donations.receipt.generateHint")} aria-label={mainLabel}>
            <ActionContent icon="arrow-down-tray" label={mainLabel} variant="primary" />
          </button>
        </form>
      </div>
    }>

      {!orgComplete && <OrgIncompleteAlert config={config} perms={perms} />}

      {d.receiptStatus === "issued" && d.receiptIssuedAt && (
        <div class="alert alert-info max-w-2xl mb-4">
          <span>
            {t("donations.warn.receiptIssued")}{" "}
            {t("donations.receipt.issuedBy", { name: d.issuer?.name ?? t("donations.receipt.issuedByUnknown"), date: formatDateObj(d.receiptIssuedAt) })}
          </span>
        </div>
      )}

      {addressMissing && (
        <div class="alert alert-error max-w-2xl mb-4">
          <span>{t("donations.receipt.addressMissing")} <a href={`/donors/${d.donorId}/edit`} class="link">{t("donations.receipt.addressMissingLink")}</a></span>
        </div>
      )}

      <h2 class="font-semibold mb-2">{t("donations.receipt.previewTitle")}</h2>
      <table class="table max-w-2xl mb-4">
        <tbody>
          {row(t("donations.receipt.previewRecipient"), recipientName(p))}
          {row(t("donations.receipt.previewAddress"), addressMissing ? null : `${p.street} ${p.houseNumber}, ${p.zip} ${p.city}`)}
          {row(t("donations.receipt.summaryAmount"), formatAmount(d.amount))}
          {row(t("donations.receipt.summaryDate"), formatDate(d.date))}
          {row(t("donations.receipt.previewType"), typeLabel(d.type))}
          {row(t("donations.receipt.previewPurpose"), d.purpose ?? "—")}
          {row(t("donations.receipt.previewTaxOffice"), config.taxOffice, missingOrg.has("taxOffice"))}
          {row(t("donations.receipt.previewTaxNumber"), config.taxExemptionNumber, missingOrg.has("taxExemptionNumber"))}
          {row(t("donations.receipt.previewTaxDate"), config.taxExemptionDate ? formatDate(config.taxExemptionDate) : "", missingOrg.has("taxExemptionDate"))}
        </tbody>
      </table>

      <p class="text-sm opacity-80 mb-2 max-w-2xl">{t("donations.receipt.explanation")}</p>
      <a href="https://www.formulare-bfinv.de/ffw/action/invoke.do?id=034122" target="_blank" rel="noopener" class="link text-sm">{t("donations.receipt.officialFormLink")}</a>
    </Section>
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /donations — list with donor-name search and date range (filtered in JS,
// same reasoning as members.tsx: the full set is small and already needs to be
// loaded for the filter to run over joined donor/person fields).
donationRoutes.get("/", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const search = q.search ?? "";
  const range = parseRange({ ...q, start: q.from, end: q.to }, todayStr(), "past", { start: "", end: "" });
  const { start: from, end: to } = range;

  const all = await fetchDonations();
  const needle = search.toLowerCase();
  const filtered = all.filter((d) => {
    if (search && !`${d.donor.person.companyName ?? ""} ${d.donor.person.firstName} ${d.donor.person.lastName}`.toLowerCase().includes(needle)) return false;
    if (from && d.date < from) return false;
    if (to && d.date > to) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const presets = rangePresets(todayStr(), "past");
  const canLink = user.permissions.has("members:read");
  const canRecord = user.permissions.has("donations:record");

  return c.html(
    <Layout title={t("donations.title")} user={user}>
      <PageHeader title={t("donations.title")} actions={canRecord && <HeaderAction variant="primary" icon="plus" label={t("donations.newDonation")} href="/donations/new" class="btn-primary" />} />

      <form method="get" class="filter-bar flex flex-wrap gap-3 mb-4 items-end">
        <div class="flex flex-col w-full md:w-auto">
          <label class="input flex items-center gap-2 w-full md:w-64"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="search" name="search" placeholder={t("common.searchPlaceholder")} value={search} class="grow min-w-0" /></label>
        </div>
        <QuickRangeFilter presets={presets} range={range} dir="past" action="/donations" names={{ start: "from", end: "to" }} bare
          href={(p) => buildListUrl("/donations", { search }, p)} />
      </form>

      <ClickToEditHint />
      <div class="overflow-x-auto">
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th>{t("donations.table.date")}</th>
            <th>{t("donations.table.donor")}</th>
            <th class="text-right">{t("donations.table.amount")}</th>
            <th>{t("donations.table.type")}</th>
            <th>{t("donations.table.purpose")}</th>
            <th>{t("donations.table.receipt")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colspan={6} class="text-center opacity-50 py-8">{t("donations.table.empty")}</td></tr>
          ) : sorted.map((d) => (
            <tr key={d.id} class="cursor-pointer hover" onclick={`window.location='/donations/${d.id}'`}>
              <td>{formatDate(d.date)}</td>
              <td><MemberLink memberId={d.donor.person.member?.id} canLink={canLink}>{recipientName(d.donor.person)}</MemberLink><MemberMark memberId={d.donor.person.member?.id} canLink={canLink} /></td>
              <td class="text-right whitespace-nowrap">{formatAmount(d.amount)}</td>
              <td>{typeLabel(d.type)}</td>
              <td>{d.purpose ?? "—"}</td>
              <td>
                {d.receiptStatus === "issued"
                  ? <span class="badge badge-success badge-sm">{t("donations.table.receiptIssued")}</span>
                  : d.receiptStatus === "not_required"
                    ? <span class="badge badge-ghost badge-sm">{t("donations.table.receiptNotRequired")}</span>
                    : <span class="badge badge-warning badge-sm">{t("donations.table.receiptOpen")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Layout>
  );
});

// GET /donations/new
donationRoutes.get("/new", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("donations.newDonation")} user={user}>
      <PageHeader title={t("donations.newDonation")} backHref="/donations" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donation-form" />} />
      <form id="donation-form" method="post" action="/donations" class="space-y-4 max-w-xl">
        <DonorPickerFields />
        <div class="divider" />
        <DonationFormFields showTodayButton />
      </form>
    </Layout>
  );
});

// POST /donations — creates the person (if new) / gets-or-creates the donor, then the donation
donationRoutes.post("/", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const personId = trimmed(body, "personId") || undefined;
  const donorFields = parseDonorPersonFields(body);
  const donationFields = parseDonationFields(body);
  const dup = await duplicatePersonError(body, donorFields.values);
  const errors: Record<string, string> = { ...donorFields.errors, ...donationFields.errors, ...(dup ? { duplicate: dup } : {}) };

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donations.newDonation")} user={user}>
        <PageHeader title={t("donations.newDonation")} backHref="/donations" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donation-form" />} />
        <form id="donation-form" method="post" action="/donations" class="space-y-4 max-w-xl">
          <DonorPickerFields personId={personId} values={donorFields.values} errors={errors} />
          <div class="divider" />
          <DonationFormFields values={donationFields.values} errors={errors} showTodayButton />
        </form>
      </Layout>,
      422
    );
  }

  const newId = await db.transaction(async (tx) => {
    let pid = personId;
    if (pid) {
      await tx.update(persons).set(donorFields.values).where(eq(persons.id, pid));
    } else {
      const [person] = await tx.insert(persons).values(donorFields.values).returning();
      pid = person.id;
    }
    const donor = await getOrCreateDonor(tx as unknown as typeof db, pid);
    const [row] = await tx.insert(donations).values({
      donorId: donor.id,
      amount: donationFields.values.amount.replace(",", "."),
      date: donationFields.values.date,
      type: (donationFields.values.type || null) as DonationType | null,
      purpose: donationFields.values.purpose || null,
    }).returning({ id: donations.id });
    return row.id;
  });

  setFlash(c, t("donations.flash.created"), "success");
  return c.redirect(`/donations/${newId}`);
});

const canDelete = (user: { permissions: Set<string> }, d: { receiptStatus: string }) =>
  user.permissions.has("donations:delete") && d.receiptStatus !== "issued";

// GET /donations/:id — read-only; everyone who can see the list
donationRoutes.get("/:id", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const d = await fetchDonation(c.req.param("id"));
  if (!d) return c.notFound();
  const canLink = user.permissions.has("members:read");
  const canRecord = user.permissions.has("donations:record");
  const canIssue = user.permissions.has("donations:issue-receipts");
  const showReceipt = canIssue && d.receiptStatus !== "not_required";
  const config = showReceipt ? await loadOrgConfig() : {};

  return c.html(
    <Layout title={t("donations.title")} user={user}>
      <PageHeader title={<><MemberLink memberId={d.donor.person.member?.id} canLink={canLink}>{recipientName(d.donor.person)}</MemberLink><MemberMark memberId={d.donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donations" actions={<DetailActions editHref={canRecord ? `/donations/${d.id}/edit` : undefined} remove={canDelete(user, d) && <form id="donation-delete-form" method="post" action={`/donations/${d.id}/delete`} onsubmit={`return confirm(\'${t("donations.confirmDelete")}\')`}><HeaderAction icon="trash" label={t("common.delete")} form="donation-delete-form" class="btn-outline btn-error" /></form>} />} />
      {d.receiptStatus === "issued" && !canIssue && <div class="alert alert-info max-w-xl mb-4">{t("donations.warn.receiptIssued")}</div>}
      {!showReceipt && <ReceiptStatusActions d={d} canIssue={canIssue} />}
      <ViewGrid>
        <ViewField label={t("donations.form.amount")} value={`${d.amount} €`} />
        <ViewField label={t("donations.form.date")} value={formatDate(d.date)} />
        <ViewField label={t("donations.form.type")} value={typeLabel(d.type)} />
        <ViewField label={t("donations.form.purpose")} value={d.purpose} />
      </ViewGrid>
      {showReceipt && c.req.query("download") === "1" && <iframe src={`/donations/${d.id}/receipt.xml`} class="hidden" title={t("donations.receipt.title")} />}
      {showReceipt && <ReceiptSection d={d} config={config} perms={user.permissions} />}
    </Layout>
  );
});

// GET/POST /donations/:id/edit — donation fields only, donor is fixed once recorded
donationRoutes.get("/:id/edit", requireAuth(["donations:read", "donations:record", "donations:issue-receipts"]), async (c) => {
  const user = c.get("user");
  const d = await fetchDonation(c.req.param("id"));
  if (!d) return c.notFound();
  if (!user.permissions.has("donations:record")) return c.redirect(`/donations/${d.id}`);
  const canLink = user.permissions.has("members:read");

  return c.html(
    <Layout title={t("donations.title")} user={user}>
      <PageHeader title={<><MemberLink memberId={d.donor.person.member?.id} canLink={canLink}>{recipientName(d.donor.person)}</MemberLink><MemberMark memberId={d.donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donations" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donation-edit-form" cancelHref={`/donations/${d.id}`} />} />
      {d.receiptStatus === "issued" && <div class="alert alert-info max-w-xl mb-4">{t("donations.warn.receiptIssued")}</div>}
      <ReceiptStatusActions d={d} canIssue={user.permissions.has("donations:issue-receipts")} />
      <form id="donation-edit-form" method="post" action={`/donations/${d.id}/edit`} class="space-y-4 max-w-xl">
        <DonationFormFields values={{ amount: d.amount, date: d.date, type: d.type ?? "", purpose: d.purpose ?? "" }} />
      </form>
    </Layout>
  );
});

donationRoutes.post("/:id/edit", requireAuth("donations:record"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const d = await fetchDonation(id);
  if (!d) return c.notFound();
  const canLink = user.permissions.has("members:read");

  const body = await c.req.parseBody();
  const { values, errors } = parseDonationFields(body);

  if (Object.keys(errors).length > 0) {
    return c.html(
      <Layout title={t("donations.title")} user={user}>
        <PageHeader title={<><MemberLink memberId={d.donor.person.member?.id} canLink={canLink}>{recipientName(d.donor.person)}</MemberLink><MemberMark memberId={d.donor.person.member?.id} canLink={canLink} class="w-6 h-6" /></>} backHref="/donations" subtitle={t("common.requiredLegend")} actions={<FormActions formId="donation-edit-form" cancelHref={`/donations/${d.id}`} />} />
        <form id="donation-edit-form" method="post" action={`/donations/${d.id}/edit`} class="space-y-4 max-w-xl">
          <DonationFormFields values={values} errors={errors} />
        </form>
      </Layout>,
      422
    );
  }

  await db.update(donations).set({
    amount: values.amount.replace(",", "."),
    date: values.date,
    type: (values.type || null) as DonationType | null,
    purpose: values.purpose || null,
  }).where(eq(donations.id, id));

  setFlash(c, t("donations.flash.saved"), "success");
  return c.redirect(`/donations/${id}`);
});

// POST /donations/:id/delete
donationRoutes.post("/:id/delete", requireAuth("donations:delete"), async (c) => {
  const id = c.req.param("id");
  const d = await fetchDonation(id);
  if (!d) return c.notFound();
  // Issued receipts are tax documents: the donation must stay.
  if (d.receiptStatus === "issued") {
    setFlash(c, t("donations.flash.deleteBlocked"), "error");
    return c.redirect(`/donations/${id}`);
  }
  await db.delete(donations).where(eq(donations.id, id));
  setFlash(c, t("donations.flash.deleted"), "success");
  return c.redirect("/donations");
});

// GET /donations/:id/receipt.xml — the FFW-schema XML file itself, downloadable
// standalone (e.g. to re-download after mark-issued already ran once)
donationRoutes.get("/:id/receipt.xml", requireAuth("donations:issue-receipts"), async (c) => {
  const d = await fetchDonation(c.req.param("id"));
  if (!d) return c.notFound();

  const config = await loadOrgConfig();
  if (!isOrgConfigCompleteForReceipts(config)) return c.notFound();

  const xml = buildReceiptXml(d, config);
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${receiptFilename(d)}"`);
  return c.body(xml);
});

// POST /donations/:id/mark-issued — allowed from open and not_required; a second issue
// of an already issued receipt is rejected (receiptIssuedAt/issuedBy stay untouched).
// The XML stays downloadable via /receipt.xml.
donationRoutes.post("/:id/mark-issued", requireAuth("donations:issue-receipts"), async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const d = await fetchDonation(id);
  if (!d) return c.notFound();
  // Same guard as receipt.xml: without complete org data no file can be produced, so don't mark as issued.
  if (!isOrgConfigCompleteForReceipts(await loadOrgConfig())) return c.redirect(`/donations/${id}`);
  if (nextReceiptStatus(d.receiptStatus, "issue")) {
    await db.update(donations).set({ receiptStatus: "issued", receiptIssuedAt: new Date(), issuedBy: user.id }).where(eq(donations.id, id));
  }
  // Page reloads with the new status and starts the download itself (an attachment response would leave the old page standing).
  return c.redirect(`/donations/${id}?download=1`);
});

// POST /donations/:id/receipt-status — markNotRequired / reopen / revoke (invalid transitions rejected)
donationRoutes.post("/:id/receipt-status", requireAuth("donations:issue-receipts"), async (c) => {
  const id = c.req.param("id");
  const d = await fetchDonation(id);
  if (!d) return c.notFound();
  const body = await c.req.parseBody();
  const action = trimmed(body, "action") as ReceiptAction;
  const next = nextReceiptStatus(d.receiptStatus, action);
  if (!next) {
    setFlash(c, t("donations.flash.statusInvalid"), "error");
    return c.redirect(`/donations/${id}`);
  }
  await db.update(donations).set(next === "open" ? { receiptStatus: next, receiptIssuedAt: null, issuedBy: null } : { receiptStatus: next }).where(eq(donations.id, id));
  setFlash(c, t("donations.flash.statusChanged"), "success");
  return c.redirect(`/donations/${id}`);
});
