import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Integration: läuft nur mit TEST_DATABASE_URL (leere Wegwerf-DB, wird migriert), sonst übersprungen.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";

describe.skipIf(!url)("countPendingRsvps (real DB)", () => {
  let db: typeof import("../db/index.js").db, pool: typeof import("../db/index.js").pool;
  let ev: typeof import("../lib/events.js");
  let s: typeof import("../db/schema/index.js");
  const day = 86400_000, at = (d: number) => new Date(Date.now() + d * day);
  let n = 0;

  async function user(exitDate: string | null = null) {
    const id = `u${++n}`;
    await db.insert(s.users).values({ id, name: id, email: `${id}@x.de`, createdAt: new Date(), updatedAt: new Date() });
    const [p] = await db.insert(s.persons).values({ lastName: "L", firstName: id, userId: id }).returning();
    const [m] = await db.insert(s.members).values({ personId: p.id, entryDate: "2000-01-01", exitDate }).returning();
    return { id, memberId: m.id };
  }
  const event = async (o: Partial<typeof s.events.$inferInsert> = {}) =>
    (await db.insert(s.events).values({ title: "E", startsAt: at(5), endsAt: at(6), rsvpEnabled: true, visibility: "loggedIn", ...o }).returning())[0];

  beforeAll(async () => {
    ({ db, pool } = await import("../db/index.js"));
    ev = await import("../lib/events.js");
    s = await import("../db/schema/index.js");
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => { await pool.end(); });

  // Gegenprobe in JS mit den Definitionen der Liste (rsvpLock, invitedMembers).
  async function expected(userId: string, memberId: string) {
    const rows = await db.select().from(s.events);
    let c = 0;
    for (const e of rows) {
      if (!e.rsvpEnabled || ev.rsvpLock(e, false) || e.startsAt < new Date()) continue;
      if (!(await ev.invitedMembers(e)).includes(memberId)) continue;
      const [r] = await db.select().from(s.eventRsvps).where(and(eq(s.eventRsvps.eventId, e.id), eq(s.eventRsvps.memberId, memberId)));
      if (!r) c++;
    }
    return c;
  }

  it("counts only open, answerable, invited events and matches the list definition", async () => {
    const me = await user();
    const other = await user();
    const open1 = await event();
    const open2 = await event({ visibility: "public", rsvpDeadline: at(1) });
    const invited = await event({ visibility: "members" });
    await db.insert(s.eventInvitees).values({ eventId: invited.id, memberId: me.memberId });
    // nicht zählen:
    const answered = await event();
    await db.insert(s.eventRsvps).values({ eventId: answered.id, memberId: me.memberId, status: "no" });
    await event({ cancelledAt: new Date() });
    await event({ rsvpDeadline: at(-1) });
    await event({ startsAt: at(-2), endsAt: at(-1) });
    await event({ rsvpEnabled: false });
    const notInvited = await event({ visibility: "members" });
    await db.insert(s.eventInvitees).values({ eventId: notInvited.id, memberId: other.memberId });
    expect([open1, open2, invited].length).toBe(3);

    expect(await ev.countPendingRsvps(me.id)).toBe(3);
    expect(await ev.countPendingRsvps(me.id)).toBe(await expected(me.id, me.memberId));
    expect(await ev.countPendingRsvps(other.id)).toBe(await expected(other.id, other.memberId));
  });

  it("is 0 for exited members and users without member", async () => {
    const gone = await user("2020-01-01");
    await db.insert(s.users).values({ id: "nomember", name: "n", email: "n@x.de", createdAt: new Date(), updatedAt: new Date() });
    expect(await ev.countPendingRsvps(gone.id)).toBe(0);
    expect(await ev.countPendingRsvps("nomember")).toBe(0);
  });
});
