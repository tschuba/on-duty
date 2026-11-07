import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";

let selectRows: any[] = [];
let memberRows: any[] = [];
const inserted: any[] = [];
const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, then: (r: any) => Promise.resolve(selectRows).then(r) };
vi.mock("../db/index.js", () => ({
  db: { select: vi.fn(() => chain), query: { members: { findMany: vi.fn(async () => memberRows) } } },
}));

const { visibilityCondition, isActiveMember, saveEventTagsAndInvitees, findMembersByStatus } = await import("../lib/events.js");

beforeEach(() => { selectRows = []; memberRows = []; inserted.length = 0; });

const sqlOf = (c: any) => c ? new PgDialect().sqlToQuery(c) : undefined;

describe("visibilityCondition", () => {
  it("events:manage sees everything", () => {
    expect(visibilityCondition({ id: "u", permissions: new Set(["events:manage"]) })).toBeUndefined();
  });
  it("anonymous sees only public", () => {
    expect(sqlOf(visibilityCondition(undefined))!.params).toEqual(["public"]);
  });
  it("login sees public, loggedIn and members events of invited members only", () => {
    const q = sqlOf(visibilityCondition({ id: "u7", permissions: new Set() }))!;
    expect(q.params.slice(0, 3)).toEqual(["public", "loggedIn", "members"]);
    expect(q.params).not.toContain("roles");
  });
});

describe("isActiveMember", () => {
  it("excludes exited and deceased", () => {
    expect(isActiveMember({ exitDate: null, deathDate: null })).toBe(true);
    expect(isActiveMember({ exitDate: "2025-01-01", deathDate: null })).toBe(false);
    expect(isActiveMember({ exitDate: null, deathDate: "2025-01-01" })).toBe(false);
  });
});

describe("saveEventTagsAndInvitees", () => {
  function tx() {
    const del = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const insert = vi.fn(() => ({ values: vi.fn(async (v: any) => { inserted.push(v); }) }));
    return { delete: del, insert, select: () => chain } as any;
  }
  it("stores only active members for visibility members", async () => {
    selectRows = [{ id: "a", exitDate: null, deathDate: null }, { id: "b", exitDate: "2024-01-01", deathDate: null }];
    await saveEventTagsAndInvitees(tx(), "e1", [], "members", ["a", "b"]);
    expect(inserted).toEqual([[{ eventId: "e1", memberId: "a" }]]);
  });
  it("stores no list for other visibilities", async () => {
    await saveEventTagsAndInvitees(tx(), "e1", [], "loggedIn", ["a"]);
    expect(inserted).toEqual([]);
  });
});

describe("findMembersByStatus", () => {
  const m = (id: string, last: string, birthDate: string, extra: any = {}) => ({
    id, exitDate: null, deathDate: null, person: { firstName: "X", lastName: last, birthDate },
    assignments: [{ role: { grantsActiveStatus: true }, from: null, to: null }], ...extra,
  });
  it("ORs statuses, skips exited members", async () => {
    memberRows = [m("act", "B", "1990-01-01"), m("you", "A", `${new Date().getFullYear() - 15}-01-01`), m("gone", "C", "1990-01-01", { exitDate: "2024-01-01" })];
    expect((await findMembersByStatus(["active", "youth"])).map((x) => x.id)).toEqual(["you", "act"]);
    expect((await findMembersByStatus(["active"])).map((x) => x.id)).toEqual(["act"]);
    expect(await findMembersByStatus([])).toEqual([]);
  });
});

describe("migration 0077 backfill", () => {
  const sql = readFileSync("drizzle/0077_event_invitees_backfill.sql", "utf8");
  it("fills from role holders with login, dedupes, and flips roles events", () => {
    expect(sql).toContain("SELECT DISTINCT");
    expect(sql).toContain('JOIN "persons" p ON p."user_id" = uar."user_id"');
    expect(sql).toContain('JOIN "members" m ON m."person_id" = p."id"');
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql).toContain(`SET "visibility" = 'members' WHERE "visibility" = 'roles'`);
    expect(sql.indexOf("INSERT")).toBeLessThan(sql.indexOf("UPDATE"));
  });
  it("adds the enum value by recreating the type (ADD VALUE would be unusable in the backfill's transaction)", () => {
    expect(readFileSync("drizzle/0075_ambitious_reavers.sql", "utf8")).toContain("'roles', 'members'");
  });
});
