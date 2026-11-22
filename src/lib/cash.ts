import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { env } from "../env.js";
import {
  cashEntries, cashEntryItems, cashEvents, cashFiscalYears, cashItemTags, cashTags, cashYearLog, events, orgConfig,
} from "../db/schema/index.js";
import { addDays } from "./quick-range.js";
import { now, resolveTimezone, toLocalDate } from "./datetime.js";

// Kassenbuch: Regeln siehe Backlog 180. Alle Schreibfunktionen laufen in einer Transaktion
// unter einem Advisory-Lock (Kasse ist klein, ein Schreiber zur Zeit schützt Jahresanhängen,
// Abschluss und Invarianten gleichermaßen). `exec` erlaubt, in einer fremden Transaktion aufzurufen.

type Db = typeof db;
type Exec = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
type Year = typeof cashFiscalYears.$inferSelect;
type Tag = typeof cashTags.$inferSelect;
export type Basis = "paid" | "booked";
export type Direction = "income" | "expense";
export type FiscalMode = "calendar" | "anniversary" | "custom";
export type CashSettings = { mode: FiscalMode; cutoff: string; basis: Basis };

export class CashError extends Error {
  constructor(public code: string, public data?: Record<string, unknown>) { super(code); }
}

// Datum (YYYY-MM-DD) eines Zeitpunkts in der App-Zone; "heute" der Kasse. en-CA liefert ISO-Format.
export const cashDate = (d: Date = now()): string => new Intl.DateTimeFormat("en-CA", { timeZone: resolveTimezone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const todayStr = () => cashDate();

const LOCK_KEY = 180_001;
const FUTURE_BOOKING_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

async function locked<T>(exec: Exec, fn: (x: Exec) => Promise<T>): Promise<T> {
  return exec.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    return fn(tx);
  });
}

// ---------- Einstellungen ----------

export function validCutoff(v: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  // 2001 ist kein Schaltjahr: "02-29" fällt damit heraus.
  const dt = new Date(2001, mo - 1, d);
  return dt.getMonth() === mo - 1 && dt.getDate() === d;
}

export function validateSettings(s: CashSettings): CashSettings {
  if (!["calendar", "anniversary", "custom"].includes(s.mode)) throw new CashError("invalidMode");
  if (!["paid", "booked"].includes(s.basis)) throw new CashError("invalidBasis");
  if (s.mode === "custom" && !validCutoff(s.cutoff)) throw new CashError("invalidCutoff");
  return s;
}

export async function loadCashSettings(exec: Exec = db): Promise<CashSettings> {
  const rows = await exec.select().from(orgConfig);
  const c = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const mode = (["calendar", "anniversary", "custom"] as const).find((m) => m === c.cashFiscalYearMode) ?? "calendar";
  const basis = c.cashFiscalYearBasis === "booked" ? "booked" : "paid";
  return { mode, basis, cutoff: c.cashFiscalYearCutoff ?? "" };
}

export async function saveCashSettings(s: CashSettings, exec: Exec = db): Promise<void> {
  validateSettings(s);
  const entries = { cashFiscalYearMode: s.mode, cashFiscalYearCutoff: s.mode === "custom" ? s.cutoff : "", cashFiscalYearBasis: s.basis };
  for (const [key, value] of Object.entries(entries)) {
    await exec.insert(orgConfig).values({ key, value }).onConflictDoUpdate({ target: orgConfig.key, set: { value } });
  }
}

const cutoffOf = (s: CashSettings) => (s.mode === "calendar" ? "12-31" : s.mode === "anniversary" ? env.ANNIVERSARY_CUTOFF : s.cutoff);

// ---------- Geschäftsjahre ----------

// Erster Stichtag (MM-TT) am oder nach `start`.
export function yearEnd(start: string, cutoff: string): string {
  const y = Number(start.slice(0, 4));
  const at = (yy: number) => `${yy}-${cutoff}`;
  return at(y) >= start ? at(y) : at(y + 1);
}

export const yearLabel = (end: string) => end.slice(0, 4);

const yearAt = async (x: Exec, date: string) =>
  (await x.select().from(cashFiscalYears).where(sql`${cashFiscalYears.startDate} <= ${date} AND ${cashFiscalYears.endDate} >= ${date}`))[0] as Year | undefined;

const lastYear = async (x: Exec) =>
  (await x.select().from(cashFiscalYears).orderBy(desc(cashFiscalYears.endDate)).limit(1))[0] as Year | undefined;

export async function listYears(exec: Exec = db): Promise<Year[]> {
  return exec.select().from(cashFiscalYears).orderBy(asc(cashFiscalYears.startDate));
}

async function insertYear(x: Exec, start: string, s: CashSettings): Promise<Year> {
  const end = yearEnd(start, cutoffOf(s));
  const [y] = await x.insert(cashFiscalYears).values({ startDate: start, endDate: end, label: yearLabel(end), basis: s.basis }).returning();
  return y;
}

const openEntries = (x: Exec, before: string) =>
  x.select({ id: cashEntries.id, bookingDate: cashEntries.bookingDate, originalBookingDate: cashEntries.originalBookingDate, total: cashEntries.total })
    .from(cashEntries)
    .where(sql`${cashEntries.status} = 'open' AND ${cashEntries.bookingDate} < ${before}`);

// Schiebt offene Einträge auf den ersten Tag des Folgejahres, altes Datum bleibt erhalten.
async function carryOver(x: Exec, rows: { id: string }[], newDate: string) {
  if (!rows.length) return;
  await x.update(cashEntries).set({
    originalBookingDate: sql`COALESCE(${cashEntries.originalBookingDate}, ${cashEntries.bookingDate})`,
    bookingDate: newDate,
  }).where(inArray(cashEntries.id, rows.map((r) => r.id)));
}

// Hängt das nächste Jahr an. Basiswechsel paid → booked braucht Bestätigung, sonst würden offene Altposten nie gezählt.
async function appendYear(x: Exec, last: Year, s: CashSettings, confirmCarry: boolean): Promise<Year> {
  const start = addDays(last.endDate, 1);
  if (s.basis === "booked" && last.basis === "paid") {
    const stale = await openEntries(x, start);
    if (stale.length) {
      if (!confirmCarry) throw new CashError("basisChange", { count: stale.length, total: money(stale.reduce((a, r) => a + Number(r.total), 0)) });
      await carryOver(x, stale, start);
    }
  }
  return insertYear(x, start, s);
}

// Jahr zu einem Datum; hängt fehlende Jahre an (auch leere dazwischen).
async function ensureYear(x: Exec, date: string, s: CashSettings, confirmCarry = false): Promise<Year> {
  const found = await yearAt(x, date);
  if (found) return found;
  let last = await lastYear(x);
  if (!last) throw new CashError("noYear");
  if (date < last.startDate) throw new CashError("beforeStart");
  while (date > last.endDate) last = await appendYear(x, last, s, confirmCarry);
  return last;
}

// Invariante: jedes zählende Datum liegt in einem nicht abgeschlossenen Jahr.
async function assertOpenYear(x: Exec, date: string, s: CashSettings, confirmCarry = false) {
  const y = await ensureYear(x, date, s, confirmCarry);
  if (y.closedAt) throw new CashError("yearClosed", { label: y.label });
  return y;
}

async function basisAt(x: Exec, date: string, s: CashSettings): Promise<Basis> {
  return ((await yearAt(x, date))?.basis as Basis | undefined) ?? s.basis;
}

// Erstes Jahr: freier Start. Nur solange es noch kein Jahr gibt.
async function createFirstYear(x: Exec, date: string, s: CashSettings): Promise<Year> {
  if (!DATE_RE.test(date)) throw new CashError("invalidDate");
  if (date > todayStr()) throw new CashError("future");
  if (await lastYear(x)) throw new CashError("alreadyStarted");
  return insertYear(x, date, s);
}

export function startWithZero(date: string, exec: Db = db): Promise<Year> {
  return locked(exec, async (x) => createFirstYear(x, date, await loadCashSettings(x)));
}

// ---------- Tags ----------

export const tagMeaning = async (x: Exec, meaning: NonNullable<Tag["meaning"]>) =>
  (await x.select().from(cashTags).where(eq(cashTags.meaning, meaning)))[0] as Tag;

// ---------- Buchungen ----------

export type ItemInput = { amount: string | number; description?: string | null; tagIds: string[] };
export type EntryInput = {
  direction: Direction;
  bookingDate: string;
  paid: boolean;
  paidDate?: string | null; // Standard: heute
  description?: string | null;
  receiptRef?: string | null;
  eventRef?: string | null; // "e:<Termin-ID>" | "c:<Veranstaltungs-ID>" | leer
  items: ItemInput[];
  source?: { donationId?: string; lendingLoanId?: string; sourceRole?: "receivable" | "refund" | "retention" };
};
type Ctx = { userId?: string | null; confirmCarry?: boolean };

async function validateItems(x: Exec, direction: Direction, items: ItemInput[]) {
  if (!items.length) throw new CashError("noItems");
  const ids = [...new Set(items.flatMap((i) => i.tagIds))];
  const tags = ids.length ? await x.select().from(cashTags).where(inArray(cashTags.id, ids)) : [];
  const byId = new Map(tags.map((t) => [t.id, t]));
  for (const it of items) {
    if (!(money(it.amount) > 0)) throw new CashError("invalidAmount");
    if (!it.tagIds.length) throw new CashError("noTag");
    const ts = it.tagIds.map((id) => byId.get(id));
    if (ts.some((t) => !t)) throw new CashError("unknownTag");
    for (const t of ts as Tag[]) {
      if (!t.active) throw new CashError("inactiveTag", { name: t.name });
      if (t.direction !== "both" && t.direction !== direction) throw new CashError("tagDirection", { name: t.name });
      if ((t.meaning === "opening" || t.meaning === "deposit") && it.tagIds.length > 1) throw new CashError("exclusiveTag", { name: t.name });
    }
  }
}

async function writeItems(x: Exec, entryId: string, items: ItemInput[]) {
  for (const it of items) {
    const [row] = await x.insert(cashEntryItems).values({ entryId, amount: money(it.amount).toFixed(2), description: it.description?.trim() || null }).returning();
    await x.insert(cashItemTags).values([...new Set(it.tagIds)].map((tagId) => ({ itemId: row.id, tagId })));
  }
  const total = items.reduce((a, i) => a + money(i.amount), 0);
  await x.update(cashEntries).set({ total: total.toFixed(2) }).where(eq(cashEntries.id, entryId));
}

async function checkDates(x: Exec, i: Pick<EntryInput, "bookingDate" | "paid" | "paidDate">, s: CashSettings, confirmCarry: boolean) {
  const today = todayStr();
  if (!DATE_RE.test(i.bookingDate)) throw new CashError("invalidDate");
  if (i.bookingDate > addDays(today, FUTURE_BOOKING_DAYS)) throw new CashError("future");
  if (i.paid) {
    const paidDate = i.paidDate || today;
    if (!DATE_RE.test(paidDate)) throw new CashError("invalidDate");
    if (paidDate > today) throw new CashError("future");
    if (paidDate < i.bookingDate) throw new CashError("beforeBooking");
    await assertOpenYear(x, paidDate, s, confirmCarry);
  }
  if ((await basisAt(x, i.bookingDate, s)) === "booked") await assertOpenYear(x, i.bookingDate, s, confirmCarry);
}

const isUnique = (e: any) => e?.code === "23505" || e?.cause?.code === "23505";

export function createEntry(input: EntryInput, ctx: Ctx = {}, exec: Exec = db) {
  return locked(exec, async (x) => {
    const s = await loadCashSettings(x);
    await validateItems(x, input.direction, input.items);
    await checkDates(x, input, s, !!ctx.confirmCarry);
    try {
      const [e] = await x.insert(cashEntries).values({
        direction: input.direction,
        bookingDate: input.bookingDate,
        paidDate: input.paid ? input.paidDate || todayStr() : null,
        status: input.paid ? "booked" : "open",
        description: input.description?.trim() || null,
        receiptRef: input.receiptRef?.trim() || null,
        cashEventId: await resolveCashEvent(x, input.eventRef),
        createdBy: ctx.userId ?? null,
        ...input.source,
      }).returning();
      await writeItems(x, e.id, input.items);
      return e.id;
    } catch (err) {
      if (isUnique(err)) throw new CashError("duplicate");
      throw err;
    }
  });
}

// Nur offene Einträge sind bearbeitbar; Quelle und Status bleiben.
export function updateOpenEntry(id: string, input: Omit<EntryInput, "paid" | "paidDate" | "source">, ctx: Ctx = {}, exec: Exec = db) {
  return locked(exec, async (x) => {
    const [e] = await x.select().from(cashEntries).where(eq(cashEntries.id, id));
    if (!e) throw new CashError("notFound");
    if (e.status !== "open") throw new CashError("notOpen");
    const s = await loadCashSettings(x);
    await validateItems(x, input.direction, input.items);
    await checkDates(x, { ...input, paid: false }, s, !!ctx.confirmCarry);
    await x.update(cashEntries).set({
      direction: input.direction, bookingDate: input.bookingDate, originalBookingDate: null,
      description: input.description?.trim() || null, receiptRef: input.receiptRef?.trim() || null, cashEventId: await resolveCashEvent(x, input.eventRef),
    }).where(eq(cashEntries.id, id));
    await x.delete(cashEntryItems).where(eq(cashEntryItems.entryId, id));
    await writeItems(x, id, input.items);
  });
}

export function payEntry(id: string, paidDate?: string | null, exec: Exec = db) {
  return locked(exec, async (x) => {
    const [e] = await x.select().from(cashEntries).where(eq(cashEntries.id, id));
    if (!e) throw new CashError("notFound");
    if (e.status !== "open") throw new CashError("notOpen");
    const s = await loadCashSettings(x);
    const date = paidDate || todayStr();
    await checkDates(x, { bookingDate: e.bookingDate, paid: true, paidDate: date }, s, false);
    await x.update(cashEntries).set({ status: "booked", paidDate: date }).where(eq(cashEntries.id, id));
  });
}

// Ein Button "Stornieren": offen → cancelled (immer erlaubt), gebucht → Stornobuchung + Original reversed.
export function cancelEntry(id: string, opts: { date?: string | null; userId?: string | null } = {}, exec: Exec = db) {
  return locked(exec, async (x) => {
    const [e] = await x.select().from(cashEntries).where(eq(cashEntries.id, id));
    if (!e) throw new CashError("notFound");
    if (e.status === "open") {
      await x.update(cashEntries).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: opts.userId ?? null }).where(eq(cashEntries.id, id));
      return { kind: "cancelled" as const, id };
    }
    if (e.status !== "booked" || e.reversesEntryId) throw new CashError("notCancellable");
    const date = opts.date || todayStr();
    if (!DATE_RE.test(date)) throw new CashError("invalidDate");
    if (date > todayStr()) throw new CashError("future");
    if (date < e.paidDate!) throw new CashError("beforePaid");
    const s = await loadCashSettings(x);
    await assertOpenYear(x, date, s);
    const items = await x.select().from(cashEntryItems).where(eq(cashEntryItems.entryId, id));
    const links = items.length ? await x.select().from(cashItemTags).where(inArray(cashItemTags.itemId, items.map((i) => i.id))) : [];
    const [r] = await x.insert(cashEntries).values({
      direction: e.direction === "income" ? "expense" : "income",
      bookingDate: date, paidDate: date, status: "booked", reversesEntryId: id,
      description: `Korrektur zu ${e.description?.trim() || e.id}`, cashEventId: e.cashEventId, createdBy: opts.userId ?? null,
    }).returning();
    for (const it of items) {
      const [ni] = await x.insert(cashEntryItems).values({ entryId: r.id, amount: it.amount, description: it.description }).returning();
      const tagIds = links.filter((l) => l.itemId === it.id).map((l) => l.tagId);
      if (tagIds.length) await x.insert(cashItemTags).values(tagIds.map((tagId) => ({ itemId: ni.id, tagId })));
    }
    await x.update(cashEntries).set({ total: e.total }).where(eq(cashEntries.id, r.id));
    await x.update(cashEntries).set({ status: "reversed" }).where(eq(cashEntries.id, id));
    return { kind: "reversed" as const, id: r.id };
  });
}

// Eröffnungsbuchung: legt das erste Geschäftsjahr an, Start = Datum der Buchung.
export function openCash(amount: string | number, date: string, ctx: Ctx = {}, exec: Db = db) {
  return locked(exec, async (x) => {
    const s = await loadCashSettings(x);
    await createFirstYear(x, date, s);
    const tag = await tagMeaning(x, "opening");
    return createEntry({ direction: "income", bookingDate: date, paid: true, paidDate: date, description: "Anfangsbestand", items: [{ amount, tagIds: [tag.id] }] }, ctx, x);
  });
}

// ---------- Auswertung ----------

const SIGNED = sql`CASE WHEN ${cashEntries.direction} = 'income' THEN ${cashEntryItems.amount} ELSE -${cashEntryItems.amount} END`;

// Kassenstand: Σ Positionen gebuchter/stornierter Einträge bis Stichtag, in jedem Modus.
export async function balanceAt(asOf: string = todayStr(), exec: Exec = db): Promise<number> {
  const [r] = await exec.select({ v: sql<string>`COALESCE(SUM(${SIGNED}), 0)` }).from(cashEntryItems)
    .innerJoin(cashEntries, eq(cashEntries.id, cashEntryItems.entryId))
    .where(sql`${cashEntries.status} IN ('booked','reversed') AND ${cashEntries.paidDate} <= ${asOf}`);
  return money(r.v);
}

export type OpenReceivables = { count: number; total: number };

// Offene Forderungen zum Stichtag; abgeschlossene Jahre liefern ihre eingefrorenen Werte (siehe closeYear).
export async function openReceivablesAt(asOf: string, exec: Exec = db): Promise<OpenReceivables> {
  const [r] = await exec.select({ n: sql<number>`COUNT(*)::int`, v: sql<string>`COALESCE(SUM(${cashEntries.total}), 0)` }).from(cashEntries)
    .where(sql`${cashEntries.reversesEntryId} IS NULL
      AND COALESCE(${cashEntries.originalBookingDate}, ${cashEntries.bookingDate}) <= ${asOf}
      AND (${cashEntries.paidDate} IS NULL OR ${cashEntries.paidDate} > ${asOf})
      AND (${cashEntries.cancelledAt} IS NULL OR (${cashEntries.cancelledAt} AT TIME ZONE ${resolveTimezone()})::date > ${asOf})`);
  return { count: r.n, total: money(r.v) };
}

export type YearResult = { income: number; expense: number; result: number; opening: number; deposit: number };

// Ergebnis eines Jahres nach dessen Basis. opening/deposit zählen nur im Saldo, nicht im Ergebnis.
export async function yearResult(yearId: string, exec: Exec = db): Promise<YearResult> {
  const [y] = await exec.select().from(cashFiscalYears).where(eq(cashFiscalYears.id, yearId));
  if (!y) throw new CashError("notFound");
  const cond = y.basis === "paid"
    ? sql`e.status IN ('booked','reversed') AND e.paid_date BETWEEN ${y.startDate} AND ${y.endDate}`
    : sql`e.status <> 'cancelled' AND e.booking_date BETWEEN ${y.startDate} AND ${y.endDate}`;
  const { rows } = await exec.execute<{ kind: string; direction: string; total: string }>(sql`
    SELECT COALESCE(m.meaning::text, 'regular') AS kind, e.direction::text AS direction, SUM(i.amount) AS total
    FROM cash_entry_items i JOIN cash_entries e ON e.id = i.entry_id
    LEFT JOIN LATERAL (SELECT t.meaning FROM cash_item_tags it JOIN cash_tags t ON t.id = it.tag_id
      WHERE it.item_id = i.id AND t.meaning IN ('opening','deposit') LIMIT 1) m ON true
    WHERE ${cond} GROUP BY 1, 2`);
  const sum = (kind: string, dir?: string) => money(rows.filter((r) => r.kind === kind && (!dir || r.direction === dir)).reduce((a, r) => a + Number(r.total), 0));
  const signed = (kind: string) => sum(kind, "income") - sum(kind, "expense");
  const income = sum("regular", "income"), expense = sum("regular", "expense");
  return { income, expense, result: money(income - expense), opening: money(signed("opening")), deposit: money(signed("deposit")) };
}

// ---------- Abschluss / Wiederöffnung ----------

export function closeYear(yearId: string, opts: { userId?: string | null; carryOpen?: boolean } = {}, exec: Db = db) {
  return locked(exec, async (x) => {
    const [y] = await x.select().from(cashFiscalYears).where(eq(cashFiscalYears.id, yearId));
    if (!y) throw new CashError("notFound");
    if (y.closedAt) throw new CashError("alreadyClosed");
    if (todayStr() < addDays(y.endDate, 1)) throw new CashError("tooEarly");
    const [prev] = await x.select().from(cashFiscalYears).where(sql`${cashFiscalYears.endDate} < ${y.startDate}`).orderBy(desc(cashFiscalYears.endDate)).limit(1);
    if (prev && !prev.closedAt) throw new CashError("previousOpen", { label: prev.label });

    let carried = 0;
    if (y.basis === "booked") {
      const open = await openEntries(x, addDays(y.endDate, 1));
      if (open.length) {
        if (!opts.carryOpen) throw new CashError("openEntries", { count: open.length, total: money(open.reduce((a, r) => a + Number(r.total), 0)) });
        const next = await ensureYear(x, addDays(y.endDate, 1), await loadCashSettings(x), true);
        await carryOver(x, open, next.startDate);
        carried = open.length;
      }
    }
    const endBalance = await balanceAt(y.endDate, x);
    const open = await openReceivablesAt(y.endDate, x);
    const frozen = { endBalance: endBalance.toFixed(2), openCount: open.count, openTotal: open.total.toFixed(2) };
    await x.update(cashFiscalYears).set({ ...frozen, closedAt: new Date() }).where(eq(cashFiscalYears.id, yearId));
    await x.insert(cashYearLog).values({ yearId, action: "close", by: opts.userId ?? null, carriedCount: carried, ...frozen });
    return { endBalance, ...open, carried };
  });
}

export function reopenYear(yearId: string, reason: string, userId?: string | null, exec: Db = db) {
  return locked(exec, async (x) => {
    if (!reason?.trim()) throw new CashError("reasonRequired");
    const [y] = await x.select().from(cashFiscalYears).where(eq(cashFiscalYears.id, yearId));
    if (!y) throw new CashError("notFound");
    if (!y.closedAt) throw new CashError("notClosed");
    const [next] = await x.select().from(cashFiscalYears).where(sql`${cashFiscalYears.startDate} > ${y.endDate}`).orderBy(asc(cashFiscalYears.startDate)).limit(1);
    if (next?.closedAt) throw new CashError("nextClosed", { label: next.label });
    await x.insert(cashYearLog).values({
      yearId, action: "reopen", by: userId ?? null, reason: reason.trim(),
      endBalance: y.endBalance, openCount: y.openCount, openTotal: y.openTotal,
    });
    await x.update(cashFiscalYears).set({ closedAt: null, endBalance: null, openCount: null, openTotal: null }).where(eq(cashFiscalYears.id, yearId));
  });
}

// ---------- Tag-Eingabe ----------

// Chip-Werte aus dem Formular: Tag-id oder `new:<Richtung>:<Name>`. Legt neue Tags an (Name global eindeutig,
// ohne Groß-/Kleinschreibung); existiert der Name mit anderer Richtung, Fehler statt Duplikat.
export async function resolveTagChips(values: string[], userId?: string | null, exec: Exec = db): Promise<string[]> {
  const ids: string[] = [];
  for (const v of values) {
    const m = /^new:(income|expense):(.+)$/s.exec(v);
    if (!m) { ids.push(v); continue; }
    const name = m[2].trim();
    const [hit] = await exec.select().from(cashTags).where(sql`lower(${cashTags.name}) = lower(${name})`);
    if (hit) {
      if (hit.direction !== "both" && hit.direction !== m[1]) throw new CashError("tagDirection", { name: hit.name });
      ids.push(hit.id);
      continue;
    }
    const [row] = await exec.insert(cashTags).values({ name, direction: m[1] as Direction, createdBy: userId ?? null }).returning();
    ids.push(row.id);
  }
  return ids;
}

// ---------- Rechte ----------

// cash:manage schließt read (und report) ein, read schließt report ein; manage schließt cancel/lending ein.
export type CashLevel = "report" | "read" | "manage" | "cancel" | "lending" | "reopen";
const IMPLIED: Record<CashLevel, string[]> = {
  report: ["cash:report", "cash:read", "cash:manage"],
  read: ["cash:read", "cash:manage"],
  manage: ["cash:manage"],
  cancel: ["cash:cancel", "cash:manage"],
  lending: ["cash:lending", "cash:manage"],
  reopen: ["cash:reopen"], // bewusst nicht von manage eingeschlossen (Vier-Augen-Hürde)
};
export const cashPerms = (level: CashLevel) => IMPLIED[level] as never[];
export const hasCash = (perms: Set<string>, level: CashLevel) => IMPLIED[level].some((p) => perms.has(p));

// ---------- Listen und Zähler ----------

export type EntryFilter = {
  from?: string; to?: string; yearId?: string; direction?: Direction; tagId?: string; cashEventId?: string;
  status?: "open" | "booked" | "reversed" | "cancelled";
};

export async function listEntries(f: EntryFilter, page: number, pageSize: number, exec: Exec = db) {
  const conds = [sql`TRUE`];
  const day = sql`COALESCE(${cashEntries.paidDate}, ${cashEntries.bookingDate})`;
  if (f.yearId) {
    const [y] = await exec.select().from(cashFiscalYears).where(eq(cashFiscalYears.id, f.yearId));
    if (y) conds.push(sql`${day} BETWEEN ${y.startDate} AND ${y.endDate}`);
  }
  if (f.from) conds.push(sql`${cashEntries.bookingDate} >= ${f.from}`);
  if (f.to) conds.push(sql`${cashEntries.bookingDate} <= ${f.to}`);
  if (f.direction) conds.push(sql`${cashEntries.direction} = ${f.direction}`);
  if (f.status) conds.push(sql`${cashEntries.status} = ${f.status}`);
  if (f.cashEventId) conds.push(sql`${cashEntries.cashEventId} = ${f.cashEventId}`);
  if (f.tagId) conds.push(sql`EXISTS (SELECT 1 FROM cash_entry_items i JOIN cash_item_tags it ON it.item_id = i.id WHERE i.entry_id = ${cashEntries.id} AND it.tag_id = ${f.tagId})`);
  const where = and(...conds);
  const [{ n }] = await exec.select({ n: sql<number>`COUNT(*)::int` }).from(cashEntries).where(where);
  const entries = await exec.select().from(cashEntries).where(where)
    .orderBy(desc(cashEntries.bookingDate), desc(cashEntries.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const ids = entries.map((e) => e.id);
  const items = ids.length ? await exec.select().from(cashEntryItems).where(inArray(cashEntryItems.entryId, ids)) : [];
  const links = items.length
    ? await exec.select({ itemId: cashItemTags.itemId, name: cashTags.name }).from(cashItemTags).innerJoin(cashTags, eq(cashTags.id, cashItemTags.tagId)).where(inArray(cashItemTags.itemId, items.map((i) => i.id)))
    : [];
  return {
    total: n,
    rows: entries.map((e) => ({
      ...e,
      items: items.filter((i) => i.entryId === e.id).map((i) => ({ ...i, tags: links.filter((l) => l.itemId === i.id).map((l) => l.name) })),
    })),
  };
}

export async function loadEntry(id: string, exec: Exec = db) {
  const [e] = await exec.select().from(cashEntries).where(eq(cashEntries.id, id));
  if (!e) return undefined;
  const items = await exec.select().from(cashEntryItems).where(eq(cashEntryItems.entryId, id));
  const links = items.length ? await exec.select().from(cashItemTags).where(inArray(cashItemTags.itemId, items.map((i) => i.id))) : [];
  return { ...e, items: items.map((i) => ({ ...i, tagIds: links.filter((l) => l.itemId === i.id).map((l) => l.tagId) })) };
}

export const listTags = (exec: Exec = db) => exec.select().from(cashTags).orderBy(asc(cashTags.name));

// Spenden ohne Eintrag (open/booked) in der Kasse.
export async function countUnbookedDonations(exec: Exec = db): Promise<number> {
  const { rows } = await exec.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM donations d
    WHERE NOT EXISTS (SELECT 1 FROM cash_entries e WHERE e.donation_id = d.id AND e.status IN ('open','booked'))`);
  return rows[0].n;
}

export async function countOpenEntries(exec: Exec = db): Promise<number> {
  const [r] = await exec.select({ n: sql<number>`COUNT(*)::int` }).from(cashEntries).where(eq(cashEntries.status, "open"));
  return r.n;
}

export async function currentYear(exec: Exec = db): Promise<Year | undefined> {
  return (await yearAt(exec, todayStr())) ?? (await lastYear(exec));
}

// ---------- Tag-Verwaltung ----------

export type TagPatch = { name?: string; active?: boolean; direction?: "income" | "expense" | "both" };

// Verwendungen je Tag und Richtung der Originalbuchung (Stornobuchungen zählen nicht).
export async function tagUsage(exec: Exec = db) {
  const { rows } = await exec.execute<{ tag_id: string; direction: string; n: number }>(sql`
    SELECT it.tag_id, e.direction::text AS direction, COUNT(*)::int AS n
    FROM cash_item_tags it JOIN cash_entry_items i ON i.id = it.item_id JOIN cash_entries e ON e.id = i.entry_id
    WHERE e.reverses_entry_id IS NULL GROUP BY 1, 2`);
  const map = new Map<string, { income: number; expense: number }>();
  for (const r of rows) {
    const u = map.get(r.tag_id) ?? { income: 0, expense: 0 };
    u[r.direction as Direction] = r.n;
    map.set(r.tag_id, u);
  }
  return map;
}

export function updateTag(id: string, patch: TagPatch, exec: Db = db) {
  return locked(exec, async (x) => {
    const [tag] = await x.select().from(cashTags).where(eq(cashTags.id, id));
    if (!tag) throw new CashError("notFound");
    const set: Partial<typeof cashTags.$inferInsert> = {};
    if (tag.meaning && (patch.name !== undefined || patch.direction !== undefined || patch.active === false)) throw new CashError("fixedTag");
    if (patch.name !== undefined && patch.name.trim() !== tag.name) {
      const name = patch.name.trim();
      if (!name) throw new CashError("nameRequired");
      const [dup] = await x.select().from(cashTags).where(sql`lower(${cashTags.name}) = lower(${name}) AND ${cashTags.id} <> ${id}`);
      if (dup) throw new CashError("nameTaken", { name });
      set.name = name;
    }
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.direction && patch.direction !== tag.direction) {
      const u = (await tagUsage(x)).get(id) ?? { income: 0, expense: 0 };
      const used = u.income + u.expense > 0;
      const widen = patch.direction === "both";
      // Gesperrt, sobald verwendet; Erweiterung auf "both" bleibt erlaubt, Verengung nur ohne Gegenrichtung.
      if (used && !widen && u[patch.direction === "income" ? "expense" : "income"] > 0) throw new CashError("tagLocked");
      if (used && !widen && tag.direction !== "both") throw new CashError("tagLocked");
      set.direction = patch.direction;
    }
    if (Object.keys(set).length) await x.update(cashTags).set(set).where(eq(cashTags.id, id));
  });
}

// Bezeichnung des Jahres, das mit der aktuellen Einstellung als nächstes entsteht.
export function nextYearLabel(s: CashSettings, last: { endDate: string }): string {
  return yearLabel(yearEnd(addDays(last.endDate, 1), cutoffOf(s)));
}

// Menüzähler: offene Forderungen plus Spenden ohne Kassenbuchung.
export async function countCashAttention(exec: Exec = db): Promise<number> {
  return (await countOpenEntries(exec)) + (await countUnbookedDonations(exec));
}

// ---------- Jahresabschluss (Bericht) ----------

export type ReportLine = { name: string; income: number; expense: number };
export type ReportEntry = {
  id: string; date: string; direction: Direction; description: string | null; receiptRef: string | null; total: number; status: string;
  tags: string[]; donationId: string | null; lendingLoanId: string | null; carriedFrom: string | null; correctionOf: string | null;
};
export type YearReport = {
  year: Year; closed: boolean;
  start: number; opening: number; income: number; expense: number; result: number; deposits: number; end: number;
  open: OpenReceivables; corrections: number | null; lines: ReportLine[]; entries: ReportEntry[];
};

// Eine Auswertung für beide Druckfassungen; `entries` enthält Einzelbuchungen und wird nur mit cash:read angezeigt.
export async function yearReport(yearId: string, exec: Exec = db): Promise<YearReport> {
  const [year] = await exec.select().from(cashFiscalYears).where(eq(cashFiscalYears.id, yearId));
  if (!year) throw new CashError("notFound");
  const years = await listYears(exec);
  const labelAt = (d: string) => years.find((y) => y.startDate <= d && d <= y.endDate)?.label ?? null;
  const dateCol = year.basis === "paid" ? cashEntries.paidDate : cashEntries.bookingDate;
  const statusCond = year.basis === "paid" ? sql`${cashEntries.status} IN ('booked','reversed')` : sql`${cashEntries.status} <> 'cancelled'`;
  const entries = await exec.select().from(cashEntries).where(sql`${statusCond} AND ${dateCol} BETWEEN ${year.startDate} AND ${year.endDate}`).orderBy(asc(dateCol), asc(cashEntries.createdAt));
  const ids = entries.map((e) => e.id);
  const items = ids.length ? await exec.select().from(cashEntryItems).where(inArray(cashEntryItems.entryId, ids)) : [];
  const links = items.length
    ? await exec.select({ itemId: cashItemTags.itemId, name: cashTags.name, meaning: cashTags.meaning }).from(cashItemTags).innerJoin(cashTags, eq(cashTags.id, cashItemTags.tagId)).where(inArray(cashItemTags.itemId, items.map((i) => i.id)))
    : [];
  const inSet = new Set(ids);
  const origDesc = new Map<string, string | null>();
  const origIds = entries.flatMap((e) => (e.reversesEntryId && !inSet.has(e.reversesEntryId) ? [e.reversesEntryId] : []));
  const origs = origIds.length ? await exec.select().from(cashEntries).where(inArray(cashEntries.id, origIds)) : [];
  for (const o of origs) origDesc.set(o.id, labelAt(basisDate(year.basis as Basis, o)));

  const lines = new Map<string, ReportLine>();
  let income = 0, expense = 0, opening = 0, deposits = 0, corr = 0, hasCorr = false;
  for (const e of entries) {
    const sgn = e.direction === "income" ? 1 : -1;
    const reversal = !!e.reversesEntryId;
    const carryNet = reversal && !inSet.has(e.reversesEntryId!);
    for (const it of items.filter((i) => i.entryId === e.id)) {
      const amt = money(it.amount);
      const tg = links.filter((l) => l.itemId === it.id);
      if (tg.some((l) => l.meaning === "opening")) { opening += sgn * amt; continue; }
      if (tg.some((l) => l.meaning === "deposit")) { deposits += sgn * amt; continue; }
      if (e.direction === "income") income += amt; else expense += amt;
      if (carryNet) { corr += sgn * amt; hasCorr = true; continue; }
      // Stornobuchung im selben Jahr rechnet netto gegen die Richtung des Originals.
      const col: Direction = reversal ? (e.direction === "income" ? "expense" : "income") : e.direction;
      const f = reversal ? -1 : 1;
      for (const l of tg) {
        const row = lines.get(l.name) ?? { name: l.name, income: 0, expense: 0 };
        row[col] += f * amt;
        lines.set(l.name, row);
      }
    }
  }
  const dayBefore = addDays(year.startDate, -1);
  const closed = !!year.closedAt;
  const start = (await exec.select({ n: sql<number>`COUNT(*)::int` }).from(cashFiscalYears).where(sql`${cashFiscalYears.endDate} < ${year.startDate}`))[0].n ? await balanceAt(dayBefore, exec) : 0;
  const end = closed ? money(year.endBalance) : await balanceAt(year.endDate < todayStr() ? year.endDate : todayStr(), exec);
  const open = closed ? { count: year.openCount ?? 0, total: money(year.openTotal) } : await openReceivablesAt(year.endDate < todayStr() ? year.endDate : todayStr(), exec);
  return {
    year, closed, start, opening: money(opening), income: money(income), expense: money(expense), result: money(income - expense), deposits: money(deposits), end, open,
    corrections: hasCorr ? money(corr) : null,
    lines: [...lines.values()].map((l) => ({ ...l, income: money(l.income), expense: money(l.expense) })).sort((a, b) => a.name.localeCompare(b.name, "de")),
    entries: entries.map((e) => ({
      id: e.id, date: (year.basis === "paid" ? e.paidDate : e.bookingDate) ?? e.bookingDate, direction: e.direction, description: e.description, receiptRef: e.receiptRef,
      total: money(e.total), status: e.status, donationId: e.donationId, lendingLoanId: e.lendingLoanId,
      tags: [...new Set(items.filter((i) => i.entryId === e.id).flatMap((i) => links.filter((l) => l.itemId === i.id).map((l) => l.name)))],
      carriedFrom: e.originalBookingDate ? labelAt(e.originalBookingDate) : null,
      correctionOf: e.reversesEntryId ? (origDesc.get(e.reversesEntryId) ?? year.label) : null,
    })),
  };
}

const basisDate = (b: Basis, e: { paidDate: string | null; bookingDate: string }) => (b === "paid" ? e.paidDate : e.bookingDate) ?? e.bookingDate;

// Vorschau für den Abschluss: offene Einträge, die im Modus "booked" ins Folgejahr übernommen würden.
export async function carryPreview(yearId: string, exec: Exec = db): Promise<{ count: number; total: number }> {
  const [y] = await exec.select().from(cashFiscalYears).where(eq(cashFiscalYears.id, yearId));
  if (!y || y.basis !== "booked") return { count: 0, total: 0 };
  const rows = await openEntries(exec, addDays(y.endDate, 1));
  return { count: rows.length, total: money(rows.reduce((a, r) => a + Number(r.total), 0)) };
}

export async function yearLog(yearId: string, exec: Exec = db) {
  return exec.select().from(cashYearLog).where(eq(cashYearLog.yearId, yearId)).orderBy(desc(cashYearLog.at));
}

// ---------- Spenden ----------

// Vorbelegung für "In Kasse buchen": Spendendatum, sofern es in einem nicht abgeschlossenen Jahr liegt, sonst heute.
export async function suggestDonationDate(date: string, exec: Exec = db): Promise<{ date: string; moved: boolean }> {
  const today = todayStr();
  const last = await lastYear(exec);
  const y = await yearAt(exec, date);
  const usable = date <= today && (y ? !y.closedAt : !!last && date > last.endDate);
  return usable ? { date, moved: false } : { date: today, moved: true };
}

// Kein Nachziehen: Betrag und Datum werden einmalig übernommen. Kein Spendername in der Kasse.
export function bookDonation(donationId: string, paidDate: string, userId?: string | null, exec: Db = db) {
  return locked(exec, async (x) => {
    const { rows } = await x.execute<{ amount: string; date: string }>(sql`SELECT amount, date::text AS date FROM donations WHERE id = ${donationId}`);
    const d = rows[0];
    if (!d) throw new CashError("notFound");
    if (!DATE_RE.test(paidDate)) throw new CashError("invalidDate");
    const tag = await tagMeaning(x, "donation");
    const note = d.date === paidDate ? "" : ` (Spende vom ${d.date.split("-").reverse().join(".")})`;
    return createEntry({
      direction: "income", bookingDate: paidDate, paid: true, paidDate, description: `Spende${note}`,
      items: [{ amount: d.amount, tagIds: [tag.id] }], source: { donationId },
    }, { userId }, x);
  });
}

// Spenden-Einträge (open/booked) für Anzeige "In Kasse".
export async function donationEntries(ids: string[], exec: Exec = db): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await exec.select({ donationId: cashEntries.donationId, id: cashEntries.id }).from(cashEntries)
    .where(and(inArray(cashEntries.donationId, ids), inArray(cashEntries.status, ["open", "booked"])));
  return new Map(rows.map((r) => [r.donationId!, r.id]));
}

// ---------- Veranstaltung ----------

export type EventSummary = { income: number; expense: number; result: number; expected: number; any: boolean; cashEventId: string | null };

// Veranstaltung zu einem Termin (nur lesen, legt nichts an).
async function cashEventOfEvent(eventId: string, exec: Exec): Promise<string | null> {
  const [r] = await exec.select({ id: cashEvents.id }).from(cashEvents).where(eq(cashEvents.eventId, eventId));
  return r?.id ?? null;
}

export async function eventSummary(eventId: string, exec: Exec = db): Promise<EventSummary> {
  const id = await cashEventOfEvent(eventId, exec);
  return id ? cashEventSummary(id, exec) : { income: 0, expense: 0, result: 0, expected: 0, any: false, cashEventId: null };
}

// Basis des jeweiligen Geschäftsjahrs; deposit/opening und cancelled zählen nicht, offene Einträge getrennt als "erwartet".
export async function cashEventSummary(cashEventId: string, exec: Exec = db): Promise<EventSummary> {
  const { rows } = await exec.execute<{ status: string; direction: string; basis: string | null; counted: boolean; total: string }>(sql`
    SELECT e.status::text AS status, e.direction::text AS direction, y.basis::text AS basis,
      (y.id IS NOT NULL AND (CASE WHEN y.basis = 'paid' THEN e.paid_date IS NOT NULL ELSE TRUE END)) AS counted, SUM(i.amount) AS total
    FROM cash_entries e JOIN cash_entry_items i ON i.entry_id = e.id
    LEFT JOIN cash_fiscal_years y ON (CASE WHEN e.status IN ('booked','reversed') THEN e.paid_date ELSE e.booking_date END) BETWEEN y.start_date AND y.end_date
    WHERE e.cash_event_id = ${cashEventId} AND e.status <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM cash_item_tags it JOIN cash_tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.meaning IN ('opening','deposit'))
    GROUP BY 1, 2, 3, 4`);
  let income = 0, expense = 0, expected = 0;
  for (const r of rows) {
    const v = Number(r.total) * (r.direction === "income" ? 1 : -1);
    if (r.status === "open") expected += v;
    else if (r.direction === "income") income += v; else expense -= v;
  }
  return { income: money(income), expense: money(expense), result: money(income - expense), expected: money(expected), any: rows.length > 0, cashEventId };
}

// ---------- Veranstaltungen (Termin optional) ----------

export type CashEventInput = { name: string; from?: string | null; to?: string | null };
export type CashEventRow = { id: string; eventId: string | null; name: string; from: string | null; to: string | null; entries: number };

function cleanEvent(i: CashEventInput) {
  const name = i.name.trim(), from = i.from || null, to = i.to || null;
  if (!name || name.length > 200) throw new CashError("eventName");
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)) || (from && to && from > to)) throw new CashError("eventRange");
  return { name, fromDate: from, toDate: to };
}

export async function createCashEvent(i: CashEventInput, exec: Exec = db): Promise<string> {
  const [r] = await exec.insert(cashEvents).values(cleanEvent(i)).returning({ id: cashEvents.id });
  return r.id;
}

// Nur Veranstaltungen ohne Termin sind hier bearbeitbar; bei einem Termin gelten dessen Werte.
export async function updateCashEvent(id: string, i: CashEventInput, exec: Exec = db) {
  const [e] = await exec.select().from(cashEvents).where(eq(cashEvents.id, id));
  if (!e || e.eventId) throw new CashError("eventNotFound");
  await exec.update(cashEvents).set(cleanEvent(i)).where(eq(cashEvents.id, id));
}

export async function deleteCashEvent(id: string, exec: Exec = db) {
  const [e] = await exec.select().from(cashEvents).where(eq(cashEvents.id, id));
  if (!e || e.eventId) throw new CashError("eventNotFound");
  const [{ n }] = await exec.select({ n: sql<number>`COUNT(*)::int` }).from(cashEntries).where(eq(cashEntries.cashEventId, id));
  if (n > 0) throw new CashError("eventHasEntries");
  await exec.delete(cashEvents).where(eq(cashEvents.id, id));
}

// Vor dem Löschen eines Termins: Veranstaltung mit Buchungen übernimmt Name und Zeitraum, ohne Buchungen entfällt sie.
export async function detachCashEvent(eventId: string, exec: Exec = db) {
  const [ce] = await exec.select().from(cashEvents).where(eq(cashEvents.eventId, eventId));
  if (!ce) return;
  const [{ n }] = await exec.select({ n: sql<number>`COUNT(*)::int` }).from(cashEntries).where(eq(cashEntries.cashEventId, ce.id));
  if (n === 0) { await exec.delete(cashEvents).where(eq(cashEvents.id, ce.id)); return; }
  const [ev] = await exec.select().from(events).where(eq(events.id, eventId));
  const tz = resolveTimezone();
  await exec.update(cashEvents).set({ name: ev.title, fromDate: toLocalDate(ev.startsAt, tz), toDate: toLocalDate(ev.endsAt, tz) }).where(eq(cashEvents.id, ce.id));
}

// Auswahlwert aus dem Formular in die Veranstaltungs-ID übersetzen; Termin ohne Veranstaltung bekommt hier eine.
export async function resolveCashEvent(x: Exec, ref?: string | null): Promise<string | null> {
  if (!ref) return null;
  const [kind, id] = [ref.slice(0, 2), ref.slice(2)];
  if (kind === "c:") {
    const [r] = await x.select({ id: cashEvents.id }).from(cashEvents).where(eq(cashEvents.id, id));
    if (!r) throw new CashError("eventNotFound");
    return r.id;
  }
  if (kind !== "e:") throw new CashError("eventNotFound");
  const [ev] = await x.select({ id: events.id }).from(events).where(eq(events.id, id));
  if (!ev) throw new CashError("eventNotFound");
  const found = await cashEventOfEvent(id, x);
  if (found) return found;
  const [r] = await x.insert(cashEvents).values({ eventId: id }).onConflictDoNothing().returning({ id: cashEvents.id });
  return r?.id ?? (await cashEventOfEvent(id, x))!;
}

// Alle Veranstaltungen der Kasse mit aufgelöstem Namen und Zeitraum (Termin geht vor).
export async function listCashEvents(exec: Exec = db): Promise<CashEventRow[]> {
  const tz = resolveTimezone();
  const rows = await exec.select({
    id: cashEvents.id, eventId: cashEvents.eventId, name: cashEvents.name, fromDate: cashEvents.fromDate, toDate: cashEvents.toDate,
    title: events.title, startsAt: events.startsAt, endsAt: events.endsAt,
    entries: sql<number>`(SELECT COUNT(*)::int FROM cash_entries e WHERE e.cash_event_id = ${cashEvents.id})`,
  }).from(cashEvents).leftJoin(events, eq(events.id, cashEvents.eventId));
  return rows.map((r) => ({
    id: r.id, eventId: r.eventId, entries: r.entries,
    name: r.title ?? r.name ?? "",
    from: r.startsAt ? toLocalDate(r.startsAt, tz) : r.fromDate,
    to: r.endsAt ? toLocalDate(r.endsAt, tz) : r.toDate,
  })).sort((a, b) => (b.from ?? "").localeCompare(a.from ?? "") || a.name.localeCompare(b.name, "de"));
}

// ---------- Verleih ----------

// Schnittstelle für src/lib/lending.ts / Routen (kein Ereignissystem). Die Rechteprüfung (cash:lending) steht am Vorgang.
export type ReceivableInput = { rent?: number; deposit?: number };

export async function createReceivable(loanId: string, input: ReceivableInput, ctx: Ctx = {}, exec: Exec = db): Promise<string | null> {
  const rent = money(input.rent), deposit = money(input.deposit);
  if (rent < 0 || deposit < 0) throw new CashError("invalidAmount");
  if (rent === 0 && deposit === 0) return null;
  return locked(exec, async (x) => {
    const items: ItemInput[] = [];
    if (rent > 0) items.push({ amount: rent, description: "Miete", tagIds: [(await tagMeaning(x, "lending")).id] });
    if (deposit > 0) items.push({ amount: deposit, description: "Kaution", tagIds: [(await tagMeaning(x, "deposit")).id] });
    return createEntry({ direction: "income", bookingDate: todayStr(), paid: false, description: "Verleih", items, source: { lendingLoanId: loanId, sourceRole: "receivable" } }, ctx, x);
  });
}

async function loanEntries(x: Exec, loanId: string) {
  return x.select().from(cashEntries).where(and(eq(cashEntries.lendingLoanId, loanId), sql`${cashEntries.status} <> 'cancelled'`)).orderBy(asc(cashEntries.createdAt));
}

export type Settle = { paidDate?: string | null; refundDeposit?: boolean; retention?: number };

// Forderung als bezahlt buchen, optional Kaution voll zurück (Ausgabe) und Einbehalt (separate Einnahme).
export function settleLoan(loanId: string, o: Settle, ctx: Ctx = {}, exec: Db = db) {
  return locked(exec, async (x) => {
    const entries = await loanEntries(x, loanId);
    const rec = entries.find((e) => e.sourceRole === "receivable");
    if (!rec) throw new CashError("notFound");
    const date = o.paidDate || todayStr();
    if (rec.status === "open") await payEntry(rec.id, date, x);
    if (!o.refundDeposit) return;
    if (entries.some((e) => e.sourceRole === "refund")) throw new CashError("alreadySettled");
    const full = await loadEntry(rec.id, x);
    const depTag = await tagMeaning(x, "deposit");
    const deposit = money(full!.items.filter((i) => i.tagIds.includes(depTag.id)).reduce((a, i) => a + Number(i.amount), 0));
    if (deposit <= 0) throw new CashError("noDeposit");
    const retention = money(o.retention);
    if (retention < 0 || retention > deposit) throw new CashError("invalidAmount");
    const refundDate = date < rec.bookingDate ? rec.bookingDate : date;
    await createEntry({ direction: "expense", bookingDate: refundDate, paid: true, paidDate: refundDate, description: "Kaution zurück", items: [{ amount: deposit, tagIds: [depTag.id] }],
      source: { lendingLoanId: loanId, sourceRole: "refund" } }, ctx, x);
    if (retention > 0) {
      await createEntry({ direction: "income", bookingDate: refundDate, paid: true, paidDate: refundDate, description: "Kaution einbehalten", items: [{ amount: retention, tagIds: [(await tagMeaning(x, "lending")).id] }],
        source: { lendingLoanId: loanId, sourceRole: "retention" } }, ctx, x);
    }
  });
}

// Storno/Ablehnung: nur die offene Forderung wird cancelled; Gebuchtes bleibt (Rückzahlung = Gegenbuchung).
export function cancelReceivable(loanId: string, userId?: string | null, exec: Db = db) {
  return locked(exec, async (x) => {
    const rec = (await loanEntries(x, loanId)).find((e) => e.sourceRole === "receivable" && e.status === "open");
    if (rec) await cancelEntry(rec.id, { userId }, x);
  });
}

export async function loanPayment(loanId: string, exec: Exec = db) {
  const entries = await loanEntries(exec, loanId);
  const rec = entries.find((e) => e.sourceRole === "receivable");
  const detail = rec ? await loadEntry(rec.id, exec) : undefined;
  const sum = (role: string) => money(entries.filter((e) => e.sourceRole === role && e.status === "booked").reduce((a, e) => a + Number(e.total), 0));
  return { receivable: detail, refunded: sum("refund"), retained: sum("retention") };
}

// ---------- CSV ----------

// Semikolon-getrennt (Excel de). Text mit =,+,-,@ am Anfang wird gegen Formeln entschärft; echte Zahlen ("-5,00") nicht.
export const csvCell = (v: string | number): string => {
  const s = String(v);
  const isNumber = typeof v === "number" || /^-?\d+(,\d+)?$/.test(s);
  const safe = !isNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
