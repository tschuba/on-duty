import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";
import { t } from "../i18n/index.js";

process.env.ORG_NAME = "Test Feuerwehr";
process.env.APP_TIMEZONE = "Europe/Berlin";

let eventsFindManyResult: any[] = [];
let eventFindFirstResult: any = undefined;
let tagRows: { tag: string }[] = [];
let rolesRows: { id: string; name: string }[] = [];

const insertCalls: { table: any; values: any }[] = [];
const updateCalls: { table: any; set: any }[] = [];
const deleteCalls: { table: any }[] = [];

function makeInsert() {
  return vi.fn((table: any) => ({
    values: vi.fn((vals: any) => {
      insertCalls.push({ table, values: vals });
      const row = { id: "new-id", ...(Array.isArray(vals) ? vals[0] : vals) };
      return Object.assign(Promise.resolve(undefined), { returning: vi.fn(() => Promise.resolve([row])) });
    }),
  }));
}
function makeUpdate() {
  return vi.fn((table: any) => ({
    set: vi.fn((vals: any) => {
      updateCalls.push({ table, set: vals });
      return { where: vi.fn(() => Promise.resolve(undefined)) };
    }),
  }));
}
function makeDelete() {
  return vi.fn((table: any) => {
    deleteCalls.push({ table });
    return { where: vi.fn(() => Promise.resolve(undefined)) };
  });
}

const insert = makeInsert();
const update = makeUpdate();
const del = makeDelete();
const transaction = vi.fn(async (cb: any) => cb({ insert, update, delete: del }));

// select() chain used by eventTagVocabulary (select({tag}).from(eventTags).innerJoin(events).where(...))
// and loadRoles (select({id,name}).from(appRoles).orderBy(...)) — same thenable chain covers both.
function selectChain(result: any[]) {
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      events: {
        findMany: vi.fn(() => Promise.resolve(eventsFindManyResult)),
        findFirst: vi.fn(() => Promise.resolve(eventFindFirstResult)),
      },
    },
    select: vi.fn((cols: any) => {
      if (cols && "name" in cols) return selectChain(rolesRows);
      return selectChain(tagRows);
    }),
    insert,
    update,
    delete: del,
    transaction,
  },
}));

let currentUser = { id: "u1", permissions: new Set(["events:manage"]), roleIds: new Set<string>(), disabled: false };

vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (required?: any) => async (c: any, next: any) => {
      if (required) {
        const req = Array.isArray(required) ? required : [required];
        if (!req.every((p: string) => currentUser.permissions.has(p))) return c.text("forbidden", 403);
      }
      c.set("user", currentUser);
      await next();
    },
  };
});

const { eventRoutes } = await import("../routes/events.js");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  eventsFindManyResult = [];
  eventFindFirstResult = undefined;
  tagRows = [];
  rolesRows = [];
  currentUser = { id: "u1", permissions: new Set(["events:manage"]), roleIds: new Set<string>(), disabled: false };
});

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1", title: "Übung", location: "Gerätehaus", description: null,
    allDay: false, startsAt: new Date("2026-11-15T17:00:00Z"), endsAt: new Date("2026-11-15T19:00:00Z"),
    visibility: "loggedIn", tags: [], visibleRoles: [],
    ...overrides,
  };
}

describe("GET /events", () => {
  it("renders the event list", async () => {
    eventsFindManyResult = [makeEvent()];
    const res = await eventRoutes.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Übung");
    expect(body).toContain("Gerätehaus");
  });

  it("marks a roles-event without assigned roles with the orphan badge for managers", async () => {
    eventsFindManyResult = [makeEvent({ visibility: "roles", visibleRoles: [] })];
    const body = await (await eventRoutes.request("/")).text();
    expect(body).toContain(t("events.orphanRoles"));
  });

  it("renders calendar and list together", async () => {
    eventsFindManyResult = [makeEvent()];
    const body = await (await eventRoutes.request("/")).text();
    expect(body).toContain("ev-calendar");
    expect(body).toContain("data-date=");
  });

  it("returns only the rows of a month for ?rows=", async () => {
    eventsFindManyResult = [makeEvent()];
    const body = await (await eventRoutes.request("/?rows=1999-01")).text();
    expect(body).not.toContain("<tr");
  });

  it("hides the create action without events:manage", async () => {
    currentUser = { ...currentUser, permissions: new Set() };
    const body = await (await eventRoutes.request("/")).text();
    expect(body).not.toContain("/events/new");
  });
});

describe("GET /events/public", () => {
  it("is reachable without auth and never shows the description", async () => {
    eventsFindManyResult = [makeEvent({ visibility: "public", description: "geheim" })];
    const res = await eventRoutes.request("/public");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Übung");
    expect(body).not.toContain("geheim");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});

describe("POST /events/new", () => {
  it("creates an event with tags", async () => {
    const res = await eventRoutes.request("/new", {
      method: "POST",
      body: formBody({ title: "Neue Übung", startsAt: "2026-11-15T18:00", endsAt: "2026-11-15T20:00", visibility: "loggedIn", tags: "a,b" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/events");
    expect(insertCalls[0].values.title).toBe("Neue Übung");
  });

  it("rejects end before start", async () => {
    const res = await eventRoutes.request("/new", {
      method: "POST",
      body: formBody({ title: "X", startsAt: "2026-11-15T20:00", endsAt: "2026-11-15T18:00", visibility: "loggedIn" }),
    });
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain(t("events.form.error.endBeforeStart"));
  });

  it("requires at least one role for roles visibility", async () => {
    const res = await eventRoutes.request("/new", {
      method: "POST",
      body: formBody({ title: "X", startsAt: "2026-11-15T18:00", endsAt: "2026-11-15T20:00", visibility: "roles" }),
    });
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain(t("events.form.error.rolesRequired"));
  });

  it("requires events:manage", async () => {
    currentUser = { ...currentUser, permissions: new Set() };
    const res = await eventRoutes.request("/new", { method: "POST", body: formBody({ title: "X" }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /events/:id/edit", () => {
  it("updates an existing event", async () => {
    eventFindFirstResult = makeEvent();
    const res = await eventRoutes.request("/e1/edit", {
      method: "POST",
      body: formBody({ title: "Geändert", startsAt: "2026-11-15T18:00", endsAt: "2026-11-15T20:00", visibility: "public" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set.title).toBe("Geändert");
  });

  it("404s for an unknown event", async () => {
    eventFindFirstResult = undefined;
    const res = await eventRoutes.request("/missing/edit", { method: "POST", body: formBody({ title: "X" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /events/:id/delete", () => {
  it("deletes and returns an empty row", async () => {
    eventsFindManyResult = [];
    const res = await eventRoutes.request("/e1/delete", { method: "POST" });
    expect(res.status).toBe(200);
    expect(deleteCalls.length).toBe(1);
    const body = await res.text();
    expect(body).toBe("");
  });
});
