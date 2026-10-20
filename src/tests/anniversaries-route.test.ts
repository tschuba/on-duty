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
      mobile: "0170",
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

describe("GET /anniversaries filters", () => {
  // Entry 2010-01-01, firstEntry 2000-01-01 → service 25 in 2025, membership 15 in 2025 (cutoff 01-06).
  const setup = () => {
    findManyResult = [makeMemberRow({ firstEntryDate: "2000-01-01" })];
    ayFixture = [
      { kind: "service", year: 25, title: "Dienst25" },
      { kind: "membership", year: 15, title: "Mitglied15" },
    ];
  };
  const get = async (filter: string) =>
    (await anniversaryRoutes.request(`/?start=2025-01-01&end=2025-12-31&filter=${filter}`)).text();

  it("service shows only service rows", async () => {
    setup();
    const html = await get("service");
    expect(html).toContain("Dienst25");
    expect(html).not.toContain("Mitglied15");
  });

  it("membership shows only membership rows", async () => {
    setup();
    const html = await get("membership");
    expect(html).toContain("Mitglied15");
    expect(html).not.toContain("Dienst25");
  });

  it("multiple filters are OR-combined", async () => {
    setup();
    const html = await get("service&filter=membership");
    expect(html).toContain("Dienst25");
    expect(html).toContain("Mitglied15");
  });

  it("unknown filter value falls back to all", async () => {
    setup();
    const html = await get("anniversaries");
    expect(html).toContain("Dienst25");
    expect(html).toContain("Mitglied15");
  });

  const hrefOf = (html: string, label: string) =>
    html.match(new RegExp(`<a href="([^"]*)"[^>]*>${label}</a>`))![1].replace(/&amp;/g, "&");

  it("toggle link adds an inactive filter and removes an active one", async () => {
    setup();
    let html = await get("service");
    expect(new URL(hrefOf(html, "Nur Mitgliedsjubiläen"), "http://x").searchParams.getAll("filter")).toEqual(["service", "membership"]);
    html = await get("service&filter=membership");
    expect(new URL(hrefOf(html, "Nur Dienstjubiläen"), "http://x").searchParams.getAll("filter")).toEqual(["membership"]);
  });

  it("last active filter cannot be removed", async () => {
    setup();
    const html = await get("service");
    expect(html).toContain("pointer-events-none");
    expect(new URL(hrefOf(html, "Nur Dienstjubiläen"), "http://x").searchParams.getAll("filter")).toEqual(["service"]);
  });

  it("All button activates every filter", async () => {
    setup();
    const html = await get("service");
    expect(new URL(hrefOf(html, "Alle"), "http://x").searchParams.getAll("filter")).toEqual(["service", "membership", "birthdays"]);
  });

  it("merges identical service and membership rows", async () => {
    findManyResult = [makeMemberRow()];
    ayFixture = [{ kind: "service", year: 15, title: null }, { kind: "membership", year: 15, title: null }];
    const html = await get("all");
    expect(html).toContain("Dienst + Mitgliedschaft");
  });
});
