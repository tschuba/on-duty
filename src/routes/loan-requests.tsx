import { Hono, type Context } from "hono";
import { eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { lendingLoans, loanRequests, members, persons } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { formatPeriod } from "./lend.js";
import { InventoryTabs } from "./inventory.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { buildListUrl } from "../lib/list-query.js";
import { countOverdueInspectionItems } from "../lib/inventory.js";
import { checkAvailability, cleanupRejectedLoanRequests, countOpenLoanRequests, countOverdueLoans, matchCandidates } from "../lib/lending.js";
import { sendMail } from "../lib/mail.js";
import { loadOrgConfig } from "../lib/org-config.js";
import { getSettings } from "../lib/settings.js";

export const loanRequestRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("lending:manage");

type RequestStatus = "open" | "approved" | "rejected";
const ALL_STATUSES: RequestStatus[] = ["open", "approved", "rejected"];

const STATUS_LABEL: Record<RequestStatus, string> = {
  open: t("lend.status.open"),
  approved: t("lend.status.approved"),
  rejected: t("lend.status.rejected"),
};
const STATUS_BADGE_CLASS: Record<RequestStatus, string> = {
  open: "badge badge-sm badge-warning",
  approved: "badge badge-sm badge-success",
  rejected: "badge badge-sm badge-ghost opacity-60",
};

async function fetchRequests() {
  return db.query.loanRequests.findMany({
    with: { lendingItem: { with: { inventoryItem: true } }, person: true },
  });
}

async function fetchRequest(id: string) {
  return db.query.loanRequests.findFirst({
    where: eq(loanRequests.id, id),
    with: { lendingItem: { with: { inventoryItem: true } }, person: true },
  });
}

function ReadField({ label, value, class: cls }: { label: string; value: string; class?: string }) {
  return (
    <div class={cls}>
      <div class="text-sm opacity-60">{label}</div>
      <div class="font-medium whitespace-pre-wrap">{value || "—"}</div>
    </div>
  );
}

function periodLabel(r: { plannedFrom: string; plannedTo: string }): string {
  return r.plannedFrom === r.plannedTo ? formatDate(r.plannedFrom) : `${formatDate(r.plannedFrom)} – ${formatDate(r.plannedTo)}`;
}

// GET /inventory/requests — Standard: offene Anfragen.
loanRequestRoutes.get("/", guard, async (c) => {
  const user = c.get("user");
  const statusRaw = c.req.queries("status") ?? [];
  const statusFilter: RequestStatus[] = statusRaw.length > 0 ? (statusRaw as RequestStatus[]) : ["open"];

  // Lazy statt Scheduler, siehe Backlog-Doc "Aufbewahrung" — die App führt keinen eigenen Cron.
  const { loanRequestRetentionDays } = await getSettings();
  await cleanupRejectedLoanRequests(Number(loanRequestRetentionDays));

  const all = await fetchRequests();
  const rows = all
    .filter((r) => statusFilter.includes(r.status))
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  const overdueCount = await countOverdueInspectionItems();
  const overdueLoanCount = await countOverdueLoans();

  function filterUrl(next: RequestStatus[]) {
    return buildListUrl("/inventory/requests", { status: statusFilter }, { status: next });
  }

  return c.html(
    <Layout title={t("lend.requests.title")} user={user} activeNav="inventory">
      <InventoryTabs active="requests" overdueCount={overdueCount} overdueLoanCount={overdueLoanCount} openRequestCount={await countOpenLoanRequests()} showLending showRequests />
      <PageHeader title={t("lend.requests.title")} />
      <div class="filter-bar mb-4 flex flex-wrap items-center gap-x-4">
        {ALL_STATUSES.map((s) => {
          const on = statusFilter.includes(s);
          return (
            <label key={s} class="flex items-center gap-2 min-h-11 cursor-pointer">
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={on}
                disabled={on && statusFilter.length === 1}
                data-href={filterUrl(on ? statusFilter.filter((x) => x !== s) : [...statusFilter, s])}
              />
              <span class="text-sm">{STATUS_LABEL[s]}</span>
            </label>
          );
        })}
        <script dangerouslySetInnerHTML={{ __html: "document.addEventListener('change',function(e){var h=e.target.dataset&&e.target.dataset.href;if(h)location.href=h;});" }} />
      </div>
      <div class="overflow-x-auto">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th>{t("lending.loans.form.item")}</th>
              <th>{t("apply.form.lastName")}</th>
              <th>{t("lend.form.plannedFrom")}</th>
              <th>{t("lend.status.submittedAt")}</th>
              <th>{t("lend.status.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colspan={5} class="text-center opacity-50 py-8">{t("lend.requests.empty")}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} class="cursor-pointer hover" onclick={`window.location='/inventory/requests/${r.id}'`}>
                <td>{r.lendingItem.inventoryItem.name}</td>
                <td>{r.person.lastName}, {r.person.firstName}</td>
                <td>{periodLabel(r)}</td>
                <td>{formatDate(r.submittedAt.toISOString().slice(0, 10))}</td>
                <td><span class={STATUS_BADGE_CLASS[r.status]}>{STATUS_LABEL[r.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

// GET /inventory/requests/:id — Detail.
loanRequestRoutes.get("/:id", guard, async (c) => {
  const user = c.get("user");
  const request = await fetchRequest(c.req.param("id"));
  if (!request) return c.notFound();
  const openOthers = (await fetchRequests()).filter((r) =>
    r.id !== request.id && r.status === "open" && r.lendingItem.id === request.lendingItem.id &&
    r.plannedFrom <= request.plannedTo && request.plannedFrom <= r.plannedTo,
  ).length;

  return c.html(
    <Layout title={request.lendingItem.inventoryItem.name} user={user} activeNav="inventory">
      <PageHeader
        title={<>{request.lendingItem.inventoryItem.name} <span class={STATUS_BADGE_CLASS[request.status]}>{STATUS_LABEL[request.status]}</span></>}
        backHref="/inventory/requests"
      />
      <div class="max-w-2xl">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <ReadField label={t("apply.form.firstName")} value={`${request.person.firstName} ${request.person.lastName}`} />
          <ReadField label={t("lend.status.submittedAt")} value={formatDate(request.submittedAt.toISOString().slice(0, 10))} />
          {request.person.email && <ReadField label={t("apply.form.email")} value={request.person.email} />}
          {request.person.phone && <ReadField label={t("apply.form.phone")} value={request.person.phone} />}
          {request.person.mobile && <ReadField label={t("members.form.mobile")} value={request.person.mobile} />}
          <ReadField class="sm:col-span-2" label={t("lend.form.summary")} value={formatPeriod(request)} />
          {request.quantity > 1 && <ReadField label={t("lending.loans.form.quantity")} value={String(request.quantity)} />}
          {openOthers > 0 && <ReadField label={t("lend.requests.otherOpen")} value={String(openOthers)} />}
          <ReadField class="sm:col-span-2" label={t("apply.form.message")} value={request.message ?? ""} />
        </div>
        {request.notifiedAt === null && <p class="text-warning text-sm mb-4">{t("lend.requests.notNotified")}</p>}

        {request.status === "open" && (
          <div class="flex items-center gap-2">
            <a href={`/inventory/requests/${request.id}/approve`} class="btn btn-primary">{t("lend.requests.approve")}</a>
            <button type="button" class="btn btn-outline btn-error" onclick="document.getElementById('reject-modal').showModal()">{t("lend.requests.reject")}</button>
          </div>
        )}
        {request.status === "rejected" && request.rejectedReason && (
          <p class="text-sm opacity-70 mt-2">{t("lend.requests.internalReason")}: {request.rejectedReason}</p>
        )}
      </div>

      <dialog id="reject-modal" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg mb-4">{t("lend.requests.reject")}</h3>
          <form method="post" action={`/inventory/requests/${request.id}/reject`} class="space-y-4">
            <textarea name="rejectedReason" class="textarea w-full" rows={3} placeholder={t("lend.requests.internalReason")}></textarea>
            <div class="modal-action">
              <button type="button" class="btn" onclick="document.getElementById('reject-modal').close()">{t("common.cancel")}</button>
              <button type="submit" class="btn btn-error">{t("lend.requests.reject")}</button>
            </div>
          </form>
        </div>
      </dialog>
    </Layout>
  );
});

// GET /inventory/requests/:id/approve — Bestätigungsschritt mit Personenkandidaten.
loanRequestRoutes.get("/:id/approve", guard, async (c) => {
  const user = c.get("user");
  const request = await fetchRequest(c.req.param("id"));
  if (!request || request.status !== "open") return c.notFound();

  const pool = await db
    .select({ id: persons.id, firstName: persons.firstName, lastName: persons.lastName, email: persons.email, phone: persons.phone })
    .from(persons)
    .where(ne(persons.id, request.person.id));
  const candidates = matchCandidates(request.person, pool);

  return c.html(
    <Layout title={t("lend.requests.approveTitle")} user={user} activeNav="inventory">
      <PageHeader title={t("lend.requests.approveTitle")} backHref={`/inventory/requests/${request.id}`} />
      <form method="post" action={`/inventory/requests/${request.id}/approve`} class="max-w-xl space-y-4">
        <p class="text-sm opacity-70">{t("lend.requests.requestedBy", { name: `${request.person.firstName} ${request.person.lastName}` })}</p>
        {candidates.length > 0 ? (
          <fieldset class="fieldset">
            {candidates.map((cand, i) => (
              <label key={cand.id} class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
                <input type="radio" name="personId" value={cand.id} class="radio" checked={i === 0} />
                <span>{cand.firstName} {cand.lastName} {cand.email ? `· ${cand.email}` : ""} {cand.phone ? `· ${cand.phone}` : ""}</span>
                {cand.strength === "weak" && <span class="badge badge-sm badge-ghost">{t("lend.requests.weakMatch")}</span>}
              </label>
            ))}
            <label class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
              <input type="radio" name="personId" value="" class="radio" />
              <span>{t("lend.requests.createNew")}</span>
            </label>
          </fieldset>
        ) : (
          <p class="text-sm opacity-70">{t("lend.requests.createNew")}</p>
        )}
        <button type="submit" class="btn btn-primary">{t("lend.requests.confirmApprove")}</button>
      </form>
    </Layout>
  );
});

async function notifyDecision(request: NonNullable<Awaited<ReturnType<typeof fetchRequest>>>, approved: boolean) {
  const config = await loadOrgConfig();
  const contact = request.person.email ?? request.person.phone;
  if (!request.person.email) return { notified: false, contact };
  const subject = approved ? t("lend.mail.approvedSubject") : t("lend.mail.rejectedSubject");
  const body = approved ? t("lend.mail.approvedBody") : t("lend.mail.rejectedBody");
  const statusUrl = `${process.env.OIDC_APP_URL ?? ""}/lend/status/${request.statusToken}`;
  const result = await sendMail(request.person.email, subject, `${body}\n\n${statusUrl}`, { "X-On-Duty-Type": "lend-request" });
  return { notified: result.sent, contact };
}

// POST /inventory/requests/:id/approve — Transaktion: Person (falls neu) + lending_loans.
loanRequestRoutes.post("/:id/approve", guard, async (c) => {
  const user = c.get("user");
  const request = await fetchRequest(c.req.param("id"));
  if (!request || request.status !== "open") return c.notFound();

  const body = await c.req.parseBody();
  const chosenPersonId = trimmed(body, "personId");

  const item = request.lendingItem;
  const stock = item.inventoryItem.quantity - item.inventoryItem.retiredQuantity;
  const existingLoans = await db.query.lendingLoans.findMany({ where: eq(lendingLoans.lendingItemId, item.id) });
  const availability = checkAvailability(
    { individualTracking: item.individualTracking, stock },
    existingLoans,
    { plannedFrom: request.plannedFrom, plannedTo: request.plannedTo, plannedFromTime: request.plannedFromTime, plannedToTime: request.plannedToTime, pickedUpAt: null, returnedAt: null, quantity: request.quantity },
  );
  if (availability.conflict) {
    setFlash(c, t("lending.loans.error.conflict"), "error");
    return c.redirect(`/inventory/requests/${request.id}`);
  }

  await db.transaction(async (tx) => {
    const personId = chosenPersonId || (await tx.insert(persons).values({
      firstName: request.person.firstName, lastName: request.person.lastName,
      email: request.person.email, phone: request.person.phone,
    }).returning({ id: persons.id }))[0].id;

    const [loan] = await tx.insert(lendingLoans).values({
      lendingItemId: item.id,
      quantity: request.quantity,
      borrowerPersonId: personId,
      plannedFrom: request.plannedFrom,
      plannedTo: request.plannedTo,
      plannedFromTime: request.plannedFromTime,
      plannedToTime: request.plannedToTime,
    }).returning({ id: lendingLoans.id });

    await tx.update(loanRequests).set({
      status: "approved", loanId: loan.id, reviewedAt: new Date(), reviewedBy: user.id,
    }).where(eq(loanRequests.id, request.id));
  });

  const { notified, contact } = await notifyDecision(request, true);
  await db.update(loanRequests).set({ notifiedAt: notified ? new Date() : null }).where(eq(loanRequests.id, request.id));
  setFlash(c, notified ? t("lend.requests.flash.approved") : t("lend.requests.flash.approvedNoMail", { contact: contact ?? "" }), notified ? "success" : "error");
  return c.redirect(`/inventory/requests/${request.id}`);
});

// POST /inventory/requests/:id/reject — kein Verleih, Grund bleibt intern.
loanRequestRoutes.post("/:id/reject", guard, async (c) => {
  const user = c.get("user");
  const request = await fetchRequest(c.req.param("id"));
  if (!request || request.status !== "open") return c.notFound();

  const body = await c.req.parseBody();
  const rejectedReason = trimmed(body, "rejectedReason") || null;

  await db.update(loanRequests).set({
    status: "rejected", rejectedReason, reviewedAt: new Date(), reviewedBy: user.id,
  }).where(eq(loanRequests.id, request.id));

  const { notified, contact } = await notifyDecision(request, false);
  await db.update(loanRequests).set({ notifiedAt: notified ? new Date() : null }).where(eq(loanRequests.id, request.id));
  setFlash(c, notified ? t("lend.requests.flash.rejected") : t("lend.requests.flash.rejectedNoMail", { contact: contact ?? "" }), notified ? "success" : "error");
  return c.redirect(`/inventory/requests/${request.id}`);
});
