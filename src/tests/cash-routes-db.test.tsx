import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Integration (echte DB, siehe cash-db.test.ts): geht alle Kassen-Routen einmal durch.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret";

const PERMS = new Set(["cash:report", "cash:read", "cash:manage", "cash:cancel", "cash:lending", "cash:reopen"]);
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: () => async (c: any, next: any) => { c.set("user", { id: "cash-routes-u", name: "T", permissions: PERMS, disabled: false }); await next(); },
  };
});

describe.skipIf(!url)("cash routes (real DB)", () => {
  let app: any, db: any, pool: any, s: any, c: typeof import("../lib/cash.js");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const req = (method: string, path: string, form?: Record<string, string | string[]>) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form ?? {})) for (const x of [v].flat()) body.append(k, x);
    return app.request(path, { method, ...(form ? { headers: { "content-type": "application/x-www-form-urlencoded" }, body } : {}) });
  };
  const ok = async (method: string, path: string, form?: Record<string, string | string[]>) => {
    const r = await req(method, path, form);
    expect(r.status, `${method} ${path}`).toBeLessThan(500);
    return r;
  };

  beforeAll(async () => {
    ({ db, pool } = await import("../db/index.js"));
    s = await import("../db/schema/index.js");
    c = await import("../lib/cash.js");
    app = (await import("../routes/cash.js")).cashRoutes;
    await migrate(db, { migrationsFolder: "./drizzle" });
    await wipe();
    await db.insert(s.users).values({ id: "cash-routes-u", name: "T", email: "cash-routes@cash-routes.test", createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
  });
  // cash-db.test.ts erwartet eine ungeöffnete Kasse: Kassen-Tabellen vorher und nachher leeren.
  const wipe = () => db.execute(sql`truncate cash_item_tags, cash_entry_items, cash_entries, cash_year_log, cash_fiscal_years, cash_events restart identity cascade`);
  afterAll(async () => { await wipe(); await pool.end(); });

  it("walks through the whole flow", async () => {
    // vor Eröffnung
    await ok("GET", "/");
    expect((await req("GET", "/new")).status).toBe(302);
    await ok("POST", "/settings", { mode: "calendar", cutoff: "01-06", basis: "paid", back: "/cash" });
    await ok("POST", "/settings", { mode: "bogus" });
    await ok("POST", "/open", { mode: "calendar", cutoff: "01-06", basis: "paid", date: today, amount: "0" });
    await ok("POST", "/open", { mode: "calendar", cutoff: "01-06", basis: "paid", date: today, amount: "100" });
    await ok("POST", "/open-zero", { mode: "calendar", cutoff: "01-06", basis: "paid", date: today });

    // Buchen
    const [{ id: inTag }] = await db.insert(s.cashTags).values({ name: "RtFest", direction: "income" }).returning();
    const [{ id: outTag }] = await db.insert(s.cashTags).values({ name: "RtMaterial", direction: "expense" }).returning();
    await ok("GET", "/item-row?i=3");
    await ok("GET", "/new");
    await ok("GET", "/new?event=abc");
    await ok("POST", "/new", { direction: "income", bookingDate: today, amount_0: "x", tags_0: inTag });
    await ok("POST", "/new", { direction: "income", bookingDate: today, amount_0: "12,50", desc_0: "a", tags_0: [inTag], newEvent: "Sommerfest", description: "d", receiptRef: "R1" });
    await ok("POST", "/new", { direction: "expense", bookingDate: today, paid: "0", amount_0: "5", tags_0: [outTag, "new:expense:RtNeu"] });
    await ok("POST", "/new", { direction: "expense", bookingDate: today, paid: "0", amount_0: "7", tags_0: outTag });
    const entries = await db.select().from(s.cashEntries);
    const open = entries.filter((e: any) => e.status === "open");
    const done = entries.find((e: any) => e.status !== "open" && e.direction === "income" && !e.reversesEntryId);
    expect(open.length).toBe(2);

    // Details, Bearbeiten, Zahlen, Stornieren
    await ok("GET", `/${done.id}`);
    await ok("GET", `/${open[0].id}`);
    await ok("GET", "/00000000-0000-0000-0000-000000000000");
    await ok("GET", `/${open[0].id}/edit`);
    await ok("GET", `/${done.id}/edit`);
    await ok("POST", `/${open[0].id}/edit`, { direction: "expense", bookingDate: today, amount_0: "6", tags_0: outTag });
    await ok("POST", `/${open[0].id}/edit`, { direction: "expense", bookingDate: today, amount_0: "", tags_0: outTag });
    await ok("POST", `/${open[0].id}/pay`, { paidDate: today });
    await ok("POST", `/${open[0].id}/pay`, {});
    await ok("POST", `/${open[1].id}/cancel`, { date: today });
    await ok("POST", `/${done.id}/cancel`, { date: today });
    await ok("POST", `/${done.id}/cancel`, {});

    // Tags
    for (const id of [inTag, outTag, "00000000-0000-0000-0000-000000000000"]) {
      await ok("GET", `/tags/${id}`);
      await ok("GET", `/tags/${id}/edit`);
    }
    await ok("POST", `/tags/${inTag}`, { direction: "both" });
    await ok("POST", `/tags/${inTag}`, { active: "0" });
    await ok("POST", `/tags/${inTag}`, { name: "Fest2" });
    await ok("GET", `/tags/${inTag}`);
    await ok("GET", "/?view=tags");

    // Veranstaltungen
    await ok("GET", "/events/new");
    await ok("GET", "/events/new?name=x");
    await ok("POST", "/events", { name: "" });
    await ok("POST", "/events", { name: "Basar", from: today, to: today });
    const [ev] = await db.select().from(s.cashEvents);
    await ok("GET", `/events/${ev.id}`);
    await ok("GET", `/events/${ev.id}/edit`);
    await ok("GET", "/events/00000000-0000-0000-0000-000000000000");
    await ok("POST", `/events/${ev.id}`, { name: "Basar 2", from: today, to: today });
    await ok("POST", `/events/${ev.id}`, { name: "" });
    await ok("GET", "/?view=events");
    await ok("GET", "/?view=events&search=Basar&status=open");
    await ok("POST", `/events/${ev.id}/delete`, {});

    // Übersicht, Bericht, Abschluss
    await ok("GET", "/");
    await ok("GET", `/?q=a&direction=income&status=open&tag=${inTag}`);
    const list = await (await ok("GET", `/?direction=income&status=open&tag=${inTag}`)).text();
    expect(list).toContain("data-page-filter");
    expect(list).toContain('data-count="3"');
    expect(list).not.toContain(`class="filter-bar`);
    await ok("GET", "/?view=report");
    const [y] = await c.listYears();
    await ok("GET", `/?view=report&year=${y.id}`);
    await ok("GET", `/?view=report&year=${y.id}&detail=1`);
    const csv = await ok("GET", `/report.csv?year=${y.id}`);
    expect(csv.status).toBe(200);
    expect((await req("GET", "/report.csv?year=nope")).status).toBe(404);
    await ok("POST", `/year/${y.id}/close`, { carry: "1" });
    await ok("POST", `/year/${y.id}/close`, {});
    await ok("GET", `/?view=report&year=${y.id}`);
    await ok("POST", `/year/${y.id}/reopen`, { reason: "" });
    await ok("POST", `/year/${y.id}/reopen`, { reason: "Korrektur" });

    // Spende
    const [p] = await db.insert(s.persons).values({ lastName: "L", firstName: "F" }).returning();
    const [d] = await db.insert(s.donors).values({ personId: p.id }).returning();
    const [don] = await db.insert(s.donations).values({ donorId: d.id, amount: "5", date: today }).returning();
    await ok("POST", `/donation/${don.id}`, { paidDate: today });
    await ok("POST", `/donation/${don.id}`, { paidDate: today });
  });
});
