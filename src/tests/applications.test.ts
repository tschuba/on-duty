import { describe, it, expect, vi, beforeEach } from "vitest";
import { persons, members, applications } from "../db/schema/index.js";
import { t } from "../i18n/index.js";
import { formBody } from "./test-utils.js";
import { makePerson } from "./fixtures.js";

process.env.CHILDREN_AGE_LIMIT = "12";
process.env.YOUTH_AGE_LIMIT = "18";
process.env.ORG_NAME = "Test Feuerwehr";
process.env.OIDC_APP_URL = "http://localhost:3000";

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
  });
  return chain;
}

let findManyResult: any[] = [];
let findFirstResult: any = undefined;
let memberDuplicatesFixture: any[] = [];
let applicationDuplicatesFixture: any[] = [];

const updateCalls: { table: any; set: any }[] = [];

const select = vi.fn(() => ({
  from: vi.fn((table: any) => {
    if (table === members) return chainOf(memberDuplicatesFixture);
    if (table === applications) return chainOf(applicationDuplicatesFixture);
    return chainOf([]);
  }),
}));

function makeUpdate() {
  return vi.fn((table: any) => ({
    set: vi.fn((vals: any) => {
      updateCalls.push({ table, set: vals });
      return { where: vi.fn(() => Promise.resolve(undefined)) };
    }),
  }));
}
const update = makeUpdate();

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      applications: {
        findMany: vi.fn(() => Promise.resolve(findManyResult)),
        findFirst: vi.fn(() => Promise.resolve(findFirstResult)),
      },
    },
    select,
    update,
  },
}));

let currentUser = { id: "u1", permissions: new Set(["applications:review"]), disabled: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", currentUser);
    await next();
  },
}));

let applicationFormsFixture: Record<string, any> = {
  membership: { type: "membership", isActive: true, startDate: null, endDate: null },
  youth: { type: "youth", isActive: true, startDate: null, endDate: null },
};
const saveApplicationFormCalls: { type: string; values: any }[] = [];

vi.mock("../lib/application-forms.js", () => ({
  loadApplicationForms: vi.fn(() => Promise.resolve(applicationFormsFixture)),
  isFormCurrentlyActive: vi.fn((form: any) => !!form?.isActive),
  saveApplicationForm: vi.fn((type: string, values: any) => {
    saveApplicationFormCalls.push({ type, values });
    return Promise.resolve();
  }),
}));

const { applicationRoutes } = await import("../routes/applications.js");

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  findManyResult = [];
  findFirstResult = undefined;
  memberDuplicatesFixture = [];
  applicationDuplicatesFixture = [];
  currentUser = { id: "u1", permissions: new Set(["applications:review"]), disabled: false };
  applicationFormsFixture = {
    membership: { type: "membership", isActive: true, startDate: null, endDate: null },
    youth: { type: "youth", isActive: true, startDate: null, endDate: null },
  };
  saveApplicationFormCalls.length = 0;
});

function makeApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: "app1", personId: "p1", type: "membership", status: "open",
    message: null, rejectedReason: null, submittedAt: new Date("2026-01-01"),
    reviewedAt: null, reviewedBy: null,
    person: makePerson(),
    guardians: [],
    ...overrides,
  };
}

describe("GET /", () => {
  it("lists applications with name and type", async () => {
    findManyResult = [makeApplication()];
    const res = await applicationRoutes.request("/");
    const html = await res.text();
    expect(html).toContain("Anna");
    expect(html).toContain("Bauer");
  });

  it("shows each form's status but hides the settings gear without applications:manage-forms", async () => {
    applicationFormsFixture.membership = { type: "membership", isActive: false, startDate: null, endDate: "2026-09-01" };
    const res = await applicationRoutes.request("/");
    const html = await res.text();
    expect(html).toContain(t("applications.formStatus.inactiveUntil", { date: "01.09.2026" }));
    expect(html).not.toContain('id="form-settings-membership"');
  });

  it("shows the settings gear and modal for a user with applications:manage-forms", async () => {
    currentUser.permissions = new Set(["applications:review", "applications:manage-forms"]);
    const res = await applicationRoutes.request("/");
    const html = await res.text();
    expect(html).toContain('id="form-settings-membership"');
    expect(html).toContain('id="form-settings-youth"');
  });
});

describe("GET /:id", () => {
  it("404s when the application doesn't exist", async () => {
    findFirstResult = undefined;
    const res = await applicationRoutes.request("/app1");
    expect(res.status).toBe(404);
  });

  it("shows the member-duplicate warning and link modal when a matching active member exists", async () => {
    findFirstResult = makeApplication();
    memberDuplicatesFixture = [{ id: "m1", lastName: "Bauer", firstName: "Anna", exitDate: null, deathDate: null }];
    const res = await applicationRoutes.request("/app1");
    const html = await res.text();
    expect(html).toContain("Bereits Mitglied");
    expect(html).toContain(t("applications.duplicate.statusActive"));
    expect(html).toContain('id="approve-modal"');
    expect(html).toContain('name="linkMemberId" value="m1"');
    expect(html).toContain(t("applications.duplicate.linkOptionDescActive"));
  });

  it("shows the link/reactivate modal when the matching member is archived", async () => {
    findFirstResult = makeApplication();
    memberDuplicatesFixture = [{ id: "m1", lastName: "Bauer", firstName: "Anna", exitDate: "2020-01-01", deathDate: null }];
    const res = await applicationRoutes.request("/app1");
    const html = await res.text();
    expect(html).toContain(t("applications.duplicate.statusArchived"));
    expect(html).toContain('id="approve-modal"');
    expect(html).toContain('name="linkMemberId" value="m1"');
  });

  it("shows the age warning for a youth application past the age limit", async () => {
    findFirstResult = makeApplication({ type: "youth", person: makePerson({ birthDate: "1990-01-01" }) });
    const res = await applicationRoutes.request("/app1");
    const html = await res.text();
    expect(html).toContain('name="confirmAge"');
  });

  it("does not show duplicate or age warnings for a clean membership application", async () => {
    findFirstResult = makeApplication();
    const res = await applicationRoutes.request("/app1");
    const html = await res.text();
    expect(html).not.toContain('id="approve-modal"');
    expect(html).not.toContain('name="confirmAge"');
  });
});

describe("POST /:id", () => {
  it("updates the linked person and the application message", async () => {
    findFirstResult = makeApplication();
    const res = await applicationRoutes.request("/app1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ lastName: "Bauer-Korrigiert", firstName: "Anna", message: "Korrigiert" }),
    });
    expect(res.status).toBe(302);
    const personUpdate = updateCalls.find((c) => c.table === persons);
    expect(personUpdate?.set.lastName).toBe("Bauer-Korrigiert");
    const appUpdate = updateCalls.find((c) => c.table === applications);
    expect(appUpdate?.set.message).toBe("Korrigiert");
  });
});

describe("POST /:id/approve", () => {
  it("redirects to the prefilled member form when there are no duplicates", async () => {
    findFirstResult = makeApplication();
    const res = await applicationRoutes.request("/app1/approve", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/new?applicationId=app1&personId=p1");
  });

  it("creates a new independent person when no linkMemberId is submitted, even with an active member match", async () => {
    findFirstResult = makeApplication();
    memberDuplicatesFixture = [{ id: "m1", lastName: "Bauer", firstName: "Anna", exitDate: null, deathDate: null }];
    const res = await applicationRoutes.request("/app1/approve", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/new?applicationId=app1&personId=p1");
  });

  it("redirects to the reactivation form when linkMemberId matches an archived member", async () => {
    findFirstResult = makeApplication();
    memberDuplicatesFixture = [{ id: "m1", lastName: "Bauer", firstName: "Anna", exitDate: "2020-01-01", deathDate: null }];
    const res = await applicationRoutes.request("/app1/approve", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ linkMemberId: "m1" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/new?applicationId=app1&linkMemberId=m1");
  });

  it("redirects to the link form when linkMemberId matches an active member", async () => {
    findFirstResult = makeApplication();
    memberDuplicatesFixture = [{ id: "m1", lastName: "Bauer", firstName: "Anna", exitDate: null, deathDate: null }];
    const res = await applicationRoutes.request("/app1/approve", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ linkMemberId: "m1" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members/new?applicationId=app1&linkMemberId=m1");
  });

  it("rejects a linkMemberId that isn't among the found duplicates (tamper guard)", async () => {
    findFirstResult = makeApplication();
    memberDuplicatesFixture = [{ id: "m1", lastName: "Bauer", firstName: "Anna", exitDate: null, deathDate: null }];
    const res = await applicationRoutes.request("/app1/approve", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ linkMemberId: "someone-elses-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("auto-rejects open twin applications found as duplicates", async () => {
    findFirstResult = makeApplication();
    applicationDuplicatesFixture = [{ id: "app2", lastName: "Bauer", firstName: "Anna" }];
    const res = await applicationRoutes.request("/app1/approve", { method: "POST" });
    expect(res.status).toBe(302);
    const twinReject = updateCalls.find((c) => c.table === applications && c.set.status === "rejected");
    expect(twinReject?.set.rejectedReason).toBe(t("applications.duplicate.autoRejectedReason"));
  });

  it("404s when the application is no longer open", async () => {
    findFirstResult = makeApplication({ status: "approved" });
    const res = await applicationRoutes.request("/app1/approve", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/reject", () => {
  it("sets status rejected with the given reason", async () => {
    findFirstResult = makeApplication();
    const res = await applicationRoutes.request("/app1/reject", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ rejectedReason: "Kein Bedarf" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/applications");
    const appUpdate = updateCalls.find((c) => c.table === applications);
    expect(appUpdate?.set.status).toBe("rejected");
    expect(appUpdate?.set.rejectedReason).toBe("Kein Bedarf");
  });
});

describe("POST /forms/:type", () => {
  it("saves status and dates for a valid type", async () => {
    const res = await applicationRoutes.request("/forms/youth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ status: "active", startDate: "2026-09-01", endDate: "2026-10-31" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/applications");
    expect(saveApplicationFormCalls).toEqual([
      { type: "youth", values: { isActive: true, startDate: "2026-09-01", endDate: "2026-10-31" } },
    ]);
  });

  it("treats a missing status as inactive and blank dates as null", async () => {
    const res = await applicationRoutes.request("/forms/membership", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ status: "inactive" }),
    });
    expect(res.status).toBe(302);
    expect(saveApplicationFormCalls).toEqual([
      { type: "membership", values: { isActive: false, startDate: null, endDate: null } },
    ]);
  });

  it("404s for an unknown form type", async () => {
    const res = await applicationRoutes.request("/forms/bogus", { method: "POST" });
    expect(res.status).toBe(404);
    expect(saveApplicationFormCalls.length).toBe(0);
  });
});
