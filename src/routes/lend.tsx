import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { lendingItems, lendingLoans, loanRequests, persons } from "../db/schema/index.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { Field, EmailInput, PhoneInput } from "../components/field.js";
import { ContactFooter, Honeypot, PrivacyNotice, clientIp } from "../components/public-form.js";
import { t } from "../i18n/index.js";
import { checkRateLimit, recordFailedAttempt } from "../lib/ratelimit.js";
import { loadOrgConfig } from "../lib/org-config.js";
import { sendMail } from "../lib/mail.js";
import { parseRequestValues, validateRequest, type RequestValues } from "../lib/loan-request.js";
import { blockedDays } from "../lib/lending.js";
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
    <form method="post" class="space-y-4">
      <Honeypot />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("apply.form.firstName")} required>
          <input type="text" name="firstName" value={values.firstName} class={`input w-full${errors.firstName ? " input-error" : ""}`} />
        </Field>
        <Field label={t("apply.form.lastName")} required>
          <input type="text" name="lastName" value={values.lastName} class={`input w-full${errors.lastName ? " input-error" : ""}`} />
        </Field>
      </div>
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
      {!item.individualTracking && maxQuantity > 1 && (
        <Field label={t("lending.loans.form.quantity")} class="max-w-32" required>
          <input type="number" name="quantity" min="1" max={maxQuantity} value={values.quantity || "1"} class={`input w-full${errors.quantity ? " input-error" : ""}`} />
          {errors.quantity && <span class="text-error text-sm mt-1">{errors.quantity}</span>}
        </Field>
      )}
      <Field label={t("apply.form.message")} required>
        <textarea name="message" class={`textarea w-full${errors.message ? " textarea-error" : ""}`} rows={3}>{values.message}</textarea>
      </Field>
      <p class="text-sm opacity-60">{t("lend.form.noWithdraw")}</p>
      <PrivacyNotice />
      <button type="submit" class="btn btn-primary">{t("lend.form.submit")}</button>
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
        <PageHeader title={item.inventoryItem.name} subtitle={orgName} />
        {maxQuantity > 1 && !item.individualTracking && (
          <p class="text-sm opacity-70 mb-4">{t("lend.form.maxQuantityHint", { max: maxQuantity })}</p>
        )}
        <RequestForm item={item} values={values} errors={errors} maxQuantity={maxQuantity} />
        <ContactFooter />
      </div>
      <link rel="stylesheet" href="/css/vanilla-calendar.css" />
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
    async function loadBlocked() {
      const quantity = quantityInput ? quantityInput.value : (root.dataset.quantity || "1");
      const res = await fetch(\`/lend/\${root.dataset.itemId}/blocked?quantity=\${quantity}\`);
      const disableDates = res.ok ? await res.json() : [];
      const stillValid = fromInput.value && toInput.value &&
        !disableDates.some((d) => d >= fromInput.value && d <= toInput.value);
      if (!stillValid) { fromInput.value = ""; toInput.value = ""; }
      if (calendar) { calendar.set({ disableDates, selectedDates: stillValid ? [fromInput.value, toInput.value] : [] }); return; }
      calendar = new Calendar(root, {
        selectionDatesMode: "multiple-ranged",
        disableDates,
        disableDatesGaps: true,
        disableDatesPast: true,
        firstWeekday: 1,
        selectedDates: fromInput.value && toInput.value ? [fromInput.value, toInput.value] : [],
        onClickDate(self) {
          const sel = self.context.selectedDates;
          fromInput.value = sel[0] || "";
          toInput.value = sel[sel.length - 1] || "";
        },
      });
      calendar.init();
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

function StatusPage({ request, justSubmitted }: { request: RequestWithItem; justSubmitted: boolean }) {
  const period = request.plannedFrom === request.plannedTo ? request.plannedFrom : `${request.plannedFrom} – ${request.plannedTo}`;
  return (
    <Layout title={t("lend.status.title")}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("lend.status.title")} />
        {justSubmitted && <div class="alert alert-success mb-4">{t("lend.success.body")}</div>}
        <div class="alert alert-info mb-4">{t("lend.status.notYetConfirmed")}</div>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm mb-4">
          <dt class="opacity-60">{t("lending.loans.form.item")}</dt><dd>{request.lendingItem.inventoryItem.name}</dd>
          <dt class="opacity-60">{t("lend.form.plannedFrom")}</dt><dd>{period}</dd>
          {request.quantity > 1 && <><dt class="opacity-60">{t("lending.loans.form.quantity")}</dt><dd>{request.quantity}</dd></>}
          <dt class="opacity-60">{t("lend.status.submittedAt")}</dt><dd>{request.submittedAt.toLocaleDateString("de-DE")}</dd>
          <dt class="opacity-60">{t("lend.status.status")}</dt><dd>{REQUEST_STATUS_LABEL[request.status]}</dd>
          {request.reviewedAt && <><dt class="opacity-60">{t("lend.status.reviewedAt")}</dt><dd>{request.reviewedAt.toLocaleDateString("de-DE")}</dd></>}
        </dl>
        {!request.lendingItem.inventoryItem && null}
        <p class="text-sm opacity-60">{t("lend.form.noWithdraw")}</p>
        <div class="flex items-center gap-2 mt-2">
          <input type="text" readonly value={`${process.env.OIDC_APP_URL ?? ""}/lend/status/${request.statusToken}`} class="input input-sm flex-1" />
          <button type="button" class="btn btn-sm" onclick={`navigator.clipboard.writeText(this.previousElementSibling.value)`}>{t("common.copy")}</button>
        </div>
        <ContactFooter />
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
