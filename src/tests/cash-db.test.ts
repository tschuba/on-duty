import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Integration: läuft nur mit TEST_DATABASE_URL (leere Wegwerf-DB, wird migriert), sonst übersprungen.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.ANNIVERSARY_CUTOFF = "01-06";
process.env.APP_TIMEZONE = "Europe/Berlin"; // Test rechnet "heute" selbst in dieser Zone

describe.skipIf(!url)("cash (real DB)", () => {
  let db: typeof import("../db/index.js").db, pool: typeof import("../db/index.js").pool;
  let s: typeof import("../db/schema/index.js");
  let c: typeof import("../lib/cash.js");
  let tags: Record<string, string>;
  let free: string, freeOut: string;
  const rejects = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toMatchObject({ code }); };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE }).format(new Date());
  const year = Number(today.slice(0, 4));
  const inc = (amount: number, extra: object = {}) =>
    c.createEntry({ direction: "income", bookingDate: today, paid: true, items: [{ amount, tagIds: [free] }], ...extra } as any);

  beforeAll(async () => {
    ({ db, pool } = await import("../db/index.js"));
    s = await import("../db/schema/index.js");
    c = await import("../lib/cash.js");
    await migrate(db, { migrationsFolder: "./drizzle" });
    const all = await db.select().from(s.cashTags);
    tags = Object.fromEntries(all.filter((t) => t.meaning).map((t) => [t.meaning!, t.id]));
    [{ id: free }] = await db.insert(s.cashTags).values({ name: "Fest", direction: "income" }).returning();
    [{ id: freeOut }] = await db.insert(s.cashTags).values({ name: "Material", direction: "expense" }).returning();
  });
  afterAll(async () => { await pool.end(); });

  it("uses the app time zone for dates, not UTC", () => {
    // 23:30 UTC am 31.12. ist in Berlin schon der 1.1.
    expect(c.cashDate(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(c.cashDate(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
    expect(c.cashDate(new Date("2026-06-30T22:00:00Z"))).toBe("2026-07-01");
  });

  it("validates settings", () => {
    expect(c.validCutoff("02-29")).toBe(false);
    expect(c.validCutoff("13-01")).toBe(false);
    expect(c.validCutoff("09-30")).toBe(true);
    expect(() => c.validateSettings({ mode: "custom", cutoff: "x", basis: "paid" })).toThrow();
    expect(c.yearEnd("2026-03-05", "01-06")).toBe("2027-01-06");
    expect(c.yearEnd("2026-01-01", "12-31")).toBe("2026-12-31");
  });

  it("resolves new tag chips", async () => {
    const [a] = await c.resolveTagChips(["new:income:Flohmarkt"]);
    expect(await c.resolveTagChips(["new:income:flohmarkt", a])).toEqual([a, a]);
    await rejects(c.resolveTagChips(["new:expense:FLOHMARKT"]), "tagDirection");
  });

  it("manages tags", async () => {
    const [a] = await c.resolveTagChips(["new:income:Basar"]);
    await c.updateTag(a, { name: "BASAR" }); // gleicher Tag: nur Schreibweise
    await c.updateTag(a, { name: "Basar neu" });
    await rejects(c.updateTag(a, { name: "flohmarkt" }), "nameTaken");
    await c.updateTag(a, { direction: "expense" }); // ungenutzt: frei
    await c.updateTag(a, { direction: "both" });
    await rejects(c.updateTag(tags.donation, { name: "x" }), "fixedTag");
    await rejects(c.updateTag(tags.donation, { active: false }), "fixedTag");
    await rejects(c.updateTag(tags.deposit, { direction: "income" }), "fixedTag");
  });

  it("refuses to book before the cash is opened", async () => {
    await rejects(inc(5), "noYear");
  });

  it("opens with a balance, books, reverses", async () => {
    // Drei echte Pool-Verbindungen gleichzeitig: genau eine darf das erste Jahr anlegen.
    const results = await Promise.allSettled([1, 2, 3].map(() => c.openCash(100, `${year}-01-01`)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "alreadyStarted" });
    expect((await c.listYears()).length).toBe(1);
    expect(await c.balanceAt()).toBe(100);

    const id = await inc(25.5);
    expect(await c.balanceAt()).toBe(125.5);
    await rejects(c.createEntry({ direction: "expense", bookingDate: today, paid: true, items: [{ amount: 1, tagIds: [free] }] }), "tagDirection");
    await rejects(c.createEntry({ direction: "income", bookingDate: today, paid: true, items: [{ amount: 1, tagIds: [tags.opening, free] }] }), "exclusiveTag");
    await rejects(c.createEntry({ direction: "income", bookingDate: today, paid: true, items: [{ amount: 1, tagIds: [] }] }), "noTag");

    const r = await c.cancelEntry(id);
    expect(r.kind).toBe("reversed");
    expect(await c.balanceAt()).toBe(100);
    const [orig] = await db.select().from(s.cashEntries).where((await import("drizzle-orm")).eq(s.cashEntries.id, id));
    expect(orig.status).toBe("reversed");
    await rejects(c.cancelEntry(id), "notCancellable");
    await rejects(c.cancelEntry(r.id), "notCancellable");
  });

  it("open entries: edit, pay, cancel, no double booking per donation", async () => {
    const id = await c.createEntry({ direction: "expense", bookingDate: today, paid: false, items: [{ amount: 10, tagIds: [freeOut] }] });
    expect((await c.openReceivablesAt(today)).count).toBe(1);
    await c.updateOpenEntry(id, { direction: "expense", bookingDate: today, items: [{ amount: 12, tagIds: [freeOut] }] });
    await rejects(c.payEntry(id, `${year + 1}-12-31`), "future");
    await c.payEntry(id);
    await rejects(c.payEntry(id), "notOpen");
    expect(await c.balanceAt()).toBe(88);

    const open = await c.createEntry({ direction: "expense", bookingDate: today, paid: false, items: [{ amount: 3, tagIds: [freeOut] }] });
    expect((await c.cancelEntry(open)).kind).toBe("cancelled");

    const [p] = await db.insert(s.persons).values({ lastName: "L", firstName: "F" }).returning();
    const [d] = await db.insert(s.donors).values({ personId: p.id }).returning();
    const [don] = await db.insert(s.donations).values({ donorId: d.id, amount: "5", date: today }).returning();
    const src = { source: { donationId: don.id }, items: [{ amount: 5, tagIds: [tags.donation] }] };
    const first = await inc(5, src);
    await rejects(inc(5, src), "duplicate");
    await c.cancelEntry(first);
    await inc(5, src); // nach Storno neu buchbar
  });

  it("books donations and summarises events", async () => {
    const [p] = await db.insert(s.persons).values({ lastName: "L2", firstName: "F" }).returning();
    const [d] = await db.insert(s.donors).values({ personId: p.id }).returning();
    const [don] = await db.insert(s.donations).values({ donorId: d.id, amount: "7.50", date: "1999-01-01" }).returning();
    expect(await c.suggestDonationDate("1999-01-01")).toMatchObject({ moved: true });
    expect(await c.suggestDonationDate(today)).toEqual({ date: today, moved: false });
    const before = await c.countUnbookedDonations();
    const eid = await c.bookDonation(don.id, today);
    await rejects(c.bookDonation(don.id, today), "duplicate");
    expect(await c.countUnbookedDonations()).toBe(before - 1);
    expect((await c.donationEntries([don.id])).get(don.id)).toBe(eid);
    const [ev] = await db.insert(s.events).values({ title: "Fest", startsAt: new Date(), endsAt: new Date() }).returning();
    await inc(40, { eventRef: `e:${ev.id}` });
    await c.createEntry({ direction: "expense", bookingDate: today, paid: true, eventRef: `e:${ev.id}`, items: [{ amount: 15, tagIds: [freeOut] }] });
    await c.createEntry({ direction: "income", bookingDate: today, paid: false, eventRef: `e:${ev.id}`, items: [{ amount: 9, tagIds: [free] }] });
    const sum = await c.eventSummary(ev.id);
    expect(sum).toMatchObject({ income: 40, expense: 15, result: 25, expected: 9, any: true });
    expect(await c.cashEventSummary(sum.cashEventId!)).toEqual(sum);
    expect(await c.eventSummary(randomUUID())).toMatchObject({ any: false, cashEventId: null });
  });

  it("manages events without a date and keeps them when the event is deleted", async () => {
    const id = await c.createCashEvent({ name: " Sommerfest ", from: "2025-07-01", to: "2025-07-02" });
    await rejects(c.createCashEvent({ name: "  " }), "eventName");
    await rejects(c.createCashEvent({ name: "X", from: "2025-07-03", to: "2025-07-02" }), "eventRange");
    await inc(30, { eventRef: `c:${id}` });
    await rejects(c.deleteCashEvent(id), "eventHasEntries");
    await c.updateCashEvent(id, { name: "Sommerfest 2025" });
    expect((await c.listCashEvents()).find((e) => e.id === id)).toMatchObject({ name: "Sommerfest 2025", from: null, entries: 1 });
    expect(await c.cashEventSummary(id)).toMatchObject({ income: 30 });
    const empty = await c.createCashEvent({ name: "Leer" });
    await c.deleteCashEvent(empty);
    await rejects(inc(1, { eventRef: "c:" + randomUUID() }), "eventNotFound");

    // Termin mit Buchungen: Veranstaltung übernimmt Name und Zeitraum, ohne Buchungen entfällt sie.
    const [ev] = await db.insert(s.events).values({ title: "Fest 2", startsAt: new Date("2025-08-01T10:00:00Z"), endsAt: new Date("2025-08-02T10:00:00Z") }).returning();
    await inc(5, { eventRef: `e:${ev.id}` });
    const ce = (await c.listCashEvents()).find((e) => e.eventId === ev.id)!;
    expect(ce).toMatchObject({ name: "Fest 2", from: "2025-08-01", to: "2025-08-02" });
    await db.transaction(async (tx) => { await c.detachCashEvent(ev.id, tx); await tx.delete(s.events).where(eq(s.events.id, ev.id)); });
    expect((await c.listCashEvents()).find((e) => e.id === ce.id)).toMatchObject({ eventId: null, name: "Fest 2", from: "2025-08-01", entries: 1 });
    const [ev2] = await db.insert(s.events).values({ title: "Leer", startsAt: new Date(), endsAt: new Date() }).returning();
    const ref = await db.transaction((tx) => c.resolveCashEvent(tx, `e:${ev2.id}`));
    await db.transaction(async (tx) => { await c.detachCashEvent(ev2.id, tx); await tx.delete(s.events).where(eq(s.events.id, ev2.id)); });
    expect((await c.listCashEvents()).some((e) => e.id === ref)).toBe(false);
  });

  it("handles lending payments", async () => {
    const [p] = await db.insert(s.persons).values({ lastName: "B", firstName: "B" }).returning();
    const [inv] = await db.insert(s.inventoryItems).values({ name: "Zelt" }).returning();
    const [li] = await db.insert(s.lendingItems).values({ inventoryItemId: inv.id, individualTracking: true }).returning();
    const [loan] = await db.insert(s.lendingLoans).values({ lendingItemId: li.id, borrowerPersonId: p.id }).returning();
    expect(await c.createReceivable(loan.id, {})).toBeNull();
    const id = await c.createReceivable(loan.id, { rent: 20, deposit: 50 });
    await rejects(c.createReceivable(loan.id, { rent: 1 }), "duplicate");
    expect((await c.loanPayment(loan.id)).receivable?.items.length).toBe(2);
    const bal = await c.balanceAt();
    await c.settleLoan(loan.id, { refundDeposit: true, retention: 10 });
    expect(await c.balanceAt()).toBe(bal + 70 - 50 + 10);
    await rejects(c.settleLoan(loan.id, { refundDeposit: true }), "alreadySettled");
    expect(await c.loanPayment(loan.id)).toMatchObject({ refunded: 50, retained: 10 });
    expect(id).toBeTruthy();
    await c.cancelReceivable(loan.id); // nichts Offenes mehr: no-op
  });

  it("serialises concurrent writers (no duplicate years)", async () => {
    await Promise.all([1, 2, 3].map(() => inc(1)));
    const years = await c.listYears();
    expect(new Set(years.map((y) => y.startDate)).size).toBe(years.length);
  });

  it("closes, blocks backdating, reopens", async () => {
    // Jahr 1 endet in der Vergangenheit: zurückdatiertes Anlegen schaffen wir per direktem Update.
    const [y] = await c.listYears();
    await db.update(s.cashFiscalYears).set({ startDate: `${year - 2}-01-01`, endDate: `${year - 2}-12-31`, label: `${year - 2}` }).execute();
    await db.update(s.cashEntries).set({ bookingDate: `${year - 2}-06-01`, paidDate: `${year - 2}-06-01` });
    // Lücke füllen: Folgejahre entstehen automatisch beim nächsten Buchen.
    await inc(1);
    const years = await c.listYears();
    expect(years.map((x) => x.startDate)).toEqual([`${year - 2}-01-01`, `${year - 1}-01-01`, `${year}-01-01`]);
    await rejects(c.closeYear(years[1].id), "previousOpen");
    const closed = await c.closeYear(years[0].id);
    expect(closed.endBalance).toBeGreaterThan(0);
    await rejects(c.closeYear(years[0].id), "alreadyClosed");
    await rejects(inc(1, { paidDate: `${year - 2}-07-01`, bookingDate: `${year - 2}-07-01` }), "yearClosed");
    await rejects(c.closeYear(years[2].id), "tooEarly");
    await rejects(c.reopenYear(years[0].id, " "), "reasonRequired");
    await c.closeYear(years[1].id);
    await rejects(c.reopenYear(years[0].id, "x"), "nextClosed");
    await c.reopenYear(years[1].id, "Korrektur");
    const [re] = (await c.listYears()).filter((x) => x.id === years[1].id);
    expect(re.closedAt).toBeNull();
    expect(re.endBalance).toBeNull();
    expect((await db.select().from(s.cashYearLog)).length).toBe(3);
    const rep = await c.yearReport(years[0].id);
    expect(rep.closed).toBe(true);
    expect(rep.end).toBe(closed.endBalance);
    expect(rep.opening).toBe(100);
    expect(rep.result).toBe(rep.income - rep.expense);
    expect((await c.yearReport(years[2].id)).closed).toBe(false);
    const res = await c.yearResult(years[0].id);
    expect(res.opening).toBe(100);
    expect(res.result).toBe(res.income - res.expense);
  });
});
