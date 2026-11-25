import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { applications, donations } from "../db/schema/index.js";

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
  });
  return chain;
}

let openApplicationsFixture: any[] = [];
let openDonationsFixture: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => (table === applications ? chainOf(openApplicationsFixture) : table === donations ? chainOf(openDonationsFixture) : chainOf([]))),
    })),
  },
}));

vi.mock("../lib/inventory.js", () => ({ countOverdueInspections: async () => 0 }));

let pendingRsvps = 0;
vi.mock("../lib/events.js", () => ({ countPendingRsvps: async () => pendingRsvps }));

let overdueLoans = 0;
let openLoanRequests = 0;
vi.mock("../lib/lending.js", () => ({ countOverdueLoans: async () => overdueLoans, countOpenLoanRequests: async () => openLoanRequests }));

const { Layout } = await import("../components/layout.js");

beforeEach(() => {
  pendingRsvps = 0;
  openApplicationsFixture = [];
  openDonationsFixture = [];
  overdueLoans = 0;
  openLoanRequests = 0;
});

function userWith(...permissions: string[]) {
  return { id: "u1", name: "Test User", permissions: new Set(permissions), disabled: false } as any;
}

const renderAt = async (path: string, ...perms: string[]) => {
  const app = new Hono();
  app.get("/", (c) => c.html(<Layout user={userWith(...perms)} path={path}>x</Layout>));
  return (await app.request("/")).text();
};

describe("Sidebar — Sichtbarkeit je Berechtigung", () => {
  it("shows Ausbildungen only with training:read", async () => {
    expect(await renderAt("/", "members:read")).not.toContain("view=training");
    expect(await renderAt("/", "training:read")).toContain('href="/members"');
  });

  it("shows Funktionen with either role or role-type permission, one entry", async () => {
    for (const p of ["member-roles:read", "member-role-types:read"]) {
      const html = await renderAt("/", p);
      expect(html).toContain('href="/members"');
      expect(html).not.toContain("/role-types");
    }
  });

  it("shows Hilfe to every user", async () => {
    expect(await renderAt("/")).toContain('href="/help"');
  });

  it("turns a menu with a single visible item into a plain link", async () => {
    const html = await renderAt("/", "member-roles:read");
    expect(html).toContain('href="/members"');
    expect(html).not.toContain("<details");
  });

  it("drops menus without any visible item", async () => {
    const html = await renderAt("/", "members:write");
    expect(html).not.toContain("Spenden");
    expect(html).not.toContain("Import");
  });


  it("offers the error tracker only with ERROR_TRACKER_URL", async () => {
    expect(await renderAt("/", "system:admin")).not.toContain("Fehlerberichte");
  });
});

describe("Sidebar — Aktiv-Erkennung und Zähler", () => {
  it("picks the longest matching prefix", async () => {
    const { findActiveHref } = await import("../components/nav-menu.js");
    expect(findActiveHref(["/inventory", "/inventory/inspections"], "/inventory/inspections")).toBe("/inventory/inspections");
    expect(findActiveHref(["/inventory", "/inventory/inspections"], "/inventory/42")).toBe("/inventory");
    expect(findActiveHref(["/members"], "/membership")).toBeNull();
  });

  it("donations is a single menu link (no Spender entry) with the open-receipts badge", async () => {
    openDonationsFixture = [{ id: "d1" }];
    const html = await renderAt("/events", "donations:issue-receipts");
    expect(html).toContain('href="/donations"');
    expect(html).not.toContain('href="/donors"');
    const menu = html.slice(html.indexOf('id="nav-menu"'));
    expect(menu.slice(0, menu.indexOf("<script"))).not.toContain("badge");
  });

  it("never queries the DB for a user without the permission", async () => {
    const { db } = await import("../db/index.js");
    (db as any).select.mockClear();
    await renderAt("/", "members:write");
    expect((db as any).select).not.toHaveBeenCalled();
  });
});


describe("Verleih-Zähler", () => {
  it("keeps the counts in the tooltip, but renders no badges in the drawer", async () => {
    openLoanRequests = 2;
    overdueLoans = 1;
    const html = await renderAt("/", "lending:read", "lending:manage");
    expect(html).toContain('data-tip="Verleih · 1 überfällig, 2 Anfragen"');
    expect(html).not.toContain("indicator-item badge badge-error badge-xs is-drawer-open:hidden");
  });
});
