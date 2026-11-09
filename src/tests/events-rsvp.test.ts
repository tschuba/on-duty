import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";
import { t } from "../i18n/index.js";
import { getTableConfig } from "drizzle-orm/pg-core";
import { eventRsvps, eventInvitees } from "../db/schema/events.js";

process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.APP_TIMEZONE = "Europe/Berlin";

// ── DB-Mock: select() liefert nacheinander die in `queue` abgelegten Ergebnisse ──
let queue: any[][] = [];
const forCalls: string[] = [];
const inserted: any[] = [];
const deleted: any[] = [];
function chain(): any {
  const res = () => Promise.resolve(queue.shift() ?? []);
  const c: any = {
    from: () => c, innerJoin: () => c, where: () => c, orderBy: () => c, limit: () => c,
    for: (m: string) => { forCalls.push(m); return c; },
    then: (r: any, j: any) => res().then(r, j),
  };
  return c;
}
let eventRow: any;
const tx = {
  select: vi.fn(() => chain()),
  insert: vi.fn(() => ({ values: (v: any) => { inserted.push(v); return { onConflictDoUpdate: () => Promise.resolve() }; } })),
  delete: vi.fn(() => ({ where: () => { deleted.push(1); return Promise.resolve(); } })),
};
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => chain()),
    transaction: async (cb: any) => cb(tx),
    query: { events: { findFirst: vi.fn(async () => eventRow) } },
  },
}));
vi.mock("../lib/settings.js", () => ({ getSettings: async () => ({ eventsPublicEnabled: "true" }), setSetting: vi.fn() }));

// Routen: Mitglied/Einladung/Zeilen/Limit-Logik der Lib gezielt ersetzen.
const state = {
  member: undefined as any, invited: [] as string[], rows: [] as any[], open: [] as any[],
  setResult: "ok" as string, setCalls: [] as any[], resetCalls: [] as any[],
};
vi.mock("../lib/events.js", async () => {
  const actual = await vi.importActual<any>("../lib/events.js");
  return {
    ...actual,
    memberForUser: async () => state.member,
    invitedMembers: async () => state.invited,
    loadRsvps: async () => state.rows,
    loadOpenMembers: async () => state.open,
    setRsvp: async (...a: any[]) => { state.setCalls.push(a); return state.setResult; },
    resetRsvp: async (...a: any[]) => { state.resetCalls.push(a); return state.setResult; },
    loadRsvpSummaries: async (ids: string[]) => new Map(ids.map((id) => [id, { yes: 3, mine: null }])),
  };
});

let user: any;
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (required?: any) => async (c: any, next: any) => {
      if (required) {
        const req = Array.isArray(required) ? required : [required];
        if (!req.every((p: string) => user.permissions.has(p))) return c.text("forbidden", 403);
      }
      c.set("user", user);
      await next();
    },
  };
});

const { setRsvp, resetRsvp, loadOpenMembers, countPendingRsvps } = await vi.importActual<typeof import("../lib/events.js")>("../lib/events.js");
const { eventRoutes } = await import("../routes/events.js");

const future = new Date("2999-01-01T10:00:00Z");
const mkEvent = (o: Record<string, unknown> = {}) => ({
  id: "e1", title: "Übung", location: null, description: null, allDay: false, startsAt: future, endsAt: new Date("2999-01-01T12:00:00Z"),
  visibility: "loggedIn", tags: [], invitees: [], rsvpEnabled: true, maxParticipants: null, rsvpDeadline: null, cancelledAt: null, ...o,
});
const row = (memberId: string, status: "yes" | "no", o: any = {}) => ({ memberId, name: `Muster${memberId}, Max`, lastName: `Muster${memberId}`, status, active: true, ...o });

beforeEach(() => {
  queue = []; forCalls.length = 0; inserted.length = 0; deleted.length = 0; vi.clearAllMocks();
  eventRow = mkEvent();
  user = { id: "u1", permissions: new Set(), roleIds: new Set<string>(), disabled: false };
  Object.assign(state, { member: { id: "m1", exitDate: null, deathDate: null }, invited: ["m1"], rows: [], open: [], setResult: "ok", setCalls: [], resetCalls: [] });
});

// ── Lib: setRsvp / resetRsvp (Transaktion, Limit, Sperren) ──
describe("setRsvp", () => {
  it("locks the event row (FOR UPDATE) before checking the limit", async () => {
    queue = [[mkEvent({ maxParticipants: 2 })], [], [{ n: 1 }]];
    expect(await setRsvp("e1", "m1", "yes", false)).toBe("ok");
    expect(forCalls).toEqual(["update"]);
    expect(inserted).toHaveLength(1);
  });
  it("rejects a member's yes at the limit, nothing is written", async () => {
    queue = [[mkEvent({ maxParticipants: 2 })], [], [{ n: 2 }]];
    expect(await setRsvp("e1", "m1", "yes", false)).toBe("full");
    expect(inserted).toHaveLength(0);
  });
  it("allows 'no' and a repeated 'yes' at the limit", async () => {
    queue = [[mkEvent({ maxParticipants: 2 })]];
    expect(await setRsvp("e1", "m1", "no", false)).toBe("ok");
    queue = [[mkEvent({ maxParticipants: 2 })], [{ status: "yes" }]];
    expect(await setRsvp("e1", "m1", "yes", false)).toBe("ok");
  });
  it("lets the manager overbook", async () => {
    queue = [[mkEvent({ maxParticipants: 2 })]];
    expect(await setRsvp("e1", "m9", "yes", true)).toBe("ok");
  });
  it("rejects members after the deadline but not the manager", async () => {
    const past = mkEvent({ startsAt: new Date("2020-01-01T10:00:00Z"), endsAt: new Date("2020-01-01T12:00:00Z") });
    queue = [[past]];
    expect(await setRsvp("e1", "m1", "yes", false)).toBe("deadline");
    queue = [[past]];
    expect(await setRsvp("e1", "m1", "yes", true)).toBe("ok");
  });
  it("cancelled event blocks everyone including the manager, and keeps rows", async () => {
    queue = [[mkEvent({ cancelledAt: new Date() })]];
    expect(await setRsvp("e1", "m1", "yes", true)).toBe("cancelled");
    queue = [[mkEvent({ cancelledAt: new Date() })]];
    expect(await resetRsvp("e1", "m1")).toBe("cancelled");
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });
  it("is notFound when disabled or missing", async () => {
    queue = [[mkEvent({ rsvpEnabled: false })]];
    expect(await setRsvp("e1", "m1", "yes", false)).toBe("notFound");
    queue = [[]];
    expect(await resetRsvp("e1", "m1")).toBe("notFound");
  });
  it("reset deletes the row", async () => {
    queue = [[mkEvent()]];
    expect(await resetRsvp("e1", "m1")).toBe("ok");
    expect(deleted).toHaveLength(1);
  });
});

describe("loadOpenMembers", () => {
  it("members-visibility: only invitees without a row, last name first", async () => {
    // invitedMembers (Einladungsliste) -> loadMemberNames
    queue = [[{ memberId: "a" }, { memberId: "b" }], [{ id: "b", firstName: "Eva", lastName: "Zorn" }]];
    const open = await loadOpenMembers({ id: "e1", visibility: "members" }, [row("a", "yes")]);
    expect(open).toEqual([{ id: "b", name: "Zorn, Eva" }]);
  });
});

// ── Routen: Selbstanmeldung ──
const post = (path: string, body: Record<string, string> = {}) => eventRoutes.request(path, { method: "POST", body: formBody(body) });

describe("POST /events/:id/rsvp (own)", () => {
  it("forbids users without a linked member", async () => {
    state.member = undefined;
    expect((await post("/e1/rsvp", { status: "yes" })).status).toBe(403);
    expect(state.setCalls).toHaveLength(0);
  });
  it("forbids members who are not invited", async () => {
    state.invited = ["other"];
    expect((await post("/e1/rsvp", { status: "yes" })).status).toBe(403);
    expect(state.setCalls).toHaveLength(0);
  });
  it("forbids invalid status", async () => {
    expect((await post("/e1/rsvp", { status: "maybe" })).status).toBe(403);
  });
  it("404s when the event is not visible", async () => {
    eventRow = undefined;
    expect((await post("/e1/rsvp", { status: "yes" })).status).toBe(404);
  });
  it("lets an invited member switch yes -> no (as non-manager)", async () => {
    state.rows = [row("m1", "yes")];
    expect((await post("/e1/rsvp", { status: "no" })).status).toBe(200);
    expect(state.setCalls[0]).toEqual(["e1", "m1", "no", false]);
  });
  it("manager answers himself only when invited", async () => {
    user = { ...user, permissions: new Set(["events:manage"]) };
    state.invited = [];
    expect((await post("/e1/rsvp", { status: "yes" })).status).toBe(403);
    state.invited = ["m1"];
    expect((await post("/e1/rsvp", { status: "yes" })).status).toBe(200);
    expect(state.setCalls[0][3]).toBe(true);
  });
  it("race: full -> 422 fragment with the reason, no redirect", async () => {
    eventRow = mkEvent({ maxParticipants: 1 });
    state.setResult = "full";
    state.rows = [row("m2", "yes")];
    const res = await post("/e1/rsvp", { status: "yes" });
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain(t("events.rsvp.race.full", { yes: 1, max: 1 }));
  });
  it.each(["deadline", "cancelled"])("%s result -> 422", async (r) => {
    state.setResult = r;
    expect((await post("/e1/rsvp", { status: "yes" })).status).toBe(422);
  });
});

// ── Sichtbarkeit ──
describe("visibility of names", () => {
  it("non-managers get numbers and own status, never names (fragment)", async () => {
    state.rows = [row("m1", "yes"), row("m2", "no", { name: "Geheim, Gerda" })];
    state.open = [{ id: "m3", name: "Offen, Otto" }];
    const body = await (await post("/e1/rsvp", { status: "yes" })).text();
    expect(body).not.toContain("Geheim");
    expect(body).not.toContain("Offen, Otto");
    expect(body).not.toContain("/rsvp/m2");
  });
  it("managers see names incl. the open group", async () => {
    user = { ...user, permissions: new Set(["events:manage"]) };
    state.rows = [row("m2", "no", { name: "Geheim, Gerda" })];
    state.open = [{ id: "m3", name: "Offen, Otto" }];
    const body = await (await post("/e1/rsvp", { status: "yes" })).text();
    expect(body).toContain("Geheim, Gerda");
    expect(body).toContain("Offen, Otto");
  });
  it("section fragment GET needs events:manage", async () => {
    expect((await eventRoutes.request("/e1/rsvp/section")).status).toBe(403);
  });
  it("inactive members are not listed for managers", async () => {
    user = { ...user, permissions: new Set(["events:manage"]) };
    state.rows = [row("m2", "yes", { name: "Weg, Willi", active: false })];
    expect(await (await post("/e1/rsvp", { status: "yes" })).text()).not.toContain("Weg, Willi");
  });
  it("list shows free seats, public list never does", async () => {
    (await import("../db/index.js")).db.query.events.findMany = vi.fn(async () => [mkEvent({ maxParticipants: 10, visibility: "public" })]) as any;
    const list = await (await eventRoutes.request("/")).text();
    expect(list).toContain(t("events.rsvp.listFree", { n: 7 }));
    const pub = await (await eventRoutes.request("/public")).text();
    expect(pub).not.toContain(t("events.rsvp.listFree", { n: 7 }));
    expect(pub).not.toContain(t("events.rsvp.yesCount", { n: 3 }));
  });
});

// ── Stellvertretung / IDOR ──
describe("manager proxy", () => {
  beforeEach(() => { user = { ...user, permissions: new Set(["events:manage"]) }; });
  it("404s for an inactive or unknown member", async () => {
    queue = [[{ id: "m9", exitDate: "2020-01-01", deathDate: null }]];
    expect((await post("/e1/rsvp/m9", { status: "yes" })).status).toBe(404);
    queue = [[]];
    expect((await post("/e1/rsvp/zzz", { status: "yes" })).status).toBe(404);
    expect(state.setCalls).toHaveLength(0);
  });
  it("sets for an active member without invitation, as manager", async () => {
    queue = [[{ id: "m9", exitDate: null, deathDate: null }]];
    expect((await post("/e1/rsvp/m9", { status: "yes" })).status).toBe(200);
    expect(state.setCalls[0]).toEqual(["e1", "m9", "yes", true]);
  });
  it("is scoped to the event: invisible/disabled event -> 404, no write", async () => {
    eventRow = undefined;
    expect((await post("/other/rsvp/m1/delete")).status).toBe(404);
    expect(state.resetCalls).toHaveLength(0);
  });
  it("cancelled event: reset -> 422 even for the manager", async () => {
    state.setResult = "cancelled";
    expect((await post("/e1/rsvp/m1/delete")).status).toBe(422);
  });
});

// ── Abgesagt: Badge / cancelledAt-Sichtbarkeit / Cascade ──
describe("cancelled event display", () => {
  const cancelled = () => mkEvent({ visibility: "public", cancelledAt: new Date("2999-01-01T08:00:00Z") });
  const stamp = t("events.cancelledAt", { date: "" }).trim();
  it("public list shows the 'cancelled' badge", async () => {
    (await import("../db/index.js")).db.query.events.findMany = vi.fn(async () => [cancelled()]) as any;
    expect(await (await eventRoutes.request("/public")).text()).toContain(t("events.cancelled"));
  });
  it("cancelledAt timestamp is shown to managers only", async () => {
    eventRow = cancelled();
    const plain = await (await eventRoutes.request("/e1")).text();
    expect(plain).toContain(t("events.cancelled"));
    expect(plain).not.toContain(stamp);
    user = { ...user, permissions: new Set(["events:manage"]) };
    expect(await (await eventRoutes.request("/e1")).text()).toContain(stamp);
  });
});

describe("schema cascade", () => {
  it.each([["event_rsvps", eventRsvps], ["event_invitees", eventInvitees]] as const)("%s deletes with its member and event", (_n, table) => {
    const fks = getTableConfig(table as any).foreignKeys.map((f) => f.reference().foreignTable);
    const actions = getTableConfig(table as any).foreignKeys.map((f) => f.onDelete);
    expect(fks).toHaveLength(2);
    expect(actions).toEqual(["cascade", "cascade"]);
  });
});

// ── Sperrtexte aus Mitgliedersicht (ohne events:manage) ──
describe("member view locks", () => {
  const page = async () => (await eventRoutes.request("/e1")).text();
  const past = { startsAt: new Date("2020-01-01T10:00:00Z"), endsAt: new Date("2020-01-01T12:00:00Z") };
  it("full: members see the reason and disabled 'yes'", async () => {
    eventRow = mkEvent({ maxParticipants: 1 });
    state.rows = [row("m2", "yes")];
    expect(await page()).toContain(t("events.rsvp.lock.full", { yes: 1, max: 1 }));
  });
  it("full: a member who already said yes is not locked out", async () => {
    eventRow = mkEvent({ maxParticipants: 1 });
    state.rows = [row("m1", "yes")];
    expect(await page()).not.toContain(t("events.rsvp.lock.full", { yes: 1, max: 1 }));
  });
  it("deadline passed: members see the deadline text, the manager does not", async () => {
    eventRow = mkEvent({ ...past, rsvpDeadline: new Date("2019-12-31T10:00:00Z") });
    const text = await page();
    expect(text).toContain("Anmeldeschluss war am");
    user = { ...user, permissions: new Set(["events:manage"]) };
    expect(await page()).not.toContain("Anmeldeschluss war am");
  });
  it("cancelled: members see the cancelled lock", async () => {
    eventRow = mkEvent({ cancelledAt: new Date() });
    expect(await page()).toContain(t("events.rsvp.lock.cancelled"));
  });
});

describe("countPendingRsvps", () => {
  beforeEach(() => { queue = []; });
  it("returns the SQL count for an active member", async () => {
    queue = [[{ id: "m1", exitDate: null, deathDate: null }], [{ n: 2 }]];
    expect(await countPendingRsvps("u1")).toBe(2);
  });
  it("is 0 without a member or for an exited member", async () => {
    queue = [[]];
    expect(await countPendingRsvps("u1")).toBe(0);
    queue = [[{ id: "m1", exitDate: "2020-01-01", deathDate: null }]];
    expect(await countPendingRsvps("u1")).toBe(0);
  });
});
