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

const { Layout } = await import("../components/layout.js");

beforeEach(() => {
  openApplicationsFixture = [];
  openDonationsFixture = [];
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
  it("hides Anträge without applications:read", async () => {
    expect(await renderAt("/", "members:write")).not.toContain("Anträge");
  });

  it("shows Anträge with applications:read and the open count on the parent menu", async () => {
    openApplicationsFixture = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    const html = await renderAt("/events", "members:read", "applications:read");
    expect(html).toContain("Anträge");
    expect(html).toContain('badge-warning ml-1">3<');
  });

  it("shows Funktionen and Funktionstypen only with their own permission", async () => {
    const roles = await renderAt("/", "member-roles:read");
    expect(roles).toContain('href="/roles"');
    expect(roles).not.toContain("/role-types");
    expect(roles).not.toContain('href="/members"');
    const types = await renderAt("/", "member-role-types:read");
    expect(types).toContain('href="/role-types"');
    expect(types).not.toContain('href="/roles"');
  });

  it("turns a menu with a single visible item into a plain link", async () => {
    const html = await renderAt("/", "member-roles:read");
    expect(html).toContain('href="/roles"');
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

  it("opens the parent of the active page and hides its sum badge", async () => {
    openDonationsFixture = [{ id: "d1" }];
    const active = await renderAt("/donations", "donations:issue-receipts");
    expect(active).toContain("<details");
    expect(active).toMatch(/<details[^>]* open/);
    const other = await renderAt("/events", "donations:issue-receipts");
    expect(other).not.toMatch(/<details[^>]* open/);
    expect(other).toContain('badge-warning ml-1">1<');
  });

  it("never queries the DB for a user without the permission", async () => {
    const { db } = await import("../db/index.js");
    (db as any).select.mockClear();
    await renderAt("/", "members:write");
    expect((db as any).select).not.toHaveBeenCalled();
  });
});

describe("user menu", () => {
  it("links to /account", async () => {
    expect(await renderAt("/", "members:read")).toContain('href="/account"');
  });
});

describe("favicons", () => {
  it("links the icons served from public/", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).toContain('<link rel="icon" href="/favicon.svg"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
    for (const f of ["favicon.svg", "apple-touch-icon.png"]) expect(existsSync(`public/${f}`)).toBe(true);
  });
});

describe("pwa", () => {
  it("links manifest and both theme colors, and ships the files it references", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('media="(prefers-color-scheme: light)"');
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
    expect(html).toContain('register("/sw.js")');
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(manifest).toMatchObject({ name: "on-duty", display: "standalone", start_url: "/" });
    for (const icon of manifest.icons) expect(existsSync(`public${icon.src}`)).toBe(true);
    expect(existsSync("public/offline.html")).toBe(true);
  });

  it("serves the service worker revalidated and versioned", async () => {
    const { pwaRoutes } = await import("../routes/pwa.js");
    const res = await pwaRoutes.request("/sw.js");
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain(`on-duty-${version}`);
  });
});
