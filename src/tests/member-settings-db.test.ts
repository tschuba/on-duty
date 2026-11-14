import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Integration: läuft nur mit TEST_DATABASE_URL (leere Wegwerf-DB, wird migriert), sonst übersprungen.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret";

describe.skipIf(!url)("personsAtAddress (real DB)", () => {
  let db: typeof import("../db/index.js").db, pool: typeof import("../db/index.js").pool;
  let s: typeof import("../db/schema/index.js");
  let ms: typeof import("../lib/member-settings.js");

  async function member(email: string | null, o: { exitDate?: string; deathDate?: string } = {}) {
    const [p] = await db.insert(s.persons).values({ lastName: "L", firstName: "F", email }).returning();
    const [m] = await db.insert(s.members).values({ personId: p.id, entryDate: "2000-01-01", ...o }).returning();
    return { personId: p.id, memberId: m.id };
  }

  beforeAll(async () => {
    ({ db, pool } = await import("../db/index.js"));
    s = await import("../db/schema/index.js");
    ms = await import("../lib/member-settings.js");
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => { await pool.end(); });

  it("matches case/space-insensitively and skips exited, deceased and other addresses", async () => {
    const a = await member("Fam@x.de");
    const b = await member(" fam@X.de ");
    await member("fam@x.de", { exitDate: "2020-01-01" });
    await member("fam@x.de", { deathDate: "2021-01-01" });
    await member("other@x.de");
    expect((await ms.personsAtAddress("FAM@x.de")).map((p) => p.personId).sort()).toEqual([a.personId, b.personId].sort());
    expect((await ms.personsForMember(a.memberId)).length).toBe(2);
    expect(await ms.personsAtAddress("  ")).toEqual([]);
  });

  it("saveSettings only toggles persons at the member's address", async () => {
    const a = await member("g@x.de");
    const b = await member("g@x.de");
    const c = await member("h@x.de");
    await ms.saveSettings(a.memberId, [a.personId, c.personId]);
    expect((await ms.loadSettings(a.memberId)).map((p) => [p.personId, p.events]).sort()).toEqual([[a.personId, true], [b.personId, false]].sort());
    expect((await ms.loadSettings(c.memberId))[0].events).toBe(true);
  });
});
