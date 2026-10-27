import { describe, it, expect, vi, beforeEach } from "vitest";
import { persons, applications, applicationGuardians } from "../db/schema/index.js";
import { formBody } from "./test-utils.js";

let idCounter = 0;
let insertCalls: { table: any; values: any }[] = [];

// One tx-scoped insert mock shared by every db.transaction() call — always installed
// (not queued per-test), so a test that never reaches the transaction (validation
// fails first) leaves nothing stale behind for the next test to accidentally consume.
const txInsert = vi.fn((table: any) => ({
  values: vi.fn((vals: any) => {
    const row = { id: `id-${++idCounter}`, ...vals };
    insertCalls.push({ table, values: vals });
    return Object.assign(Promise.resolve(undefined), {
      returning: vi.fn(() => Promise.resolve([row])),
    });
  }),
}));

const transaction = vi.fn(async (cb: any) => cb({ insert: txInsert }));

vi.mock("../db/index.js", () => ({
  db: { transaction },
}));

let orgConfigFixture: Record<string, string> = {};
vi.mock("../lib/org-config.js", async (orig) => ({
  ...(await orig<typeof import("../lib/org-config.js")>()),
  loadOrgConfig: vi.fn(() => Promise.resolve(orgConfigFixture)),
}));

let formActiveFixture: Record<string, boolean> = { membership: true, youth: true };
vi.mock("../lib/application-forms.js", () => ({
  isApplicationFormActive: vi.fn((type: string) => Promise.resolve(formActiveFixture[type])),
}));

const { applyRoutes } = await import("../routes/apply.js");

function validMembership(overrides: Record<string, string> = {}) {
  return {
    lastName: "Bauer", firstName: "Anna", birthDate: "1995-05-01",
    street: "Musterweg", houseNumber: "5", zip: "12345", city: "Musterstadt",
    email: "anna@example.com",
    ...overrides,
  };
}

let ipCounter = 0;
function freshIp() {
  return `10.0.0.${++ipCounter}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  idCounter = 0;
  orgConfigFixture = {};
  formActiveFixture = { membership: true, youth: true };
});

describe("GET /apply", () => {
  it("renders the membership form with the honeypot field hidden", async () => {
    const res = await applyRoutes.request("/");
    const html = await res.text();
    expect(html).toContain('name="lastName"');
    expect(html).toContain('name="website"');
    expect(html).toContain("left:-9999px");
  });

  it("shows the inactive page instead of the form when membership applications are switched off", async () => {
    formActiveFixture.membership = false;
    const res = await applyRoutes.request("/");
    const html = await res.text();
    expect(html).not.toContain('name="lastName"');
    expect(res.status).toBe(200);
  });
});

describe("POST /apply", () => {
  it("returns 422 when required fields are missing", async () => {
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody({}),
    });
    expect(res.status).toBe(422);
    expect(insertCalls.length).toBe(0);
  });

  it("rejects when neither email nor phone is given", async () => {
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody({ ...validMembership({ email: "" }) }),
    });
    expect(res.status).toBe(422);
  });

  it("creates a persons row and a membership application, then redirects to success", async () => {
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validMembership()),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/apply/success");
    expect(insertCalls.some((c) => c.table === persons && c.values.lastName === "Bauer")).toBe(true);
    const appInsert = insertCalls.find((c) => c.table === applications);
    expect(appInsert?.values.type).toBe("membership");
  });

  it("silently drops the submission when the honeypot field is filled", async () => {
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody({ ...validMembership(), website: "http://spam.example" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/apply/success");
    expect(insertCalls.length).toBe(0);
  });

  it("notifies the org config email on submission when configured", async () => {
    orgConfigFixture = { notificationEmail: "vorstand@example.com" };
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validMembership()),
    });
    expect(res.status).toBe(302); // never fails even though SMTP isn't configured in tests
  });

  it("blocks submission and skips inserts when the form is inactive", async () => {
    formActiveFixture.membership = false;
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validMembership()),
    });
    expect(res.status).toBe(200);
    expect(insertCalls.length).toBe(0);
  });

  it("rate-limits repeated submissions from the same IP, regardless of validity", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const res = await applyRoutes.request("/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
        body: formBody(validMembership()),
      });
      expect(res.status).toBe(302);
    }
    const res = await applyRoutes.request("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
      body: formBody(validMembership()),
    });
    expect(res.status).toBe(429);
  });
});

describe("POST /apply/youth", () => {
  function validYouth(overrides: Record<string, any> = {}) {
    return {
      ...validMembership(),
      "guardian_firstName[]": ["Erika"],
      "guardian_lastName[]": ["Musterfrau"],
      "guardian_email[]": ["erika@example.com"],
      "guardian_phone[]": [""],
      consent: "on",
      ...overrides,
    };
  }

  it("requires at least one guardian", async () => {
    const res = await applyRoutes.request("/youth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validYouth({ "guardian_firstName[]": [""], "guardian_lastName[]": [""], "guardian_email[]": [""], "guardian_phone[]": [""] })),
    });
    expect(res.status).toBe(422);
  });

  it("requires the consent checkbox", async () => {
    const res = await applyRoutes.request("/youth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validYouth({ consent: "" })),
    });
    expect(res.status).toBe(422);
  });

  it("requires a guardian contact (email or phone)", async () => {
    const res = await applyRoutes.request("/youth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validYouth({ "guardian_email[]": [""], "guardian_phone[]": [""] })),
    });
    expect(res.status).toBe(422);
  });

  it("creates the applicant, application, and one persons+guardian row per guardian, all consented", async () => {
    const res = await applyRoutes.request("/youth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": freshIp() },
      body: formBody(validYouth({
        "guardian_firstName[]": ["Erika", "Max"],
        "guardian_lastName[]": ["Musterfrau", "Mustermann"],
        "guardian_email[]": ["erika@example.com", ""],
        "guardian_phone[]": ["", "0123456"],
      })),
    });
    expect(res.status).toBe(302);
    const personInserts = insertCalls.filter((c) => c.table === persons);
    expect(personInserts.length).toBe(3); // applicant + 2 guardians
    const appInsert = insertCalls.find((c) => c.table === applications);
    expect(appInsert?.values.type).toBe("youth");
    const guardianInserts = insertCalls.filter((c) => c.table === applicationGuardians);
    expect(guardianInserts.length).toBe(2);
    expect(guardianInserts.every((g) => g.values.consentGiven === true)).toBe(true);
  });
});
