import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";

process.env.OIDC_APP_URL = "http://localhost:3000";

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
  });
  return chain;
}

let requestsFixture: any[] = [];
let personPoolFixture: any[] = [];
let lendingLoansFixture: any[] = [];
const updateCalls: { table: string; set: any }[] = [];
const insertCalls: { table: string; values: any }[] = [];
let insertedLoanId = "loan-new";

const txInsert = vi.fn((table: any) => ({
  values: vi.fn((vals: any) => {
    const table_ = table?.toString?.().includes("lending_loans") || "borrowerPersonId" in vals ? "lendingLoans" : "persons";
    insertCalls.push({ table: table_, values: vals });
    return { returning: vi.fn(() => Promise.resolve([{ id: table_ === "lendingLoans" ? insertedLoanId : "person-new", ...vals }])) };
  }),
}));
const txUpdate = vi.fn(() => ({
  set: vi.fn((vals: any) => {
    updateCalls.push({ table: "loanRequests", set: vals });
    return { where: vi.fn(() => Promise.resolve(undefined)) };
  }),
}));

const update = vi.fn(() => ({
  set: vi.fn((vals: any) => {
    updateCalls.push({ table: "loanRequests", set: vals });
    return { where: vi.fn(() => Promise.resolve(undefined)) };
  }),
}));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      loanRequests: {
        findMany: vi.fn(() => Promise.resolve(requestsFixture)),
        findFirst: vi.fn(() => Promise.resolve(requestsFixture[0])),
      },
      lendingLoans: { findMany: vi.fn(() => Promise.resolve(lendingLoansFixture)) },
      inventoryItems: { findMany: vi.fn(() => Promise.resolve([])) },
    },
    select: vi.fn(() => chainOf(personPoolFixture)),
    update,
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
    transaction: vi.fn(async (cb: any) => cb({ insert: txInsert, update: txUpdate })),
  },
}));

let currentUser = { id: "u1", permissions: new Set(["lending:manage"]), disabled: false };
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

let orgConfigFixture: Record<string, string> = {};
vi.mock("../lib/org-config.js", () => ({
  loadOrgConfig: vi.fn(() => Promise.resolve(orgConfigFixture)),
}));

vi.mock("../lib/settings.js", () => ({
  getSettings: vi.fn(() => Promise.resolve({ loanRequestRetentionDays: "90" })),
}));

const sendMail = vi.fn(() => Promise.resolve({ sent: true }));
vi.mock("../lib/mail.js", () => ({ sendMail }));

const { loanRequestRoutes } = await import("../routes/loan-requests.js");

function makeRequest(overrides: Record<string, any> = {}) {
  return {
    id: "req-1", status: "open", quantity: 1,
    plannedFrom: "2099-01-10", plannedTo: "2099-01-11",
    plannedFromTime: null, plannedToTime: null,
    message: "Bitte", submittedAt: new Date("2099-01-01"), reviewedAt: null,
    notifiedAt: null, rejectedReason: null, statusToken: "tok",
    person: { id: "person-1", firstName: "Max", lastName: "Muster", email: "max@example.com", phone: null },
    lendingItem: { id: "item-1", individualTracking: true, inventoryItem: { name: "Anhänger", quantity: 1, retiredQuantity: 0 } },
    ...overrides,
  };
}

beforeEach(() => {
  requestsFixture = [];
  personPoolFixture = [];
  lendingLoansFixture = [];
  updateCalls.length = 0;
  insertCalls.length = 0;
  sendMail.mockClear();
});

describe("GET /inventory/requests", () => {
  it("defaults to open requests and lists them", async () => {
    requestsFixture = [makeRequest(), makeRequest({ id: "req-2", status: "rejected" })];
    const res = await loanRequestRoutes.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Anhänger");
    expect(html).not.toContain("req-2");
  });
});

describe("GET /inventory/requests/:id", () => {
  it("404s for an unknown id", async () => {
    requestsFixture = [];
    const res = await loanRequestRoutes.request("/req-1");
    expect(res.status).toBe(404);
  });

  it("shows the detail page", async () => {
    requestsFixture = [makeRequest()];
    const res = await loanRequestRoutes.request("/req-1");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Anhänger");
  });
});

describe("POST /inventory/requests/:id/approve", () => {
  it("creates a loan and marks the request approved", async () => {
    requestsFixture = [makeRequest()];
    const res = await loanRequestRoutes.request("/req-1/approve", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ personId: "" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.some((c) => c.table === "lendingLoans")).toBe(true);
    expect(updateCalls[0].set.status).toBe("approved");
    expect(updateCalls[0].set.loanId).toBe(insertedLoanId);
  });

  it("refuses to approve when availability now conflicts", async () => {
    requestsFixture = [makeRequest()];
    lendingLoansFixture = [{ id: "other", plannedFrom: "2099-01-10", plannedTo: "2099-01-11", plannedFromTime: null, plannedToTime: null, pickedUpAt: null, returnedAt: null, quantity: 1 }];
    const res = await loanRequestRoutes.request("/req-1/approve", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ personId: "" }),
    });
    expect(res.status).toBe(302);
    expect(insertCalls.length).toBe(0);
  });

  it("notifies the applicant by mail when an email is on file", async () => {
    requestsFixture = [makeRequest()];
    await loanRequestRoutes.request("/req-1/approve", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ personId: "" }),
    });
    expect(sendMail).toHaveBeenCalledWith("max@example.com", expect.any(String), expect.any(String), { "X-On-Duty-Type": "lend-request" });
  });
});

describe("POST /inventory/requests/:id/reject", () => {
  it("rejects the request with an internal reason", async () => {
    requestsFixture = [makeRequest()];
    const res = await loanRequestRoutes.request("/req-1/reject", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ rejectedReason: "Nicht verfügbar" }),
    });
    expect(res.status).toBe(302);
    expect(updateCalls[0].set.status).toBe("rejected");
    expect(updateCalls[0].set.rejectedReason).toBe("Nicht verfügbar");
    expect(insertCalls.length).toBe(0);
  });
});
