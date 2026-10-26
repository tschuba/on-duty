import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { lendingItems, lendingLoans, loanRequests, persons } from "../db/schema/index.js";
import { Icon } from "../components/icon.js";
import { Layout } from "../components/layout.js";
import { PageHeader, HeaderAction } from "../components/page-header.js";
import { Field, EmailInput, PhoneInput } from "../components/field.js";
import { ContactFooter, Honeypot, PrivacyNotice, clientIp } from "../components/public-form.js";
import { t } from "../i18n/index.js";
import { checkRateLimit, recordFailedAttempt } from "../lib/ratelimit.js";
import { loadOrgConfig } from "../lib/org-config.js";
import { sendMail } from "../lib/mail.js";
import { parseRequestValues, validateRequest, type RequestValues } from "../lib/loan-request.js";
import { blockedDays, checkAvailability } from "../lib/lending.js";
import { HTTP_STATUS } from "../lib/constants.js";

export const lendRoutes = new Hono();

// ── Data access ─────────────────────────────────────────────────────────────

async function fetchRequestableItem(itemId: string) {
  const item = await db.query.lendingItems.findFirst({
    where: eq(lendingItems.id, itemId),
    with: { inventoryItem: true },
  });
  if (!item || !item.publicRequestable || item.inventoryItem.retiredAt) return undefined;
  return item;
}

// ── Pages ────────────────────────────────────────────────────────────────────

function RequestForm({ item, values, errors, maxQuantity }: {
  item: Awaited<ReturnType<typeof fetchRequestableItem>>;
  values: RequestValues;
  errors: Record<string, string>;
  maxQuantity: number;
}) {
  if (!item) return null;
  return (
    <form id="lend-form" method="post" class="space-y-4">
      <Honeypot />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("apply.form.firstName")} required>
          <input type="text" name="firstName" value={values.firstName} class={`input w-full${errors.firstName ? " input-error" : ""}`} />
        </Field>
        <Field label={t("apply.form.lastName")} required>
          <input type="text" name="lastName" value={values.lastName} class={`input w-full${errors.lastName ? " input-error" : ""}`} />
        </Field>
      </div>
      <p class="text-sm opacity-70">{t("lend.form.contactHint")}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EmailInput name="email" placeholder={t("apply.form.email")} value={values.email} error={!!errors.contact} />
        <PhoneInput name="phone" placeholder={t("apply.form.phone")} value={values.phone} error={!!errors.contact} />
      </div>
      {errors.contact && <p class="text-error text-sm">{errors.contact}</p>}
      <div id="lend-calendar" data-item-id={item.id} data-quantity={values.quantity || "1"}></div>
      <input type="hidden" id="lend-plannedFrom" name="plannedFrom" value={values.plannedFrom} />
      <input type="hidden" id="lend-plannedTo" name="plannedTo" value={values.plannedTo} />
      {errors.dates && <p class="text-error text-sm">{errors.dates}</p>}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("lend.form.plannedFromTime")} required={item.timesRequired}>
          <input type="time" name="plannedFromTime" value={values.plannedFromTime} class={`input w-full${errors.times ? " input-error" : ""}`} />
        </Field>
        <Field label={t("lend.form.plannedToTime")} required={item.timesRequired}>
          <input type="time" name="plannedToTime" value={values.plannedToTime} class={`input w-full${errors.times ? " input-error" : ""}`} />
        </Field>
      </div>
      {errors.times && <p class="text-error text-sm">{errors.times}</p>}
      <p id="lend-summary" class="text-sm font-medium" data-label={t("lend.form.summary")} hidden></p>
      {!item.individualTracking && maxQuantity > 1 && (
        <Field label={t("lending.loans.form.quantity")} class="max-w-32" required>
          <input type="number" name="quantity" min="1" max={maxQuantity} value={values.quantity || "1"} class={`input w-full${errors.quantity ? " input-error" : ""}`} />
          {errors.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </Field>
      )}
      <Field label={t("lend.form.message")} required>
        <textarea name="message" class={`textarea w-full${errors.message ? " textarea-error" : ""}`} rows={3}>{values.message}</textarea>
      </Field>
      <PrivacyNotice />
    </form>
  );
}

function RequestPage({ item, orgName, values, errors, maxQuantity }: {
  item: NonNullable<Awaited<ReturnType<typeof fetchRequestableItem>>>;
  orgName: string;
  values: RequestValues;
  errors: Record<string, string>;
  maxQuantity: number;
}) {
  return (
    <Layout title={t("lend.title", { name: item.inventoryItem.name })}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={item.inventoryItem.name} subtitle={t("lend.form.subtitle", { org: orgName })} actions={<HeaderAction variant="primary" type="submit" form="lend-form" icon="check" label={t("lend.form.submit")} class="btn-primary" />} />
        {maxQuantity > 1 && !item.individualTracking && (
          <p class="text-sm opacity-70 mb-4">{t("lend.form.maxQuantityHint", { max: maxQuantity })}</p>
        )}
        <RequestForm item={item} values={values} errors={errors} maxQuantity={maxQuantity} />
        <ContactFooter />
      </div>
      <link rel="stylesheet" href="/css/vanilla-calendar.css" />
      <style>{"#lend-calendar{--vc-date-weekend-bg-hover:var(--color-base-200);--vc-date-weekend-hover-edge-bg:var(--color-base-200);--vc-date-weekend-outside-bg:transparent;--vc-date-weekend-outside-bg-hover:var(--color-base-200);--vc-date-weekend-outside-color:color-mix(in oklab,var(--color-base-content) 35%,transparent);--vc-date-weekend-outside-color-hover:var(--color-base-content);--vc-date-range-middle-outside-bg:color-mix(in oklab,var(--color-primary) 10%,transparent);--vc-date-selected-outside-bg:var(--color-primary);--vc-bg:var(--color-base-100);--vc-color:var(--color-base-content);--vc-header-color:var(--color-base-content);--vc-week-day-color:color-mix(in oklab,var(--color-base-content) 60%,transparent);--vc-date-color:var(--color-base-content);--vc-date-color-hover:var(--color-base-content);--vc-date-hover-bg:var(--color-base-200);--vc-date-hover-edge-bg:var(--color-base-200);--vc-date-disabled-color:color-mix(in oklab,var(--color-base-content) 35%,transparent);--vc-date-today-color:var(--color-primary);--vc-date-selected-bg:var(--color-primary);--vc-date-selected-color:var(--color-primary-content);--vc-date-range-middle-bg:color-mix(in oklab,var(--color-primary) 20%,transparent);--vc-date-range-middle-color:var(--color-base-content);--vc-date-weekend-color:var(--color-base-content);--vc-date-weekend-disabled-color:color-mix(in oklab,var(--color-base-content) 35%,transparent);--vc-date-weekend-selected-bg:var(--color-primary);--vc-date-weekend-selected-color:var(--color-primary-content);--vc-date-weekend-hover-bg:var(--color-base-200);--vc-date-weekend-today-color:var(--color-primary);--vc-date-range-middle-weekend-bg:color-mix(in oklab,var(--color-primary) 20%,transparent);--vc-date-range-middle-weekend-color:var(--color-base-content);--vc-week-day-off-color:color-mix(in oklab,var(--color-base-content) 60%,transparent);--vc-months-years-bg:var(--color-base-100);--vc-months-years-color:var(--color-base-content);--vc-months-years-bg-hover:var(--color-base-200);--vc-months-years-bg-selected:var(--color-primary);--vc-months-years-color-selected:var(--color-primary-content);--vc-title-color:var(--color-base-content);--vc-title-color-hover:var(--color-primary);--vc-focus-outline-color:var(--color-primary)}"}</style>
      <script type="module" dangerouslySetInnerHTML={{ __html: CALENDAR_SCRIPT }} />
    </Layout>
  );
}

// Schreibt in die versteckten Felder plannedFrom/plannedTo; lädt gesperrte Tage neu,
// wenn sich die Menge ändert, und verwirft eine nicht mehr passende Auswahl.
const CALENDAR_SCRIPT = `
  import { Calendar } from "/js/vanilla-calendar.min.js";
  const root = document.getElementById("lend-calendar");
  if (root) {
    const fromInput = document.getElementById("lend-plannedFrom");
    const toInput = document.getElementById("lend-plannedTo");
    const quantityInput = document.querySelector('input[name="quantity"]');
    let calendar;
    const timeFrom = document.querySelector('input[name="plannedFromTime"]');
    const timeTo = document.querySelector('input[name="plannedToTime"]');
    const summary = document.getElementById("lend-summary");
    const fmt = (iso) => iso.split("-").reverse().join(".");
    function updateSummary() {
      if (!fromInput.value) { summary.hidden = true; return; }
      const part = (d, t) => fmt(d) + (t ? ", " + t + " Uhr" : "");
      const from = part(fromInput.value, timeFrom.value), to = part(toInput.value, timeTo.value);
      const d0 = Date.parse(fromInput.value), d1 = Date.parse(toInput.value);
      const hasTimes = timeFrom.value && timeTo.value;
      const mins = hasTimes
        ? (d1 - d0) / 60000 + (timeTo.value.slice(0, 2) - timeFrom.value.slice(0, 2)) * 60 + (timeTo.value.slice(3, 5) - timeFrom.value.slice(3, 5))
        : ((d1 - d0) / 86400000 + 1) * 1440;
      const units = [[10080, "Woche", "Wochen"], [1440, "Tag", "Tage"], [60, "Std.", "Std."], [1, "Min.", "Min."]];
      let rest = Math.max(0, Math.round(mins));
      const parts = [];
      for (const [size, one, many] of units) {
        const n = Math.floor(rest / size);
        rest -= n * size;
        if (n) parts.push(n + " " + (n === 1 ? one : many));
      }
      summary.textContent = summary.dataset.label + ": " + (from === to ? from : from + " – " + to) + (parts.length ? " (" + parts.join(", ") + ")" : "");
      summary.hidden = false;
    }
    timeFrom.addEventListener("input", updateSummary);
    timeTo.addEventListener("input", updateSummary);
    async function loadBlocked() {
      const quantity = quantityInput ? quantityInput.value : (root.dataset.quantity || "1");
      const res = await fetch(\`/lend/\${root.dataset.itemId}/blocked?quantity=\${quantity}\`);
      const disableDates = res.ok ? await res.json() : [];
      const stillValid = fromInput.value && toInput.value &&
        !disableDates.some((d) => d >= fromInput.value && d <= toInput.value);
      if (!stillValid) { fromInput.value = ""; toInput.value = ""; }
      if (calendar) { calendar.set({ disableDates, selectedDates: stillValid ? [fromInput.value, toInput.value] : [] }); updateSummary(); return; }
      calendar = new Calendar(root, {
        selectionDatesMode: "multiple-ranged",
        disableDates,
        disableDatesGaps: true,
        disableDatesPast: true,
        locale: "de-DE",
        firstWeekday: 1,
        selectedDates: fromInput.value && toInput.value ? [fromInput.value, toInput.value] : [],
        onClickDate(self) {
          const sel = self.context.selectedDates;
          fromInput.value = sel[0] || "";
          toInput.value = sel[sel.length - 1] || "";
          updateSummary();
        },
      });
      calendar.init();
      updateSummary();
    }
    quantityInput?.addEventListener("change", loadBlocked);
    loadBlocked();
  }
`;

const REQUEST_STATUS_LABEL = { open: t("lend.status.open"), approved: t("lend.status.approved"), rejected: t("lend.status.rejected") } as const;

type RequestWithItem = NonNullable<Awaited<ReturnType<typeof fetchRequestDetail>>>;

async function fetchRequestDetail(token: string) {
  return db.query.loanRequests.findFirst({
    where: eq(loanRequests.statusToken, token),
    with: { lendingItem: { with: { inventoryItem: true } } },
  });
}

const fmtDate = (iso: string) => iso.split("-").reverse().join(".");

// Zeitraum und Dauer wie die Zusammenfassung im Antragsformular (siehe updateSummary).
export function formatPeriod(r: Pick<RequestWithItem, "plannedFrom" | "plannedTo" | "plannedFromTime" | "plannedToTime">): string {
  const part = (d: string, time: string | null) => fmtDate(d) + (time ? `, ${time.slice(0, 5)} Uhr` : "");
  const from = part(r.plannedFrom, r.plannedFromTime), to = part(r.plannedTo, r.plannedToTime);
  const d0 = Date.parse(r.plannedFrom), d1 = Date.parse(r.plannedTo);
  const mins = r.plannedFromTime && r.plannedToTime
    ? (d1 - d0) / 60000 + (Number(r.plannedToTime.slice(0, 2)) - Number(r.plannedFromTime.slice(0, 2))) * 60 + (Number(r.plannedToTime.slice(3, 5)) - Number(r.plannedFromTime.slice(3, 5)))
    : ((d1 - d0) / 86400000 + 1) * 1440;
  const units: [number, string, string][] = [[10080, "Woche", "Wochen"], [1440, "Tag", "Tage"], [60, "Std.", "Std."], [1, "Min.", "Min."]];
  let rest = Math.max(0, Math.round(mins));
  const parts: string[] = [];
  for (const [size, one, many] of units) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return (from === to ? from : `${from} – ${to}`) + (parts.length ? ` (${parts.join(", ")})` : "");
}

const STATUS_BADGE = { open: "badge-info", approved: "badge-success", rejected: "badge-error" } as const;

function StatusPage({ request, justSubmitted }: { request: RequestWithItem; justSubmitted: boolean }) {
  const statusUrl = `${process.env.OIDC_APP_URL ?? ""}/lend/status/${request.statusToken}`;
  const date = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <Layout title={t("lend.status.title")}>
      <div class="max-w-xl mx-auto space-y-4">
        <PageHeader title={t("lend.status.title")} />
        {justSubmitted && <div role="alert" class="alert alert-success">{t("lend.success.body")}</div>}

        <section class="card bg-base-100 border border-base-300">
          <div class="card-body gap-2">
            <span class={`badge ${STATUS_BADGE[request.status]}`}>{REQUEST_STATUS_LABEL[request.status]}</span>
            <p>{t(`lend.status.text.${request.status}`)}</p>
          </div>
        </section>

        <section class="card bg-base-100 border border-base-300">
          <dl class="card-body grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="opacity-60">{t("lending.loans.form.item")}</dt><dd>{request.lendingItem.inventoryItem.name}</dd>
            {request.quantity > 1 && <><dt class="opacity-60">{t("lending.loans.form.quantity")}</dt><dd>{request.quantity}</dd></>}
            <dt class="opacity-60">{t("lend.form.summary")}</dt><dd>{formatPeriod(request)}</dd>
            <dt class="opacity-60">{t("lend.status.submittedAt")}</dt><dd>{date(request.submittedAt)}</dd>
            {request.reviewedAt && <><dt class="opacity-60">{t("lend.status.reviewedAt")}</dt><dd>{date(request.reviewedAt)}</dd></>}
          </dl>
        </section>

        <section class="card bg-base-200">
          <div class="card-body gap-2">
            <h2 class="font-semibold">{t("lend.status.link.title")}</h2>
            <p class="text-sm opacity-70">{t("lend.status.link.hint")}</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs break-all select-all">{statusUrl}</code>
              <button type="button" class="btn min-h-11 min-w-11" aria-label={t("common.copy")} title={t("common.copy")} data-url={statusUrl} onclick="navigator.clipboard.writeText(this.dataset.url)">
                <Icon name="document-duplicate" class="h-5 w-5 shrink-0" />
                <span class="max-sm:hidden">{t("common.copy")}</span>
              </button>
            </div>
          </div>
        </section>

        <ContactFooter hint={request.status === "open" ? t("lend.form.noWithdraw") : undefined} />
        <PrivacyNotice />
      </div>
    </Layout>
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function emptyValues(): Promise<RequestValues> {
  return { firstName: "", lastName: "", email: "", phone: "", plannedFrom: "", plannedTo: "", plannedFromTime: "", plannedToTime: "", quantity: "1", message: "" };
}

function maxQuantityFor(item: NonNullable<Awaited<ReturnType<typeof fetchRequestableItem>>>): number {
  const stock = item.inventoryItem.quantity - item.inventoryItem.retiredQuantity;
  return Math.max(1, Math.min(item.maxRequestQuantity, stock > 0 ? stock : item.maxRequestQuantity));
}

lendRoutes.get("/:itemId", async (c) => {
  const item = await fetchRequestableItem(c.req.param("itemId"));
  if (!item) return c.notFound();
  const config = await loadOrgConfig();
  return c.html(<RequestPage item={item} orgName={config.orgName} values={await emptyValues()} errors={{}} maxQuantity={maxQuantityFor(item)} />);
});

async function notifyManager(itemName: string, requestId: string) {
  const config = await loadOrgConfig();
  if (!config.notificationEmail) return;
  await sendMail(
    config.notificationEmail,
    t("lend.mail.notifySubject", { name: itemName }),
    t("lend.mail.notifyBody", { name: itemName, url: `${process.env.OIDC_APP_URL ?? ""}/inventory/requests/${requestId}` }),
    { "X-On-Duty-Type": "lend-request" },
  );
}

// Eingangsbestätigung an den Antragsteller — nur mit E-Mail und SMTP; ohne Mail bleibt notifiedAt null (Admin-Hinweis auf der Detailseite).
async function notifyApplicant(email: string | null, token: string): Promise<Date | null> {
  if (!email) return null;
  const statusUrl = `${process.env.OIDC_APP_URL ?? ""}/lend/status/${token}`;
  const result = await sendMail(
    email,
    t("lend.mail.submittedSubject"),
    `${t("lend.mail.submittedBody")}\n\n${statusUrl}`,
    { "X-On-Duty-Type": "lend-request" },
  );
  return result.sent ? new Date() : null;
}

lendRoutes.post("/:itemId", async (c) => {
  const item = await fetchRequestableItem(c.req.param("itemId"));
  if (!item) return c.notFound();
  const config = await loadOrgConfig();
  const maxQuantity = maxQuantityFor(item);

  const ip = clientIp(c);
  if (!checkRateLimit(ip).allowed) {
    const values = parseRequestValues(await c.req.parseBody());
    return c.html(<RequestPage item={item} orgName={config.orgName} values={values} errors={{ _global: t("apply.error.rateLimited") }} maxQuantity={maxQuantity} />, HTTP_STATUS.TOO_MANY_REQUESTS);
  }
  recordFailedAttempt(ip);

  const body = await c.req.parseBody();
  if (String(body.website ?? "").trim()) return c.redirect(`/lend/${item.id}`);

  const values = parseRequestValues(body);
  const { errors, quantity } = validateRequest(values, { individualTracking: item.individualTracking, timesRequired: item.timesRequired, maxQuantity });
  if (Object.keys(errors).length === 0) {
    const stock = item.inventoryItem.quantity - item.inventoryItem.retiredQuantity;
    const existingLoans = await db.query.lendingLoans.findMany({ where: eq(lendingLoans.lendingItemId, item.id) });
    const candidate = {
      plannedFrom: values.plannedFrom, plannedTo: values.plannedTo,
      plannedFromTime: values.plannedFromTime || null, plannedToTime: values.plannedToTime || null,
      pickedUpAt: null, returnedAt: null, quantity,
    };
    const availability = checkAvailability({ individualTracking: item.individualTracking, stock }, existingLoans, candidate);
    if (availability.conflict) {
      errors.dates = availability.freeFrom ? t("lend.error.conflictFreeFrom", { time: availability.freeFrom }) : t("lend.error.conflict");
    }
  }
  if (Object.keys(errors).length > 0) {
    return c.html(<RequestPage item={item} orgName={config.orgName} values={values} errors={errors} maxQuantity={maxQuantity} />, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  }

  const token = randomBytes(16).toString("hex");
  let requestId = "";
  await db.transaction(async (tx) => {
    const [person] = await tx.insert(persons).values({
      firstName: values.firstName, lastName: values.lastName,
      email: values.email || null, phone: values.phone || null,
    }).returning({ id: persons.id });
    const [req] = await tx.insert(loanRequests).values({
      lendingItemId: item.id,
      personId: person.id,
      quantity,
      plannedFrom: values.plannedFrom,
      plannedTo: values.plannedTo,
      plannedFromTime: values.plannedFromTime || null,
      plannedToTime: values.plannedToTime || null,
      message: values.message,
      statusToken: token,
    }).returning({ id: loanRequests.id });
    requestId = req.id;
  });

  await notifyManager(item.inventoryItem.name, requestId);
  const notifiedAt = await notifyApplicant(values.email || null, token);
  if (notifiedAt) await db.update(loanRequests).set({ notifiedAt }).where(eq(loanRequests.id, requestId));
  return c.redirect(`/lend/status/${token}?submitted=1`);
});

// GET /lend/:itemId/blocked?quantity=N — nur Verleihe zählen (offene Anfragen reservieren nichts).
lendRoutes.get("/:itemId/blocked", async (c) => {
  const item = await fetchRequestableItem(c.req.param("itemId"));
  if (!item) return c.notFound();
  const quantity = Math.max(1, Math.round(Number(c.req.query("quantity") ?? "1")) || 1);
  const stock = item.inventoryItem.quantity - item.inventoryItem.retiredQuantity;

  const loans = await db.query.lendingLoans.findMany({ where: eq(lendingLoans.lendingItemId, item.id) });
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const limit = new Date(today);
  limit.setFullYear(limit.getFullYear() + 1);
  const to = limit.toISOString().slice(0, 10);

  const days = blockedDays({ individualTracking: item.individualTracking, stock }, loans, quantity, from, to);
  return c.json(days);
});

// GET /lend/status/:token — zugleich Bestätigungsseite nach dem Absenden.
lendRoutes.get("/status/:token", async (c) => {
  const token = c.req.param("token");
  const ip = clientIp(c);
  if (!checkRateLimit(ip).allowed) return c.text(t("apply.error.rateLimited"), HTTP_STATUS.TOO_MANY_REQUESTS);

  const request = await fetchRequestDetail(token);
  if (!request) {
    recordFailedAttempt(ip);
    return c.notFound();
  }

  c.header("X-Robots-Tag", "noindex");
  c.header("Referrer-Policy", "no-referrer");
  return c.html(<StatusPage request={request} justSubmitted={c.req.query("submitted") === "1"} />);
});
