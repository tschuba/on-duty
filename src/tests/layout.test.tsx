import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { applications } from "../db/schema/index.js";

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
  });
  return chain;
}

let openApplicationsFixture: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => (table === applications ? chainOf(openApplicationsFixture) : chainOf([]))),
    })),
  },
}));

const { Layout } = await import("../components/layout.js");

beforeEach(() => {
  openApplicationsFixture = [];
});

function userWith(...permissions: string[]) {
  return { id: "u1", name: "Test User", permissions: new Set(permissions), disabled: false } as any;
}

describe("Layout — Anträge nav", () => {
  it("hides the nav entry for a user without applications:review", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("members:write")}>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Anträge");
  });

  it("shows the nav entry with no badge when there are no open applications", async () => {
    openApplicationsFixture = [];
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("applications:review")}>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).toContain("Anträge");
    expect(html).not.toContain("badge-primary");
  });

  it("shows the open-applications count as a badge", async () => {
    openApplicationsFixture = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("applications:review")}>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).toContain('badge-primary ml-1">3<');
  });

  it("never queries the DB for a user without the permission", async () => {
    const { db } = await import("../db/index.js");
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("members:write")}>x</Layout>));
    await app.request("/");
    expect((db as any).select).not.toHaveBeenCalled();
  });
});
