import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Integration (echte DB, siehe cash-routes-db.test.tsx).
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret";

const st: { user: any } = { user: null };
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: () => async (c: any, next: any) => {
      if (!st.user) return c.redirect("/login");
      c.set("user", st.user); await next();
    },
  };
});

const as = (perms: string[], scope: any = "all") => { st.user = { id: "srch-u", name: "T", permissions: new Set(perms), memberScope: { read: scope, write: scope, delete: scope }, disabled: false }; };
const DAY = 864e5;

describe.skipIf(!url)("search route (real DB)", () => {
  let app: any, db: any, pool: any, s: any;
  const get = async (q: string) => { const r = await app.request(`/?q=${encodeURIComponent(q)}`); return r.status === 200 ? await r.text() : `status ${r.status}`; };

  beforeAll(async () => {
    ({ db, pool } = await import("../db/index.js"));
    s = await import("../db/schema/index.js");
    app = (await import("../routes/search.js")).searchRoutes;
    await migrate(db, { migrationsFolder: "./drizzle" });
    const mk = async (first: string, last: string, extra: any = {}) => {
      const [p] = await db.insert(s.persons).values({ firstName: first, lastName: last, birthDate: "1980-01-01" }).returning();
      await db.insert(s.members).values({ personId: p.id, entryDate: "2000-01-01", ...extra });
    };
    await mk("Zed", "Srchaktiv");
    await mk("Zed", "Srchaustritt", { exitDate: "2020-01-01" });
    await mk("Zed", "Srchtot", { deathDate: "2020-01-01" });
    await db.insert(s.inventoryItems).values([{ name: "Srchhelm" }, { name: "Srchalt", retiredAt: "2020-01-01" }]);
    const ev = (title: string, d: number, extra: any = {}) => ({ title, startsAt: new Date(Date.now() + d * DAY), endsAt: new Date(Date.now() + d * DAY + 3600e3), visibility: "loggedIn", ...extra });
    await db.insert(s.events).values([
      ev("Srchfest", 5), ev("Srchabgesagt", 6, { cancelledAt: new Date() }), ev("Srchzualt", -400),
      ev("Srchgeheim", 5, { visibility: "members" }),
      ...Array.from({ length: 7 }, (_, i) => ev(`Srchmany${i}`, i + 10)),
    ]);
  });
  afterAll(async () => {
    const { like, inArray } = await import("drizzle-orm");
    const ps = await db.select({ id: s.persons.id }).from(s.persons).where(like(s.persons.lastName, "Srch%"));
    if (ps.length) await db.delete(s.members).where(inArray(s.members.personId, ps.map((p: any) => p.id)));
    await db.delete(s.events).where(like(s.events.title, "Srch%"));
    await db.delete(s.inventoryItems).where(like(s.inventoryItems.name, "Srch%"));
    await db.delete(s.persons).where(like(s.persons.lastName, "Srch%"));
    await pool.end();
  });

  it("redirects without login", async () => {
    st.user = null;
    expect((await app.request("/?q=abc")).status).toBe(302);
  });
  it("needs 2 chars", async () => {
    as(["members:read"]);
    const h = await get("a");
    expect(h).toContain("Mindestens 2 Zeichen");
  });
  it("hides members without members:read; shows only current ones with it", async () => {
    as([]);
    expect(await get("Srcht")).not.toContain("Srchaktiv");
    as(["members:read"]);
    const h = await get("Srch");
    expect(h).toContain("Srchaktiv");
    expect(h).not.toContain("Srchaustritt");
    expect(h).not.toContain("Srchtot");
  });
  it("memberScope limits by status", async () => {
    as(["members:read"], new Set(["children"]));
    expect(await get("Srchaktiv")).not.toContain("Srchaktiv");
  });
  it("menu respects permissions", async () => {
    as([]);
    expect(await get("Inventar")).not.toContain("/inventory");
    as(["inventory:read"]);
    expect(await get("Inventar")).toContain('href="/inventory"');
  });
  it("inventory needs permission, hides retired", async () => {
    as([]);
    expect(await get("Srchhelm")).not.toContain("Srchhelm");
    as(["inventory:read"]);
    const h = await get("Srch");
    expect(h).toContain("Srchhelm");
    expect(h).not.toContain("Srchalt");
  });
  it("events: visibility, window, cancelled marker, limit", async () => {
    as([]);
    const h = await get("Srch");
    expect(h).toContain("Srchfest");
    expect(h).not.toContain("Srchgeheim");
    expect(h).not.toContain("Srchzualt");
    expect(await get("Srchabgesagt")).toContain("Abgesagt");
    expect((h.match(/href="\/events\//g) ?? []).length).toBe(5);
  });
});
