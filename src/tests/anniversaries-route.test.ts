import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";

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

describe("GET /anniversaries range persistence", () => {
  it("keeps range/rel/dir on preset links and the filter popup form", async () => {
    findManyResult = [makeMemberRow()];
    const html = (await (await anniversaryRoutes.request("/?range=rel&rel=P6M&dir=future")).text()).replace(/&amp;/g, "&");
    expect(html).toMatch(/<form[^>]*id="af"[^>]*>\s*<input type="hidden" name="range" value="rel"/);
    expect(html).toContain("'range','rel','dir','ref','yr','start','end'");
  });

  it("exports the same resolved range as range=rel", async () => {
    findManyResult = [makeMemberRow()];
    const res = await anniversaryRoutes.request("/export?range=rel&rel=P1Y&dir=future");
    expect(res.status).toBe(200);
  });
});

describe("GET /anniversaries/export", () => {
  it("returns an xlsx workbook including address/contact columns from the joined person data", async () => {
    findManyResult = [makeMemberRow()];
    const res = await anniversaryRoutes.request("/export?contact=1&addr=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
  });

  it("redirects with a flash and no xlsx when there are no events", async () => {
    findManyResult = [];
    const res = await anniversaryRoutes.request("/export?filter=service&contact=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/anniversaries?filter=service");
    expect(res.headers.get("set-cookie")).toContain("flash");
  });

  it("disables the export button on the page when there are no events", async () => {
    findManyResult = [];
    const html = await (await anniversaryRoutes.request("/")).text();
    expect(html).toMatch(/title="Keine Einträge zum Exportieren"[\s\S]*?disabled/);
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

  it("renders the reset button disabled at the default and enabled with an active filter", async () => {
    setup();
    const btn = async (q: string) => (await (await anniversaryRoutes.request(`/?${q}`)).text()).match(/<button[^>]*data-reset[^>]*>/)![0];
    expect(await btn("start=2025-01-01&end=2025-12-31")).toContain("disabled");
    expect(await btn("start=2025-01-01&end=2025-12-31&mod=10")).not.toContain("disabled");
  });

  it("shows the filter label in the popup button", async () => {
    setup();
    const html = await (await anniversaryRoutes.request("/?filter=birthdays&mod=10&gte=66")).text();
    expect(html).toContain("Runde Geburtstage ab 66 J.");
  });

  it("merges identical service and membership rows", async () => {
    findManyResult = [makeMemberRow()];
    ayFixture = [{ kind: "service", year: 15, title: null }, { kind: "membership", year: 15, title: null }];
    const html = await get("all");
    expect(html).toContain("Dienst + Mitgliedschaft");
  });
});

describe("GET /anniversaries month rows", () => {
  it("renders one tbody with a sticky month-row per month", async () => {
    findManyResult = [makeMemberRow({ firstEntryDate: "2000-01-01" })];
    ayFixture = [{ kind: "service", year: 25, title: "Dienst25" }];
    const html = await (await anniversaryRoutes.request("/?start=2025-01-01&end=2025-12-31")).text();
    const bodies = html.match(/<tbody>/g)?.length ?? 0;
    const rows = html.match(/class="month-row"/g)?.length ?? 0;
    expect(rows).toBeGreaterThan(0);
    expect(bodies).toBe(rows);
  });
});

describe("mod filter with multiple values", () => {
  // Entry 2010-01-01 → service years 5 (2015), 7 (2017), 10 (2020).
  const setup = () => {
    findManyResult = [makeMemberRow({ entryDate: "2010-01-01" })];
    ayFixture = [5, 7, 10].map((year) => ({ kind: "service", year, title: `T${year}` }));
  };
  const query = "start=2015-01-01&end=2020-12-31&mod=5&mod=10";

  it("page keeps rows matching either mod", async () => {
    setup();
    const html = await (await anniversaryRoutes.request(`/?${query}`)).text();
    expect(html).toContain("T5");
    expect(html).toContain("T10");
    expect(html).not.toContain("T7");
  });

  it("export returns the same rows as the page", async () => {
    setup();
    const res = await anniversaryRoutes.request(`/export?${query}`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1);
    expect(rows.map((r) => r[6]).filter(Boolean)).toEqual(["T5", "T10"]); // birthdays have no title
  });
});

describe("status badge", () => {
  // Geboren 1940 → über der Aktiv-Altersgrenze: mit aktiver Rolle zum Stichtag passiv, ohne fördernd.
  const old = (grantsActiveStatus: boolean) =>
    makeMemberRow({
      firstEntryDate: "2000-01-01",
      person: { ...makeMemberRow().person, birthDate: "1940-05-01" },
      assignments: [{ id: "a1", memberId: "m1", memberRoleId: "r1", from: "2000-01-01", to: null, autoClosed: false, role: { id: "r1", title: "R", grantsActiveStatus, isProtected: false } }],
    });
  const q = "start=2025-01-01&end=2025-12-31&filter=membership"; // Mitgliedsjubiläum: Eintritt 2010 + 15 = 2025, für jeden Status
  const fixture = () => { ayFixture = [{ kind: "membership", year: 15, title: "Mitglied15" }]; };

  it("passive member gets the shared badge-neutral badge", async () => {
    findManyResult = [old(true)]; fixture();
    const html = await (await anniversaryRoutes.request(`/?${q}`)).text();
    expect(html).toContain("badge badge-sm badge-neutral");
    expect(html).toContain("Passiv");
  });

  it("supporting member gets no status badge in the list but a label in the export", async () => {
    findManyResult = [old(false)]; fixture();
    const html = await (await anniversaryRoutes.request(`/?${q}`)).text();
    expect(html).not.toContain("Fördernd");
    const res = await anniversaryRoutes.request(`/export?${q}`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1);
    expect(rows[0][3]).toBe("Fördernd");
  });
});
