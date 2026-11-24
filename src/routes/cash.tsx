import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { cashEntries } from "../db/schema/index.js";
import { db } from "../db/index.js";
import { events, users } from "../db/schema/index.js";
import { Field, ViewField, ViewGrid } from "../components/field.js";
import { Section } from "../components/section.js";
import { FormCard, FormSection } from "../components/public-form.js";
import { Icon } from "../components/icon.js";
import { FilterDialog, navFilterLabels } from "../components/filter-dialog.js";
import { PageSearch } from "../components/page-search.js";
import { ChipInput } from "../components/chip-input.js";
import { CashSettingsFields, CashSettingsForm } from "../components/cash-settings-form.js";
import { Layout } from "../components/layout.js";
import { ActionMenu, DetailActions, HeaderAction, FormActions, PageHeader } from "../components/page-header.js";
import { RowAction } from "../components/row-action.js";
import { StatCard, StatGrid } from "../components/stat-card.js";
import { TitleSwitch, type TitleSwitchItem } from "../components/title-switch.js";
import { QuickRangeFilter } from "../components/quick-range-filter.js";
import { Pager } from "../components/pager.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { setFlash } from "../lib/flash.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { safeReturnTo } from "../lib/return-to.js";
import { buildListUrl, parsePagination, PAGE_SIZE_OPTIONS } from "../lib/list-query.js";
import { parseRange, rangePresets } from "../lib/quick-range.js";
import {
  CashError, csvCell, createCashEvent, deleteCashEvent, listCashEvents, updateCashEvent, type CashEventRow, resolveCashEvent, cashDate, todayStr, balanceAt, bookDonation, carryPreview, closeYear, reopenYear, yearLog, yearReport, type YearReport, cancelEntry, cashEventSummary, cashPerms, countUnbookedDonations, createEntry, currentYear, hasCash, listEntries, listTags, listYears,
  loadCashSettings, loadEntry, nextYearLabel, openCash, openReceivablesAt, payEntry, resolveTagChips, saveCashSettings, startWithZero,
  tagUsage, updateOpenEntry, updateTag, validateSettings, yearResult, type CashSettings, type Direction,
} from "../lib/cash.js";

export const cashRoutes = new Hono<{ Variables: Variables }>();

const read = requireAuth(cashPerms("read"));
const report = requireAuth(cashPerms("report"));
const manage = requireAuth(cashPerms("manage"));

const eur = (v: number | string) => `${(Number(v) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const STATUSES = ["open", "booked", "reversed", "cancelled"] as const;

function errText(e: unknown): string {
  if (e instanceof CashError) return t(`cash.error.${e.code}` as never, (e.data ?? {}) as never);
  throw e;
}

const num = (s: string) => Number(s.replace(",", "."));

// ── Formular ────────────────────────────────────────────────────────────────

type TagRow = { id: string; name: string; direction: string; active: boolean; meaning: string | null };
type ItemValues = { key: string; amount: string; description: string; tagIds: string[] };
type FormValues = { direction: Direction; bookingDate: string; description: string; receiptRef: string; eventRef: string; newEvent: string; paid: boolean; paidDate: string; items: ItemValues[] };

const BADGE = "badge-ghost";
const presetsOf = (tags: TagRow[]) => tags.filter((x) => x.active).map((x) => ({ key: x.id, label: x.name, badge: BADGE }));
// Gelöschte/inaktive Tags bleiben als Chip erhalten, damit Bearbeiten sie nicht stillschweigend verliert.
const allPresets = (tags: TagRow[]) => tags.map((x) => ({ key: x.id, label: x.name, badge: BADGE }));

function ItemRow({ item, tags }: { item: ItemValues; tags: TagRow[] }) {
  return (
    <div class="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3 items-start rounded-box border border-base-300 bg-base-100 p-3" data-item>
      <Field label={t("cash.form.amount")} required>
        <input type="text" inputmode="decimal" name={`amount_${item.key}`} value={item.amount} class="input w-full tabular-nums" data-amount placeholder={t("cash.form.amount")} />
      </Field>
      <div class="flex gap-2 items-start">
        <div class="grow min-w-0">
          <ChipInput name={`tags_${item.key}`} label={t("cash.form.tags")} values={item.tagIds} presets={allPresets(tags)} presetButtons={false}
            suggestionsFrom="#cash-tag-names" createDirectionFrom="input[name=direction]:checked" caseSensitive={false} />
          <Field label={t("cash.form.itemDescription")} class="mt-2">
            <input type="text" name={`desc_${item.key}`} value={item.description} class="input w-full" placeholder={t("cash.form.itemDescription")} />
          </Field>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-square" aria-label={t("cash.form.removeItem")} title={t("cash.form.removeItem")}
          onclick="var r=this.closest('[data-item]');if(document.querySelectorAll('[data-item]').length>1)r.remove()">
          <Icon name="icon-[tabler--trash]" class="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function EntryForm({ values, tags, evs, action, id, error, lockPaid }: {
  values: FormValues; tags: TagRow[]; evs: { events: { id: string; title: string }[]; free: CashEventRow[] }; action: string; id: string; error?: string; lockPaid?: boolean;
}) {
  return (
    <form id={id} method="post" action={action} class="max-w-3xl flex flex-col gap-4">
      {error && <div class="alert alert-error" role="alert">{error}</div>}
      <script type="application/json" id="cash-tag-names" dangerouslySetInnerHTML={{ __html: JSON.stringify(presetsOf(tags).map((p) => p.label)).replace(/</g, "\\u003c") }} />
      <FormCard><FormSection title={t("cash.form.sectionBooking")}>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:items-end">
        <Field label={t("cash.form.direction")} required floating={false}>
          <div class="join w-full" role="radiogroup">
            {(["income", "expense"] as const).map((d) => <input type="radio" name="direction" value={d} class="join-item btn flex-1" aria-label={t(`cash.direction.${d}`)} checked={values.direction === d} />)}
          </div>
        </Field>
        <Field label={t("cash.form.bookingDate")} required>
          <input type="date" name="bookingDate" value={values.bookingDate} class="input w-full" />
        </Field>
      </div>
      <Field label={t("cash.form.description")}>
        <input type="text" name="description" value={values.description} class="input w-full" placeholder={t("cash.form.description")} />
      </Field>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("cash.form.receiptRef")}>
          <input type="text" name="receiptRef" value={values.receiptRef} class="input w-full" placeholder={t("cash.form.receiptRef")} />
        </Field>
        <Field label={t("cash.form.event")}>
          <select name="eventRef" class="select w-full">
            <option value="">{t("cash.form.noEvent")}</option>
            <optgroup label={t("cash.form.eventsWithDate")}>
              {evs.events.map((e) => <option value={`e:${e.id}`} selected={values.eventRef === `e:${e.id}`}>{e.title}</option>)}
            </optgroup>
            {evs.free.length > 0 && <optgroup label={t("cash.form.eventsWithoutDate")}>
              {evs.free.map((e) => <option value={`c:${e.id}`} selected={values.eventRef === `c:${e.id}`}>{e.name}</option>)}
            </optgroup>}
          </select>
        </Field>
        <Field label={t("cash.form.newEvent")} hint={t("cash.form.newEventHint")}>
          <input type="text" name="newEvent" value={values.newEvent} maxlength={200} class="input w-full" placeholder={t("cash.form.newEvent")} />
        </Field>
      </div>
      </FormSection></FormCard>
      {!lockPaid && (
        <FormCard><FormSection title={t("cash.form.sectionPayment")}>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:items-end"
          onchange="var f=this.querySelector('[name=paidDate]');f.disabled=this.querySelector('[name=paid]:checked').value==='0';f.closest('[data-paid-date]').classList.toggle('hidden',f.disabled)">
          <Field label={t("cash.form.paymentStatus")} floating={false}>
            <div class="join w-full" role="radiogroup">
              {([["1", "cash.form.paid"], ["0", "cash.form.open"]] as const).map(([v, k]) => <input type="radio" name="paid" value={v} class="join-item btn flex-1" aria-label={t(k)} checked={(v === "1") === values.paid} />)}
            </div>
          </Field>
          <div data-paid-date class={values.paid ? "" : "hidden"}>
            <Field label={t("cash.form.paidDate")}>
              <div class="relative w-full">
                <input type="date" id="cash-paidDate" name="paidDate" value={values.paidDate} max={todayStr()} min={values.bookingDate || undefined} disabled={!values.paid} class="input w-full" />
                <div class="tooltip tooltip-left absolute right-9 top-1/2 -translate-y-1/2 z-10" data-tip={t("common.today")}>
                  <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label={t("common.today")} onclick="document.getElementById('cash-paidDate').value=new Date().toLocaleDateString('sv')">
                    <Icon name="icon-[tabler--calendar-check]" class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Field>
          </div>
        </div>
        </FormSection></FormCard>
      )}
      <FormCard><FormSection title={t("cash.form.sectionItems")} action={
        <button type="button" class="btn btn-outline btn-sm" hx-get="/cash/item-row" hx-vals="js:{i: Date.now()}" hx-target="#cash-items" hx-swap="beforeend">
          <Icon name="icon-[tabler--plus]" class="w-4 h-4" />{t("cash.form.addItem")}
        </button>}>
      <div id="cash-items" class="flex flex-col gap-3"
        oninput="var s=0;this.querySelectorAll('[data-amount]').forEach(function(i){var n=parseFloat(i.value.replace(',','.'));if(isFinite(n))s+=n});document.getElementById('cash-total').textContent=s.toLocaleString('de-DE',{style:'currency',currency:'EUR'})">
        {values.items.map((it) => <ItemRow item={it} tags={tags} />)}
      </div>
      <p class="text-xs opacity-70">{t("cash.form.tagsHint")}</p>
      <div class="flex justify-between items-center border-t border-base-300 pt-3 font-semibold">
        <span>{t("cash.form.total")}</span><output id="cash-total" class="tabular-nums">{values.items.reduce((a, i) => a + (num(i.amount) || 0), 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</output>
      </div>
      </FormSection></FormCard>
    </form>
  );
}

const emptyItem = (key: string): ItemValues => ({ key, amount: "", description: "", tagIds: [] });

async function formData() {
  return {
    tags: (await listTags()) as TagRow[],
    evs: {
      events: await db.select({ id: events.id, title: events.title }).from(events).orderBy(desc(events.startsAt)).limit(300),
      free: (await listCashEvents()).filter((e) => !e.eventId),
    },
  };
}

function parseForm(body: Record<string, any>): FormValues {
  const keys = [...new Set(Object.keys(body).filter((k) => /^(amount|desc|tags)_/.test(k)).map((k) => k.replace(/^[a-z]+_/, "")))];
  const arr = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
  return {
    direction: body.direction === "expense" ? "expense" : "income",
    bookingDate: trimmed(body, "bookingDate"),
    description: trimmed(body, "description"),
    receiptRef: trimmed(body, "receiptRef"),
    eventRef: trimmed(body, "eventRef"),
    newEvent: trimmed(body, "newEvent"),
    paid: body.paid !== "0",
    paidDate: trimmed(body, "paidDate"),
    items: (keys.length ? keys : ["0"]).map((key) => ({ key, amount: String(body[`amount_${key}`] ?? "").trim(), description: String(body[`desc_${key}`] ?? "").trim(), tagIds: arr(body[`tags_${key}`]) })),
  };
}

// Wandelt Formularwerte in Eingabe um; neue Tags werden angelegt (alles in einer Transaktion mit dem Buchen).
async function submit<T>(v: FormValues, userId: string, run: (items: { amount: number; description: string; tagIds: string[] }[], tx: any, eventRef: string) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const items = [];
    for (const it of v.items) {
      const amount = num(it.amount);
      if (!Number.isFinite(amount)) throw new CashError("invalidAmount");
      items.push({ amount, description: it.description, tagIds: await resolveTagChips(it.tagIds, userId, tx) });
    }
    const eventRef = v.newEvent ? `c:${await createCashEvent({ name: v.newEvent }, tx)}` : v.eventRef;
    return run(items, tx, eventRef);
  });
}

cashRoutes.get("/item-row", manage, async (c) => {
  const tags = (await listTags()) as TagRow[];
  return c.html(<ItemRow item={emptyItem(String(Number(c.req.query("i")) || Date.now()))} tags={tags} />);
});

cashRoutes.get("/new", manage, async (c) => {
  const user = c.get("user");
  if (!(await currentYear())) return c.redirect("/cash");
  const { tags, evs } = await formData();
  const values: FormValues = { direction: "income", bookingDate: todayStr(), description: "", receiptRef: "", eventRef: c.req.query("event") ? `e:${c.req.query("event")}` : "", newEvent: "", paid: true, paidDate: "", items: [emptyItem("0")] };
  return c.html(
    <Layout title={t("cash.newEntry")} user={user}>
      <PageHeader title={t("cash.newEntry")} backHref="/cash" backLabel={t("common.backToList")} actions={<FormActions formId="cash-form" cancelHref="/cash" />} />
      <EntryForm values={values} tags={tags} evs={evs} action="/cash/new" id="cash-form" />
    </Layout>,
  );
});

cashRoutes.post("/new", manage, async (c) => {
  const user = c.get("user");
  const v = parseForm(await c.req.parseBody({ all: true }));
  try {
    await submit(v, user.id, (items, tx, eventRef) => createEntry({
      direction: v.direction, bookingDate: v.bookingDate, paid: v.paid, paidDate: v.paidDate || null, description: v.description, receiptRef: v.receiptRef, eventRef, items,
    }, { userId: user.id }, tx));
  } catch (e) {
    const { tags, evs } = await formData();
    return c.html(
      <Layout title={t("cash.newEntry")} user={user}>
        <PageHeader title={t("cash.newEntry")} backHref="/cash" actions={<FormActions formId="cash-form" cancelHref="/cash" />} />
        <EntryForm values={v} tags={tags} evs={evs} action="/cash/new" id="cash-form" error={errText(e)} />
      </Layout>, 422);
  }
  setFlash(c, t("cash.flash.saved"), "success");
  return c.redirect("/cash");
});

cashRoutes.get("/:id/edit", manage, async (c) => {
  const user = c.get("user");
  const e = await loadEntry(c.req.param("id"));
  if (!e || e.status !== "open") return c.redirect("/cash");
  const { tags, evs } = await formData();
  const ce = e.cashEventId ? (await listCashEvents()).find((x) => x.id === e.cashEventId) : undefined;
  const values: FormValues = {
    direction: e.direction, bookingDate: e.bookingDate, description: e.description ?? "", receiptRef: e.receiptRef ?? "", eventRef: ce ? (ce.eventId ? `e:${ce.eventId}` : `c:${ce.id}`) : "", newEvent: "", paid: false, paidDate: "",
    items: e.items.map((i) => ({ key: i.id, amount: String(i.amount).replace(".", ","), description: i.description ?? "", tagIds: i.tagIds })),
  };
  return c.html(
    <Layout title={t("cash.editEntry")} user={user}>
      <PageHeader title={t("cash.editEntry")} backHref="/cash" actions={<FormActions formId="cash-form" cancelHref="/cash" />} />
      <EntryForm values={values} tags={tags} evs={evs} action={`/cash/${e.id}/edit`} id="cash-form" lockPaid />
    </Layout>,
  );
});

cashRoutes.post("/:id/edit", manage, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const v = parseForm(await c.req.parseBody({ all: true }));
  try {
    await submit(v, user.id, (items, tx, eventRef) => updateOpenEntry(id, {
      direction: v.direction, bookingDate: v.bookingDate, description: v.description, receiptRef: v.receiptRef, eventRef, items,
    }, { userId: user.id }, tx));
  } catch (e) {
    const { tags, evs } = await formData();
    return c.html(
      <Layout title={t("cash.editEntry")} user={user}>
        <PageHeader title={t("cash.editEntry")} backHref="/cash" actions={<FormActions formId="cash-form" cancelHref="/cash" />} />
        <EntryForm values={v} tags={tags} evs={evs} action={`/cash/${id}/edit`} id="cash-form" error={errText(e)} lockPaid />
      </Layout>, 422);
  }
  setFlash(c, t("cash.flash.saved"), "success");
  return c.redirect("/cash");
});

// ── Aktionen ────────────────────────────────────────────────────────────────

const back = (c: any, fallback = "/cash") => safeReturnTo(c.req.header("referer")?.replace(/^https?:\/\/[^/]+/, "")) ?? fallback;

cashRoutes.post("/:id/pay", manage, async (c) => {
  const body = await c.req.parseBody();
  try { await payEntry(c.req.param("id"), trimmed(body, "paidDate") || null); setFlash(c, t("cash.flash.paid"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(back(c));
});

cashRoutes.post("/:id/cancel", requireAuth(cashPerms("cancel")), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  try {
    const e = await loadEntry(id);
    // Offene Einträge zu stornieren gehört zur Buchführung (cash:manage), Stornobuchungen zu cash:cancel.
    if (e?.status === "open" && !hasCash(user.permissions, "manage")) return c.redirect("/cash");
    const r = await cancelEntry(id, { date: trimmed(body, "date") || null, userId: user.id });
    setFlash(c, t(r.kind === "cancelled" ? "cash.flash.cancelled" : "cash.flash.reversed"), "success");
  } catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(back(c));
});

// ── Einstellungen / Eröffnung ───────────────────────────────────────────────

function settingsFrom(body: Record<string, any>): CashSettings {
  return validateSettings({ mode: String(body.mode ?? "") as never, cutoff: trimmed(body, "cutoff"), basis: String(body.basis ?? "") as never });
}

cashRoutes.post("/settings", manage, async (c) => {
  const body = await c.req.parseBody();
  const dest = safeReturnTo(body.back) ?? "/cash";
  try { await saveCashSettings(settingsFrom(body)); setFlash(c, t("cash.flash.settingsSaved"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(dest);
});

// Eröffnen: Einstellungen speichern, dann Eröffnungsbuchung oder Bestand 0.
async function openHandler(c: any, zero: boolean) {
  const user = c.get("user");
  const body = await c.req.parseBody();
  try {
    await saveCashSettings(settingsFrom(body));
    const date = trimmed(body, "date");
    if (zero) await startWithZero(date);
    else {
      const amount = num(trimmed(body, "amount"));
      if (!(amount > 0)) throw new CashError("invalidAmount");
      await openCash(amount, date, { userId: user.id });
    }
    setFlash(c, t("cash.flash.opened"), "success");
  } catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect("/cash");
}
cashRoutes.post("/open", manage, (c) => openHandler(c, false));
cashRoutes.post("/open-zero", manage, (c) => openHandler(c, true));

// ── Tags ────────────────────────────────────────────────────────────────────

cashRoutes.post("/tags/:id", manage, async (c) => {
  const body = await c.req.parseBody();
  const patch: Parameters<typeof updateTag>[1] = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.active !== undefined) patch.active = body.active === "1";
  if (body.direction === "both") patch.direction = "both";
  try { await updateTag(c.req.param("id"), patch); setFlash(c, t("cash.tags.saved"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(`/cash/tags/${c.req.param("id")}`);
});

cashRoutes.get("/tags/:id", read, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const x = ((await listTags()) as TagRow[]).find((r) => r.id === id);
  if (!x) return c.redirect("/cash?view=tags");
  const canManage = hasCash(user.permissions, "manage");
  const u = (await tagUsage()).get(id) ?? { income: 0, expense: 0 };
  const editable = canManage && !x.meaning;
  return c.html(
    <Layout title={x.name} user={user}>
      <PageHeader title={x.name} backHref="/cash?view=tags"
        actions={editable ? <>
          <ActionMenu items={[
            x.direction !== "both" && { icon: "icon-[tabler--arrows-exchange]", label: t("cash.tags.widen"), form: "tag-widen", class: "btn-outline" },
            { icon: x.active ? "icon-[tabler--ban]" : "icon-[tabler--check]", label: x.active ? t("cash.tags.deactivate") : t("cash.tags.activate"), form: "tag-toggle", class: "btn-outline" },
          ]} />
          <DetailActions editHref={`/cash/tags/${id}/edit`} />
        </> : undefined} />
      {editable && <>
        <form id="tag-widen" method="post" action={`/cash/tags/${id}`}><input type="hidden" name="direction" value="both" /></form>
        <form id="tag-toggle" method="post" action={`/cash/tags/${id}`}><input type="hidden" name="active" value={x.active ? "0" : "1"} /></form>
      </>}
      {x.meaning && <div class="alert alert-info mb-4 max-w-2xl"><Icon name="icon-[tabler--lock]" class="h-5 w-5 shrink-0" />{t("cash.tags.system")} – {t("cash.tags.systemHint")}</div>}
      <ViewGrid>
        <ViewField label={t("cash.tags.name")} value={x.name} />
        <ViewField label={t("cash.tags.direction")} value={x.direction === "both" ? t("cash.tags.both") : t(`cash.direction.${x.direction as Direction}`)} />
        <ViewField label={t("cash.tags.status")} value={x.active ? t("cash.tags.active") : t("cash.tags.inactive")} />
        <ViewField label={t("cash.tags.usage")} value={`${u.income + u.expense} (${t("cash.direction.income")}: ${u.income}, ${t("cash.direction.expense")}: ${u.expense})`} />
      </ViewGrid>
      {u.income + u.expense > 0 && <p class="mt-4"><a class="link" href={`/cash?tag=${id}`}>{t("cash.tags.showEntries")}</a></p>}
    </Layout>,
  );
});

cashRoutes.get("/tags/:id/edit", manage, async (c) => {
  const id = c.req.param("id");
  const x = ((await listTags()) as TagRow[]).find((r) => r.id === id);
  if (!x || x.meaning) return c.redirect(`/cash/tags/${id}`);
  return c.html(
    <Layout title={t("cash.tags.rename")} user={c.get("user")}>
      <PageHeader title={x.name} backHref="/cash?view=tags" actions={<FormActions formId="tag-form" cancelHref={`/cash/tags/${id}`} />} />
      <form id="tag-form" method="post" action={`/cash/tags/${id}`} class="max-w-md">
        <Field label={t("cash.tags.name")} required><input type="text" name="name" value={x.name} required class="input w-full" /></Field>
      </form>
    </Layout>,
  );
});

const period = (r: { from: string | null; to: string | null }) =>
  !r.from && !r.to ? "" : r.from && r.to && r.from !== r.to ? `${formatDate(r.from)} – ${formatDate(r.to)}` : formatDate((r.from ?? r.to)!);

function EventsView({ rows, search, status }: { rows: CashEventRow[]; search: string; status: "" | "upcoming" | "past" }) {
  if (!rows.length) return <p class="text-center opacity-50 py-8">{t("cash.events.empty")}</p>;
  const today = todayStr();
  const isPast = (r: CashEventRow) => (r.to ?? r.from ?? "9999") < today;
  const needle = search.toLowerCase();
  const shown = rows.filter((r) => r.name.toLowerCase().includes(needle) && (status === "" || (status === "past") === isPast(r)));
  // Anstehende aufsteigend (nächste zuerst), Vergangene wie geliefert absteigend.
  const upcoming = shown.filter((r) => !isPast(r)).reverse();
  const past = shown.filter(isPast);
  const groups = [
    { key: "upcoming", rows: upcoming, border: true },
    { key: "past", rows: past, border: false },
  ].filter((g) => g.rows.length);
  return (
    <>
      <PageSearch label={t("cash.view.events")} value={search} hidden={[["view", "events"], ...(status ? [["status", status] as [string, string]] : [])]} />
      <FilterDialog navbar id="cash-events-filter-dialog" hidden={[["view", "events"], ...(search ? [["search", search] as [string, string]] : [])]} resetHref="/cash?view=events" labels={navFilterLabels()}
        sections={[{ type: "select", param: "status", title: t("cash.events.status.label"), allLabel: t("cash.events.status.all"), selected: status ? [status] : [],
          options: (["upcoming", "past"] as const).map((v) => ({ value: v, label: t(`cash.events.status.${v}`) })) }]} />
      {!groups.length && <p class="text-center opacity-50 py-8">{t("cash.events.noMatch")}</p>}
      {groups.map((g) => (
        <section class="mb-6">
          <h2 class="text-lg font-semibold mb-2">{g.key === "upcoming" ? t("cash.events.group.upcoming") : t("cash.events.group.past")}</h2>
          <div class="overflow-x-auto">
            <table class="table table-zebra table-cards w-full">
              <thead><tr><th>{t("cash.events.name")}</th><th>{t("cash.events.period")}</th><th class="text-right">{t("cash.events.entries")}</th></tr></thead>
              <tbody>
                {g.rows.map((r) => {
                  const running = !!(r.from ?? r.to) && (r.from ?? r.to)! <= today && (r.to ?? r.from)! >= today;
                  return (
                    <tr class="cursor-pointer hover" onclick={`location.href='/cash/events/${r.id}'`}>
                      <td class={`border-l-4 ${running ? "border-l-primary" : "border-l-transparent"}`}>
                        <a href={`/cash/events/${r.id}`} class="link link-hover">{r.name}</a>
                        {running && <span class="badge badge-sm badge-primary badge-outline ml-2">{t("cash.events.running")}</span>}
                        {r.eventId && <span class="badge badge-sm badge-ghost ml-2" title={t("cash.events.linked")}><Icon name="icon-[tabler--calendar-event]" class="h-3 w-3" />{t("cash.events.linkedBadge")}</span>}
                      </td>
                      <td data-label={t("cash.events.period")} data-empty={period(r) ? undefined : ""} class="whitespace-nowrap">{period(r)}</td>
                      <td data-label={t("cash.events.entries")} class="text-right tabular-nums">{r.entries ? <span class="badge badge-sm badge-ghost">{r.entries}</span> : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function EventForm({ id, action, x }: { id: string; action: string; x?: Pick<CashEventRow, "name" | "from" | "to"> }) {
  return (
    <form id={id} method="post" action={action} class="max-w-2xl">
      <Section title={t("cash.events.formSection")} collapsible={false}>
        <div class="flex flex-col gap-4">
          <Field label={t("cash.events.name")} required hint={t("cash.events.nameHint")}><input type="text" name="name" value={x?.name ?? ""} required maxlength={200} autofocus={!x?.name} class="input w-full" /></Field>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t("cash.events.from")}><input type="date" name="from" value={x?.from ?? ""} class="input w-full" /></Field>
            <Field label={t("cash.events.to")}><input type="date" name="to" value={x?.to ?? ""} min={x?.from ?? undefined} class="input w-full" /></Field>
          </div>
          <p class="text-xs opacity-70">{t("cash.events.periodHint")}</p>
        </div>
      </Section>
    </form>
  );
}

// Eingaben nach Fehlern über die Query zurückgeben, damit sie nicht verloren gehen.
const eventDraft = (b: Record<string, unknown>) => new URLSearchParams({ name: trimmed(b, "name") ?? "", from: trimmed(b, "from") ?? "", to: trimmed(b, "to") ?? "" }).toString();
const draftOf = (q: Record<string, string>) => (q.name !== undefined ? { name: q.name, from: q.from || null, to: q.to || null } : undefined);

const findEvent = async (id: string) => (await listCashEvents()).find((r) => r.id === id);

cashRoutes.get("/events/new", manage, (c) => c.html(
  <Layout title={t("cash.events.new")} user={c.get("user")}>
    <PageHeader title={t("cash.events.new")} backHref="/cash?view=events" actions={<FormActions formId="event-form" cancelHref="/cash?view=events" />} />
    <EventForm id="event-form" action="/cash/events" x={draftOf(c.req.query())} />
  </Layout>,
));

cashRoutes.get("/events/:id", read, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const x = await findEvent(id);
  if (!x) return c.redirect("/cash?view=events");
  const editable = hasCash(user.permissions, "manage") && !x.eventId;
  const remove = editable && x.entries === 0 && (
    <form id="event-delete" method="post" action={`/cash/events/${id}/delete`} onsubmit={`return confirm(${JSON.stringify(t("cash.events.confirmDelete"))})`}>
      <HeaderAction icon="icon-[tabler--trash]" label={t("common.delete")} form="event-delete" class="btn-outline btn-error" />
    </form>
  );
  const [sum, { rows: bookings }] = await Promise.all([cashEventSummary(id), listEntries({ cashEventId: id }, 1, 20)]);
  const more = x.entries - bookings.length;
  return c.html(
    <Layout title={x.name} user={user}>
      <PageHeader title={x.name} backHref="/cash?view=events" actions={editable ? <DetailActions editHref={`/cash/events/${id}/edit`} remove={remove} /> : undefined} />
      {x.eventId && <div class="alert alert-info mb-4 max-w-2xl"><Icon name="icon-[tabler--calendar-event]" class="h-5 w-5 shrink-0" /><span>{t("cash.events.linked")} – <a class="link" href={`/events/${x.eventId}`}>{t("cash.events.openEvent")}</a></span></div>}
      <ViewGrid>
        <ViewField label={t("cash.events.name")} value={x.name} />
        <ViewField label={t("cash.events.period")} value={period(x)} hideEmpty />
      </ViewGrid>
      {sum.any && (
        <StatGrid id="cash-event-stats" cols={4}>
          <StatCard label={t("cash.event.income")} value={eur(sum.income)} />
          <StatCard label={t("cash.event.expense")} value={eur(sum.expense)} />
          <StatCard label={t("cash.event.result")} value={eur(sum.result)} tone={sum.result < 0 ? "text-error" : undefined} />
          <StatCard label={t("cash.event.expected")} value={eur(sum.expected)} tone={sum.expected ? "text-warning" : undefined} />
        </StatGrid>
      )}
      {bookings.length > 0 && (
        <Section title={t("cash.events.entries")} badge={String(x.entries)} collapsible={false} actions={<a class="link text-sm" href={`/cash?event=${id}`}>{t("cash.events.showEntries")}</a>}>
          <div class="overflow-x-auto">
            <table class="table table-zebra table-cards w-full">
              <tbody>
                {bookings.map((r) => (
                  <tr key={r.id} class="cursor-pointer hover" onclick={`location.href='/cash/${r.id}'`}>
                    <td data-label={t("cash.table.date")} class="whitespace-nowrap">{formatDate(r.paidDate ?? r.bookingDate)}</td>
                    <td><a href={`/cash/${r.id}`} class="link link-hover">{r.description ?? "—"}</a></td>
                    <td data-label={t("cash.table.amount")} class={`text-right whitespace-nowrap ${r.direction === "income" ? "text-success" : ""}`}>{r.direction === "income" ? "+" : "−"}{eur(r.total)}</td>
                    <td data-label={t("cash.table.status")}><span class={`badge badge-sm ${r.status === "open" ? "badge-warning" : "badge-ghost"}`}>{t(`cash.status.${r.status}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more > 0 && <p class="text-sm opacity-60 mt-2">{t("cash.events.moreEntries", { count: more })}</p>}
        </Section>
      )}
    </Layout>,
  );
});

cashRoutes.get("/events/:id/edit", manage, async (c) => {
  const id = c.req.param("id");
  const x = await findEvent(id);
  if (!x || x.eventId) return c.redirect(`/cash/events/${id}`);
  return c.html(
    <Layout title={t("common.edit")} user={c.get("user")}>
      <PageHeader title={t("cash.events.edit")} subtitle={x.name} backHref="/cash?view=events" actions={<FormActions formId="event-form" cancelHref={`/cash/events/${id}`} />} />
      <EventForm id="event-form" action={`/cash/events/${id}`} x={draftOf(c.req.query()) ?? x} />
    </Layout>,
  );
});

cashRoutes.post("/events", manage, async (c) => {
  const b = await c.req.parseBody();
  try { await createCashEvent({ name: trimmed(b, "name"), from: trimmed(b, "from"), to: trimmed(b, "to") }); setFlash(c, t("cash.events.saved"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); return c.redirect(`/cash/events/new?${eventDraft(b)}`); }
  return c.redirect("/cash?view=events");
});

cashRoutes.post("/events/:id", manage, async (c) => {
  const b = await c.req.parseBody();
  const id = c.req.param("id");
  try { await updateCashEvent(id, { name: trimmed(b, "name"), from: trimmed(b, "from"), to: trimmed(b, "to") }); setFlash(c, t("cash.events.saved"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); return c.redirect(`/cash/events/${id}/edit?${eventDraft(b)}`); }
  return c.redirect(`/cash/events/${id}`);
});

cashRoutes.post("/events/:id/delete", manage, async (c) => {
  try { await deleteCashEvent(c.req.param("id")); setFlash(c, t("cash.events.deleted"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect("/cash?view=events");
});

function TagsView({ tags, usage }: { tags: TagRow[]; usage: Awaited<ReturnType<typeof tagUsage>> }) {
  if (!tags.length) return <p class="text-center opacity-50 py-8">{t("cash.tags.empty")}</p>;
  return (
    <div class="overflow-x-auto">
      <table class="table table-zebra table-cards w-full">
        <thead><tr><th>{t("cash.tags.name")}</th><th>{t("cash.tags.direction")}</th><th class="text-right">{t("cash.tags.usage")}</th><th>{t("cash.tags.status")}</th></tr></thead>
        <tbody>
          {[...tags].sort((a, b) => Number(b.active) - Number(a.active)).map((x) => {
            const u = usage.get(x.id) ?? { income: 0, expense: 0 };
            return (
              <tr class={`cursor-pointer hover ${x.active ? "" : "opacity-60"}`} onclick={`location.href='/cash/tags/${x.id}'`}>
                <td class="whitespace-nowrap">{x.meaning && <span class="mr-1 inline-block align-middle" title={t("cash.tags.system")}><Icon name="icon-[tabler--lock]" class="h-4 w-4" /></span>}<a href={`/cash/tags/${x.id}`} class="link link-hover">{x.name}</a></td>
                <td data-label={t("cash.tags.direction")}><span class="badge badge-ghost badge-sm">{x.direction === "both" ? t("cash.tags.both") : t(`cash.direction.${x.direction as Direction}`)}</span></td>
                <td data-label={t("cash.tags.usage")} class="text-right tabular-nums" title={`${t("cash.direction.income")}: ${u.income} · ${t("cash.direction.expense")}: ${u.expense}`}>{u.income + u.expense || "–"}</td>
                <td data-label={t("cash.tags.status")}><span class="inline-flex items-center gap-2"><span class={`status ${x.active ? "status-success" : "status-neutral"}`} aria-hidden="true" />{x.active ? t("cash.tags.active") : t("cash.tags.inactive")}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Liste ───────────────────────────────────────────────────────────────────

function ReportView({ rep, full, by, prevLabel }: { rep: YearReport; full: boolean; by?: string; prevLabel?: string }) {
  const y = rep.year;
  const row = (label: string, v: number | string, bold = false) => <tr class={bold ? "font-bold" : ""}><td>{label}</td><td class="text-right whitespace-nowrap">{typeof v === "number" ? eur(v) : v}</td></tr>;
  return (
    <div class="print-page max-w-4xl">
      <section class="mb-6">
        <h2 class="text-xl font-semibold mb-1" style="font-family: var(--font-heading)">{t("cash.view.report")} {y.label}{!rep.closed && ` (${t("cash.report.provisional")})`}</h2>
        <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span class="badge badge-ghost">{t("cash.report.period")}: {formatDate(y.startDate)} – {formatDate(y.endDate)}</span>
          <span class="opacity-70">{t(`cash.report.basis.${y.basis as "paid" | "booked"}`)}</span>
        </p>
        {rep.closed && y.closedAt && <p class="text-sm opacity-70 mt-1">{t("cash.report.closedInfo", { date: formatDate(cashDate(y.closedAt)), by: by ?? "–" })}</p>}
        <p class="print-only text-sm">{t("cash.report.printed")} {formatDate(todayStr())}</p>
      </section>
      <table class="table w-full mb-6">
        <tbody>
          {row(t("cash.report.start"), rep.start)}
          {rep.opening !== 0 && row(t("cash.report.opening"), rep.opening)}
          {row(t("cash.report.income"), rep.income)}
          {row(t("cash.report.expense"), rep.expense === 0 ? 0 : -rep.expense)}
          {row(t("cash.report.result"), rep.result, true)}
          {rep.deposits !== 0 && row(t("cash.report.deposits"), rep.deposits)}
          {rep.corrections !== null && row(`${t("cash.report.corrections")}${prevLabel ? ` (${prevLabel})` : ""}`, rep.corrections)}
          {row(t("cash.report.end"), rep.end, true)}
          {row(t("cash.report.open", { date: formatDate(y.endDate < todayStr() ? y.endDate : todayStr()) }), `${rep.open.count} · ${eur(rep.open.total)}`)}
        </tbody>
      </table>
      {rep.lines.length > 0 && (<>
        <h3 class="font-semibold mb-1">{t("cash.report.byTag")}</h3>
        <table class="table w-full mb-1">
          <thead><tr><th>{t("cash.tags.name")}</th><th class="text-right">{t("cash.report.income")}</th><th class="text-right">{t("cash.report.expense")}</th></tr></thead>
          <tbody>{rep.lines.map((l) => <tr><td>{l.name}</td><td class="text-right whitespace-nowrap">{l.income ? eur(l.income) : ""}</td><td class="text-right whitespace-nowrap">{l.expense ? eur(l.expense) : ""}</td></tr>)}</tbody>
        </table>
        <p class="text-xs opacity-60 mb-6">{t("cash.report.byTagHint")}</p>
      </>)}
      {full && rep.entries.length > 0 && (<>
        <h3 class="font-semibold mb-1">{t("cash.report.entries")}</h3>
        <table class="table w-full mb-6">
          <thead><tr><th>{t("cash.table.date")}</th><th>{t("cash.table.description")}</th><th>{t("cash.table.tags")}</th><th class="text-right">{t("cash.table.amount")}</th></tr></thead>
          <tbody>{rep.entries.map((e) => (
            <tr>
              <td class="whitespace-nowrap">{formatDate(e.date)}</td>
              <td>
                {e.description ?? "—"}{e.receiptRef && <span class="text-xs opacity-60 ml-2">{e.receiptRef}</span>}
                {e.donationId && <span class="text-xs opacity-60 ml-2">{t("cash.report.donation")}</span>}
                {e.lendingLoanId && <span class="text-xs opacity-60 ml-2">{t("cash.report.lending")}</span>}
                {e.carriedFrom && <div class="text-xs opacity-60">{t("cash.report.carriedFrom", { label: e.carriedFrom })}</div>}
                {e.correctionOf && <div class="text-xs opacity-60">{t("cash.report.correctionOf", { label: e.correctionOf })}</div>}
              </td>
              <td>{e.tags.join(", ")}</td>
              <td class="text-right whitespace-nowrap">{e.direction === "income" ? "+" : "−"}{eur(e.total)}</td>
            </tr>
          ))}</tbody>
        </table>
      </>)}
      <div class="print-only print-sign"><div>{t("cash.report.signCashier")}</div><div>{t("cash.report.signAuditors")}</div></div>
    </div>
  );
}

function OpenCash({ settings, canManage }: { settings: CashSettings; canManage: boolean }) {
  if (!canManage) return <p class="text-center opacity-50 py-8">{t("cash.error.noYear")}</p>;
  return (
    <section class="max-w-xl">
      <h2 class="text-lg font-semibold mb-2">{t("cash.open.title")}</h2>
      <p class="opacity-70 mb-4">{t("cash.open.body")}</p>
      <form method="post" action="/cash/open" class="flex flex-col gap-4">
        <CashSettingsFields settings={settings} id="cash-open" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("cash.open.date")} required><input type="date" name="date" value={todayStr()} max={todayStr()} class="input w-full" /></Field>
          <Field label={t("cash.open.amount")}><input type="text" inputmode="decimal" name="amount" class="input w-full" placeholder={t("cash.open.amount")} /></Field>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary">{t("cash.open.submit")}</button>
        </div>
      </form>
    </section>
  );
}

cashRoutes.get("/", report, async (c) => {
  const user = c.get("user");
  const perms = user.permissions;
  const canManage = hasCash(perms, "manage");
  const canCancel = hasCash(perms, "cancel");
  const q = c.req.query();
  const settings = await loadCashSettings();
  const years = await listYears();
  const canRead = hasCash(perms, "read");
  // Nur Berichtsrecht: allein der Jahresabschluss. Ansicht "report" erst ab Schritt 8, Tags ab Schritt 6.
  const view = !canRead ? "report" : q.view === "tags" ? "tags" : q.view === "events" ? "events" : q.view === "report" ? "report" : "entries";
  const tagsView = view === "tags";
  const eventsView = view === "events";
  const reportView = view === "report";

  const views: TitleSwitchItem[] = [
    { active: view === "entries", href: "/cash", label: t("cash.view.entries"), icon: "icon-[tabler--list]" },
    { active: reportView, href: "/cash?view=report", label: t("cash.view.report"), icon: "icon-[tabler--report]" },
    { active: tagsView, href: "/cash?view=tags", label: t("cash.view.tags"), icon: "icon-[tabler--tags]" },
    { active: eventsView, href: "/cash?view=events", label: t("cash.view.events"), icon: "icon-[tabler--calendar-event]" },
  ];
  const title = <TitleSwitch items={canRead ? views : views.slice(1, 2)} />;
  const settingsDialog = canManage && (
    <dialog id="cash-settings-dialog" class="modal">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">{t("cash.settings.title")}</h3>
        <CashSettingsForm settings={settings} back="/cash" id="cash-settings-form"
          year={years.at(-1)} next={years.length ? nextYearLabel(settings, years.at(-1)!) : undefined} />
      </div>
      <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
    </dialog>
  );
  const headerActions = (
    <>
      {canManage && years.length > 0 && <HeaderAction icon="icon-[tabler--adjustments-horizontal]" label={t("cash.settingsAction")} class="btn-outline" onclick="document.getElementById('cash-settings-dialog').showModal()" />}
      {canManage && years.length > 0 && !tagsView && <HeaderAction variant="primary" icon="icon-[tabler--plus]" label={eventsView ? t("cash.events.new") : t("cash.newEntry")} href={eventsView ? "/cash/events/new" : "/cash/new"} class="btn-primary" />}
    </>
  );

  if (reportView && years.length) {
    const cur = await currentYear();
    const yid = years.some((y) => y.id === q.year) ? q.year : cur!.id;
    const rep = await yearReport(yid);
    const full = canRead && q.detail === "1";
    const last = rep.closed ? (await yearLog(yid)).find((l) => l.action === "close") : undefined;
    const by = last?.by ? (await db.select({ name: users.name }).from(users).where(eq(users.id, last.by)))[0]?.name : undefined;
    const carry = hasCash(perms, "manage") && !rep.closed ? await carryPreview(yid) : { count: 0, total: 0 };
    const prev = years.filter((y) => y.endDate < rep.year.startDate).at(-1);
    return c.html(
      <Layout title={`${t("cash.view.report")} · ${t("cash.title")}`} user={user}>
        <PageHeader title={canRead ? title : t("cash.view.report")} actions={<>
          <ActionMenu hideLabel="@max-5xl:hidden" items={[
            hasCash(perms, "reopen") && rep.closed && { icon: "icon-[tabler--lock-open]", label: t("cash.report.reopen"), class: "btn-outline", onclick: "document.getElementById('cash-reopen').showModal()" },
            canRead && { icon: "icon-[tabler--download]", label: t("cash.report.csv"), href: `/cash/report.csv?year=${yid}`, class: "btn-outline", attrs: { "data-no-busy": "" } },
            canManage && !rep.closed && { icon: "icon-[tabler--printer]", label: t("cash.report.print"), class: "btn-outline", onclick: "window.print()" },
            canManage && { icon: "icon-[tabler--adjustments-horizontal]", label: t("cash.settingsAction"), class: "btn-outline", onclick: "document.getElementById('cash-settings-dialog').showModal()" },
          ]} />
          {!(canManage && !rep.closed) && <HeaderAction variant="primary" class="btn-primary" icon="icon-[tabler--printer]" label={t("cash.report.print")} onclick="window.print()" />}
          {canManage && !rep.closed && <HeaderAction variant="primary" icon="icon-[tabler--lock]" label={t("cash.report.close")} class="btn-primary" onclick="document.getElementById('cash-close').showModal()" />}
        </>} />
        <div class="no-print bg-base-200 rounded-box p-3 mb-4 mt-3">
          <form method="get" class="flex flex-wrap items-end gap-3">
            <input type="hidden" name="view" value="report" />
            <Field label={t("cash.report.year")} class="w-48">
              <select name="year" class="select w-full" onchange="this.form.submit()">
                {[...years].reverse().map((y) => <option value={y.id} selected={y.id === yid}>{y.label}{y.closedAt ? "" : ` (${t("cash.report.provisional")})`}</option>)}
              </select>
            </Field>
            {canRead && (
              <div class="ml-auto join">
                <a title={t("cash.report.summaryOnly")} class={`btn join-item pointer-coarse:min-h-11 ${full ? "" : "btn-active btn-primary"}`} aria-current={full ? undefined : "true"} href={`?view=report&year=${yid}`}><span class="icon-[tabler--chart-pie] size-4" /><span class="max-md:sr-only">{t("cash.report.summaryOnly")}</span></a>
                <a title={t("cash.report.withEntries")} class={`btn join-item pointer-coarse:min-h-11 ${full ? "btn-active btn-primary" : ""}`} aria-current={full ? "true" : undefined} href={`?view=report&year=${yid}&detail=1`}><span class="icon-[tabler--list-details] size-4" /><span class="max-md:sr-only">{t("cash.report.withEntries")}</span></a>
              </div>
            )}
          </form>
          {canRead && <p class="text-xs opacity-70 mt-2">{t("cash.report.detailHint")}</p>}
        </div>
        {!rep.closed && <div class="alert alert-info mb-4 no-print">{t("cash.report.bannerProvisional")}</div>}
        <ReportView rep={rep} full={full} by={by} prevLabel={prev?.label} />
        {canManage && !rep.closed && (
          <dialog id="cash-close" class="modal"><div class="modal-box">
            <h3 class="font-bold text-lg">{t("cash.report.closeTitle")}</h3>
            <p class="py-2 opacity-70">{t("cash.report.closeBody")}</p>
            <form method="post" action={`/cash/year/${yid}/close`}>
              {carry.count > 0 && <label class="label cursor-pointer justify-start gap-2 whitespace-normal"><input type="checkbox" name="carry" value="1" class="checkbox checkbox-sm" required />{t("cash.report.carryBody", { count: carry.count, total: carry.total.toFixed(2).replace(".", ",") })}</label>}
              <div class="modal-action">
                <button type="button" class="btn" onclick="this.closest('dialog').close()">{t("common.cancel")}</button>
                <button type="submit" class="btn btn-primary">{t("cash.report.close")}</button>
              </div>
            </form>
          </div><form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form></dialog>
        )}
        {rep.closed && hasCash(perms, "reopen") && (
          <dialog id="cash-reopen" class="modal"><div class="modal-box">
            <h3 class="font-bold text-lg">{t("cash.report.reopenTitle")}</h3>
            <form method="post" action={`/cash/year/${yid}/reopen`} class="flex flex-col gap-4 mt-2">
              <Field label={t("cash.report.reason")} required><input type="text" name="reason" required class="input w-full" placeholder={t("cash.report.reason")} /></Field>
              <div class="modal-action">
                <button type="button" class="btn" onclick="this.closest('dialog').close()">{t("common.cancel")}</button>
                <button type="submit" class="btn btn-primary">{t("cash.report.reopen")}</button>
              </div>
            </form>
          </div><form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form></dialog>
        )}
        {settingsDialog}
      </Layout>,
    );
  }

  if (!years.length) {
    return c.html(
      <Layout title={t("cash.title")} user={user}>
        <PageHeader title={t("cash.title")} />
        <OpenCash settings={settings} canManage={canManage} />
      </Layout>,
    );
  }

  if (eventsView) {
    return c.html(
      <Layout title={`${t("cash.view.events")} · ${t("cash.title")}`} user={user}>
        <PageHeader title={title} actions={headerActions} />
        <EventsView rows={await listCashEvents()} search={(q.search ?? "").trim()} status={q.status === "upcoming" || q.status === "past" ? q.status : ""} />
        {settingsDialog}
      </Layout>,
    );
  }

  if (tagsView) {
    return c.html(
      <Layout title={`${t("cash.view.tags")} · ${t("cash.title")}`} user={user}>
        <PageHeader title={title} actions={headerActions} />
        <TagsView tags={(await listTags()) as TagRow[]} usage={await tagUsage()} />
        {settingsDialog}
      </Layout>,
    );
  }

  // Filter
  const today = todayStr();
  const range = parseRange({ ...q, start: q.from, end: q.to }, today, "past", { start: "", end: "" }, undefined, true);
  const status = (STATUSES as readonly string[]).includes(q.status) ? (q.status as (typeof STATUSES)[number]) : undefined;
  const direction: Direction | undefined = q.direction === "income" || q.direction === "expense" ? q.direction : undefined;
  const yearId = years.some((y) => y.id === q.year) ? q.year : "";
  const { page: reqPage, pageSize } = parsePagination(q);
  const filter = { from: range.start || undefined, to: range.end || undefined, yearId: yearId || undefined, direction, tagId: q.tag || undefined, cashEventId: q.event || undefined, status };
  const { rows, total } = await listEntries(filter, reqPage, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(reqPage, totalPages);
  const pageRows = page === reqPage ? rows : (await listEntries(filter, page, pageSize)).rows;

  const cur = await currentYear();
  const [balance, res, openRec, unbooked, tags, evs] = await Promise.all([
    balanceAt(today), cur ? yearResult(cur.id) : null, openReceivablesAt(today),
    canManage ? countUnbookedDonations() : 0, listTags() as Promise<TagRow[]>,
    listCashEvents(),
  ]);
  const state = { pageSize: q.pageSize ? pageSize : undefined, year: yearId, direction, tag: q.tag, event: q.event, status, from: range.start, to: range.end };
  const stateNoRange = { ...state, from: undefined, to: undefined };
  const presets = rangePresets(today, "past", undefined, true);
  const daysOpen = (d: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000));
  const sign = (r: { direction: string }) => (r.direction === "income" ? 1 : -1);

  return c.html(
    <Layout title={t("cash.title")} user={user}>
      <PageHeader title={title} actions={headerActions} />
      <StatGrid id="cash-stats" cols={canManage ? 4 : 3}>
        <StatCard label={t("cash.stats.balance")} value={eur(balance)} />
        <StatCard label={t("cash.stats.result", { label: cur?.label ?? "" })} value={res ? eur(res.result) : "–"} />
        <StatCard label={t("cash.stats.open")} value={openRec.count} tone="text-warning" href={buildListUrl("/cash", { status: "open" })} link="filter">
          <div class="stat-desc text-sm">{eur(openRec.total)}</div>
        </StatCard>
        {canManage && <StatCard label={t("cash.stats.unbooked")} value={unbooked} tone={unbooked ? "text-warning" : undefined} href="/donations" link="view" />}
      </StatGrid>

      <FilterDialog navbar id="cash-filter-dialog" hidden={q.pageSize ? [["pageSize", String(pageSize)]] : []} resetHref="/cash" labels={navFilterLabels()}
        sections={[
          { type: "select", param: "year", title: t("cash.filter.year"), allLabel: t("cash.filter.allYears"), selected: yearId ? [yearId] : [], options: years.map((y) => ({ value: y.id, label: y.label })) },
          { type: "select", param: "direction", title: t("cash.filter.direction"), allLabel: t("cash.filter.allDirections"), selected: direction ? [direction] : [],
            options: (["income", "expense"] as const).map((d) => ({ value: d, label: t(`cash.direction.${d}`) })) },
          { type: "select", param: "tag", title: t("cash.filter.tag"), allLabel: t("cash.filter.allTags"), selected: q.tag ? [q.tag] : [], options: tags.map((x) => ({ value: x.id, label: x.name })) },
          { type: "select", param: "event", title: t("cash.filter.event"), allLabel: t("cash.filter.allEvents"), selected: q.event ? [q.event] : [], options: evs.map((e) => ({ value: e.id, label: e.name })) },
          { type: "custom", param: "range", title: t("filter.quick.label"), selected: range.mode === "default" || (range.mode === "preset" && range.id === "all") ? [] : ["1"], node: (
            <QuickRangeFilter presets={presets} range={range} dir="past" action="/cash" names={{ start: "from", end: "to" }} bare href={(p) => buildListUrl("/cash", stateNoRange, p)} />
          ) },
          { type: "select", param: "status", title: t("cash.filter.status"), allLabel: t("cash.filter.statusAll"), selected: status ? [status] : [], options: STATUSES.map((s) => ({ value: s, label: t(`cash.status.${s}`) })) },
        ]} />

      {pageRows.length === 0 ? (
        <p class="text-center opacity-50 py-8">{t("cash.table.empty")}</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="table table-zebra table-cards w-full">
            <thead><tr>
              <th>{t("cash.table.date")}</th><th>{t("cash.table.description")}</th><th>{t("cash.table.tags")}</th>
              <th class="text-right">{t("cash.table.amount")}</th><th>{t("cash.table.status")}</th>
            </tr></thead>
            <tbody>
              {pageRows.map((r) => {
                const tagNames = [...new Set(r.items.flatMap((i) => i.tags))];
                return (
                  <tr key={r.id} class="cursor-pointer hover" onclick={`location.href='/cash/${r.id}'`}>
                    <td data-label={t("cash.table.date")} class="whitespace-nowrap">
                      {formatDate(r.paidDate ?? r.bookingDate)}
                      {r.originalBookingDate && <div class="text-xs opacity-60">{formatDate(r.originalBookingDate)}</div>}
                    </td>
                    <td>
                      <a href={`/cash/${r.id}`} class="link link-hover">{r.description ?? "—"}</a>
                      {r.receiptRef && <span class="text-xs opacity-60 ml-2">{r.receiptRef}</span>}
                    </td>
                    <td data-label={t("cash.table.tags")} data-empty={!tagNames.length || undefined}>
                      <div class="flex flex-wrap gap-1">{tagNames.map((n) => <span class="badge badge-ghost badge-sm">{n}</span>)}</div>
                    </td>
                    <td data-label={t("cash.table.amount")} class="text-right whitespace-nowrap">{sign(r) < 0 ? "−" : "+"}{eur(r.total)}</td>
                    <td data-label={t("cash.table.status")}>
                      <span class={`badge badge-sm ${r.status === "open" ? "badge-warning" : "badge-ghost"}`}>{r.reversesEntryId ? t("cash.table.correction") : t(`cash.status.${r.status}`)}</span>
                      {r.status === "open" && <div class="text-xs opacity-60">{t("cash.table.openSince", { days: daysOpen(r.bookingDate) })}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager countLabel={t("cash.table.countLabel", { count: total })} page={page} totalPages={totalPages}
        pageUrl={(p) => buildListUrl("/cash", state, { page: p })} pageSize={pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS} pageSizeStorageKey="cash_pageSize" />

      {settingsDialog}
    </Layout>,
  );
});

// ── Abschluss, CSV ──────────────────────────────────────────────────────────

cashRoutes.post("/year/:id/close", manage, async (c) => {
  const body = await c.req.parseBody();
  const id = c.req.param("id");
  try { await closeYear(id, { userId: c.get("user").id, carryOpen: body.carry === "1" }); setFlash(c, t("cash.flash.closed"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(`/cash?view=report&year=${encodeURIComponent(id)}`);
});

cashRoutes.post("/year/:id/reopen", requireAuth("cash:reopen"), async (c) => {
  const body = await c.req.parseBody();
  const id = c.req.param("id");
  try { await reopenYear(id, trimmed(body, "reason"), c.get("user").id); setFlash(c, t("cash.flash.reopened"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(`/cash?view=report&year=${encodeURIComponent(id)}`);
});


cashRoutes.get("/report.csv", read, async (c) => {
  const years = await listYears();
  const y = years.find((x) => x.id === c.req.query("year"));
  if (!y) return c.notFound();
  const rep = await yearReport(y.id);
  const head = [t("cash.csv.date"), t("cash.csv.direction"), t("cash.csv.amount"), t("cash.csv.description"), t("cash.csv.receipt"), t("cash.csv.tags"), t("cash.csv.status"), t("cash.csv.note")];
  const lines = rep.entries.map((e) => [
    e.date, t(`cash.direction.${e.direction}`), (e.direction === "income" ? e.total : -e.total).toFixed(2).replace(".", ","), e.description ?? "", e.receiptRef ?? "", e.tags.join(", "), t(`cash.status.${e.status as "open"}`),
    e.carriedFrom ? t("cash.report.carriedFrom", { label: e.carriedFrom }) : e.correctionOf ? t("cash.report.correctionOf", { label: e.correctionOf }) : "",
  ]);
  const body = "\uFEFF" + [head, ...lines].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="kasse_${y.label.replace(/\s+/g, "_")}.csv"`);
  return c.body(body);
});

// ── Spenden ─────────────────────────────────────────────────────────────────

cashRoutes.post("/donation/:id", manage, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  try { await bookDonation(id, trimmed(body, "paidDate"), c.get("user").id); setFlash(c, t("cash.flash.donationBooked"), "success"); }
  catch (e) { setFlash(c, errText(e), "error"); }
  return c.redirect(`/donations/${id}`);
});

// ── Detailseite ─────────────────────────────────────────────────────────────

cashRoutes.get("/:id", read, async (c) => {
  const user = c.get("user");
  const e = await loadEntry(c.req.param("id"));
  if (!e) return c.redirect("/cash");
  const canManage = hasCash(user.permissions, "manage");
  const canCancel = hasCash(user.permissions, "cancel");
  const [tags, [reversal], [original], [ev], [creator], [canceller]] = await Promise.all([
    listTags(),
    db.select().from(cashEntries).where(eq(cashEntries.reversesEntryId, e.id)),
    e.reversesEntryId ? db.select().from(cashEntries).where(eq(cashEntries.id, e.reversesEntryId)) : [],
    e.cashEventId ? listCashEvents().then((l) => l.filter((x) => x.id === e.cashEventId)) : [],
    e.createdBy ? db.select({ name: users.name }).from(users).where(eq(users.id, e.createdBy)) : [],
    e.cancelledBy ? db.select({ name: users.name }).from(users).where(eq(users.id, e.cancelledBy)) : [],
  ]);
  const tagName = new Map(tags.map((x) => [x.id, x.name]));
  const struck = e.status === "reversed" || e.status === "cancelled";
  const sgn = e.direction === "income" ? "+" : "−";
  const row = (label: string, v: unknown) => v ? <><dt class="opacity-60">{label}</dt><dd>{v}</dd></> : null;
  const today = todayStr();
  const title = e.description?.trim() || t("cash.detail.title");
  return c.html(
    <Layout title={title} user={user}>
      <PageHeader title={title} backHref="/cash" subtitle={<span class={`badge badge-sm ${e.status === "open" ? "badge-warning" : "badge-ghost"}`}>{e.reversesEntryId ? t("cash.table.correction") : t(`cash.status.${e.status}`)}</span>}
        actions={<>
          {canManage && e.status === "open" && <>
            <form method="post" action={`/cash/${e.id}/pay`}><RowAction icon="icon-[tabler--check]" label={t("cash.action.pay")} type="submit" /></form>
            <RowAction icon="icon-[tabler--pencil]" label={t("cash.action.edit")} href={`/cash/${e.id}/edit`} />
            <form method="post" action={`/cash/${e.id}/cancel`} onsubmit={`return confirm(${JSON.stringify(t("cash.action.confirmCancelOpen"))})`}>
              <RowAction icon="icon-[tabler--x]" label={t("cash.action.cancel")} class="btn-outline btn-error" type="submit" />
            </form>
          </>}
          {canCancel && e.status === "booked" && !e.reversesEntryId && (
            <RowAction icon="icon-[tabler--arrow-back-up]" label={t("cash.action.cancel")} class="btn-outline btn-error" onclick="document.getElementById('cash-cancel').showModal()" />
          )}
        </>} />
      {reversal && <div role="alert" class="alert alert-warning mb-4">{t("cash.detail.reversedBy", { date: formatDate(reversal.bookingDate) })} <a class="link" href={`/cash/${reversal.id}`}>{t("cash.detail.open")}</a></div>}
      {original && <div role="alert" class="alert alert-info mb-4">{t("cash.detail.correctionOf", { date: formatDate(original.bookingDate) })} <a class="link" href={`/cash/${original.id}`}>{t("cash.detail.open")}</a></div>}
      {e.status === "cancelled" && <div role="alert" class="alert alert-warning mb-4">{t("cash.detail.cancelled", { date: e.cancelledAt ? formatDate(cashDate(e.cancelledAt)) : "—", user: canceller?.name ?? "—" })}</div>}
      <div class="card bg-base-100 border border-base-300 mb-4"><div class="card-body">
        <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          {row(t("cash.detail.bookingDate"), formatDate(e.bookingDate))}
          {row(t("cash.detail.paidDate"), e.paidDate && formatDate(e.paidDate))}
          {row(t("cash.detail.originalDate"), e.originalBookingDate && formatDate(e.originalBookingDate))}
          {row(t("cash.form.receiptRef"), e.receiptRef)}
          {row(t("cash.form.event"), ev && <a class="link" href={`/cash?event=${ev.id}`}>{ev.name}</a>)}
          {row(t("cash.detail.donation"), e.donationId && <a class="link" href={`/donations/${e.donationId}`}>{t("cash.detail.open")}</a>)}
          {row(t("cash.detail.createdBy"), `${creator?.name ?? "—"}, ${formatDate(cashDate(e.createdAt))}`)}
        </dl>
      </div></div>
      <div class="overflow-x-auto">
        <table class={`table w-full ${struck ? "opacity-60" : ""}`}>
          <thead><tr><th>#</th><th>{t("cash.table.description")}</th><th>{t("cash.table.tags")}</th><th class="text-right">{t("cash.table.amount")}</th></tr></thead>
          <tbody>{e.items.map((i, n) => (
            <tr>
              <td>{n + 1}</td><td>{i.description ?? "—"}</td>
              <td><div class="flex flex-wrap gap-1">{i.tagIds.map((id) => <span class="badge badge-ghost badge-sm">{tagName.get(id) ?? id}</span>)}</div></td>
              <td class={`text-right tabular-nums whitespace-nowrap ${struck ? "line-through" : ""}`}>{sgn}{eur(i.amount)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr class="font-semibold"><td colspan={3}>{t("cash.form.total")}</td><td class="text-right tabular-nums whitespace-nowrap">{sgn}{eur(e.total)}</td></tr></tfoot>
        </table>
      </div>
      {canCancel && e.status === "booked" && !e.reversesEntryId && (
        <dialog id="cash-cancel" class="modal">
          <div class="modal-box">
            <h3 class="font-bold text-lg">{t("cash.cancel.title")}</h3>
            <p class="py-2 opacity-70">{t("cash.cancel.body")}</p>
            <form method="post" action={`/cash/${e.id}/cancel`} class="flex flex-col gap-4">
              <Field label={t("cash.cancel.date")} required><input type="date" name="date" value={today} min={e.paidDate ?? undefined} max={today} class="input w-full" /></Field>
              <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('cash-cancel').close()">{t("common.cancel")}</button>
                <button type="submit" class="btn btn-error">{t("cash.action.cancel")}</button>
              </div>
            </form>
          </div>
          <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
        </dialog>
      )}
    </Layout>,
  );
});
