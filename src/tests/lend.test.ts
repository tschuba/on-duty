import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";

process.env.OIDC_APP_URL = "http://localhost:3000";

const future = new Date();
future.setDate(future.getDate() + 10);
const FUTURE_FROM = future.toISOString().slice(0, 10);
future.setDate(future.getDate() + 1);
const FUTURE_TO = future.toISOString().slice(0, 10);

let lendingItemFixture: any = undefined;
let loanRequestFixture: any = undefined;
let lendingLoansFixture: any[] = [];
let insertCalls: { table: string; values: any }[] = [];

const txInsert = vi.fn((table: any) => ({
  values: vi.fn((vals: any) => {
    insertCalls.push({ table: table === "persons" ? "persons" : "loanRequests", values: vals });
    const id = insertCalls.length === 1 ? "person-1" : "request-1";
    return { returning: vi.fn(() => Promise.resolve([{ id, ...vals }])) };
  }),
}));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      lendingItems: { findFirst: vi.fn(() => Promise.resolve(lendingItemFixture)) },
      loanRequests: { findFirst: vi.fn(() => Promise.resolve(loanRequestFixture)) },
      lendingLoans: { findMany: vi.fn(() => Promise.resolve(lendingLoansFixture)) },
    },
    transaction: vi.fn(async (cb: any) => cb({ insert: txInsert })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })) })),
  },
}));

let orgConfigFixture: Record<string, string> = { orgName: "Test Feuerwehr" };
vi.mock("../lib/org-config.js", () => ({
  loadOrgConfig: vi.fn(() => Promise.resolve(orgConfigFixture)),
}));

const sendMail = vi.fn(() => Promise.resolve({ sent: true }));
vi.mock("../lib/mail.js", () => ({ sendMail }));

const { lendRoutes } = await import("../routes/lend.js");

function requestableItem(overrides: Record<string, any> = {}) {
  return {
    id: "item-1", individualTracking: true, publicRequestable: true,
    maxRequestQuantity: 1, timesRequired: false,
    inventoryItem: { name: "Anhänger", retiredAt: null, quantity: 1, retiredQuantity: 0 },
    ...overrides,
  };
}

function validBody(overrides: Record<string, string> = {}) {
  return {
    firstName: "Max", lastName: "Muster", email: "max@example.com",
    plannedFrom: FUTURE_FROM, plannedTo: FUTURE_TO, message: "Brauche den Anhänger.",
    ...overrides,
  };
}

let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

beforeEach(() => {
  insertCalls = [];
  loanRequestFixture = undefined;
  lendingLoansFixture = [];
  sendMail.mockClear();
});

describe("GET /lend/:itemId/blocked", () => {
  it("404s when the item isn't requestable", async () => {
    lendingItemFixture = undefined;
    const res = await lendRoutes.request("/missing/blocked");
    expect(res.status).toBe(404);
  });

  it("returns fully booked days for an individually tracked item", async () => {
    lendingItemFixture = requestableItem();
    lendingLoansFixture = [{ plannedFrom: FUTURE_FROM, plannedTo: FUTURE_FROM, pickedUpAt: null, returnedAt: null, plannedFromTime: null, plannedToTime: null, quantity: 1 }];
    const res = await lendRoutes.request("/item-1/blocked");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([FUTURE_FROM]);
  });
});

describe("GET /lend/:itemId", () => {
  it("404s when the item isn't requestable", async () => {
    lendingItemFixture = undefined;
    const res = await lendRoutes.request("/missing");
    expect(res.status).toBe(404);
  });

  it("404s when publicRequestable is false", async () => {
    lendingItemFixture = requestableItem({ publicRequestable: false });
    const res = await lendRoutes.request("/item-1");
    expect(res.status).toBe(404);
  });

  it("404s when the item is retired", async () => {
    lendingItemFixture = requestableItem({ inventoryItem: { name: "x", retiredAt: "2020-01-01", quantity: 1, retiredQuantity: 0 } });
    const res = await lendRoutes.request("/item-1");
    expect(res.status).toBe(404);
  });

  it("renders the form for a requestable item", async () => {
    lendingItemFixture = requestableItem();
    const res = await lendRoutes.request("/item-1");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Anhänger");
  });
});

describe("POST /lend/:itemId", () => {
  it("rejects via honeypot without inserting anything", async () => {
    lendingItemFixture = requestableItem();
    const res = await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody({ ...validBody(), website: "spam" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.length).toBe(0);
  });

  it("returns validation errors for an incomplete submission", async () => {
    lendingItemFixture = requestableItem();
    const res = await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validBody({ message: "" })),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("rejects a conflicting period for an individually tracked item", async () => {
    lendingItemFixture = requestableItem();
    lendingLoansFixture = [{ plannedFrom: FUTURE_FROM, plannedTo: FUTURE_TO, pickedUpAt: null, returnedAt: null, plannedFromTime: null, plannedToTime: null, quantity: 1 }];
    const res = await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validBody()),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("creates a person and a loan request, then redirects to the status page", async () => {
    lendingItemFixture = requestableItem();
    const res = await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validBody()),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/lend\/status\/[0-9a-f]{32}\?submitted=1$/);
    expect(insertCalls.length).toBe(2);
  });

  it("notifies the manager when notificationEmail is configured", async () => {
    lendingItemFixture = requestableItem();
    orgConfigFixture = { orgName: "Test Feuerwehr", notificationEmail: "verwalter@example.com" };
    await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validBody()),
    });
    expect(sendMail).toHaveBeenCalledWith("verwalter@example.com", expect.any(String), expect.any(String), { "X-On-Duty-Type": "lend-request" });
  });

  it("skips the manager mail when notificationEmail is unset", async () => {
    lendingItemFixture = requestableItem();
    orgConfigFixture = { orgName: "Test Feuerwehr" };
    await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validBody()),
    });
    expect(sendMail).not.toHaveBeenCalledWith("verwalter@example.com", expect.any(String), expect.any(String), expect.anything());
  });

  it("sends a submission confirmation to the applicant's email", async () => {
    lendingItemFixture = requestableItem();
    await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validBody()),
    });
    expect(sendMail).toHaveBeenCalledWith("max@example.com", expect.any(String), expect.any(String), { "X-On-Duty-Type": "lend-request" });
  });

  it("skips the confirmation mail when no email was given", async () => {
    lendingItemFixture = requestableItem();
    await lendRoutes.request("/item-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody({ ...validBody(), email: "", phone: "09281123456" }),
    });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("GET /lend/status/:token", () => {
  it("404s for an unknown token", async () => {
    loanRequestFixture = undefined;
    const res = await lendRoutes.request("/status/unknown");
    expect(res.status).toBe(404);
  });

  it("shows the request status with no-index headers", async () => {
    loanRequestFixture = {
      statusToken: "abc", status: "open", quantity: 1,
      plannedFrom: FUTURE_FROM, plannedTo: FUTURE_TO,
      submittedAt: new Date("2099-01-01"), reviewedAt: null,
      lendingItem: { inventoryItem: { name: "Anhänger" } },
    };
    const res = await lendRoutes.request("/status/abc");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await res.text()).toContain("Anhänger");
  });
});
