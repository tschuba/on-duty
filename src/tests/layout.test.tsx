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

describe("user menu", () => {
  it("links to /account", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("members:read")} path="/">x</Layout>));
    expect(await (await app.request("/")).text()).toContain('href="/account"');
  });
});

describe("title", () => {
  beforeEach(async () => { (await import("../env.js")).env.ORG_NAME = "FF Altenhammer"; });
  const render = async (user?: any) => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout title="Antrag" user={user}>x</Layout>));
    return (await (await app.request("/")).text()).match(/<title>(.*?)<\/title>/)![1];
  };

  it("public pages show the org name, internal pages on-duty", async () => {
    const { env } = await import("../env.js");
    expect(await render()).toBe(`Antrag · ${env.ORG_NAME}`);
    expect(await render(userWith())).toBe("Antrag · on-duty");
  });

  it("falls back to on-duty when no org name is available", async () => {
    const { env } = await import("../env.js");
    env.ORG_NAME = "";
    expect(await render()).toBe("Antrag · on-duty");
  });

  it("falls back to env.ORG_NAME when loading the org config throws", async () => {
    const { env } = await import("../env.js");
    const { db } = await import("../db/index.js");
    vi.mocked(db.select).mockImplementationOnce(() => { throw new Error("db down"); });
    expect(await render()).toBe(`Antrag · ${env.ORG_NAME}`);
  });
});
