import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.CHILDREN_AGE_LIMIT = "12";
process.env.YOUTH_AGE_LIMIT = "18";
process.env.ANNIVERSARY_CUTOFF = "01-06";
process.env.ORG_NAME = "Test Feuerwehr";

let findManyResult: any[] = [];
let ayFixture: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      members: {
        findMany: vi.fn(() => Promise.resolve(findManyResult)),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => Promise.resolve(ayFixture)),
      })),
    })),
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", { id: "u1", permissions: new Set(["members:read"]), disabled: false });
    await next();
  },
}));

const { anniversaryRoutes } = await import("../routes/anniversaries.js");

beforeEach(() => {
  vi.clearAllMocks();
  findManyResult = [];
  ayFixture = [];
});

function makeMemberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    entryDate: "2010-01-01",
    exitDate: null,
    deathDate: null,
    person: {
      id: "p1",
      firstName: "Anna",
      lastName: "Bauer",
      birthDate: "1985-05-01",
      street: "Hauptstr.",
      houseNumber: "1",
      zip: "12345",
      city: "Altenhammer",
      phone: "123",
      email: "a@b.de",
      gender: "female",
    },
    assignments: [
      { id: "a1", memberId: "m1", memberRoleId: "r1", from: "2010-01-01", to: null, autoClosed: false, role: { id: "r1", title: "Aktiv", grantsActiveStatus: true, isProtected: false } },
    ],
    ...overrides,
  };
}

describe("GET /anniversaries", () => {
  it("renders the page with events built from the joined person data", async () => {
    findManyResult = [makeMemberRow()];
    const res = await anniversaryRoutes.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Bauer");
  });
});

describe("GET /anniversaries/export", () => {
  it("returns an xlsx workbook including address/contact columns from the joined person data", async () => {
    findManyResult = [makeMemberRow()];
    const res = await anniversaryRoutes.request("/export?contact=1&addr=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
  });
});
