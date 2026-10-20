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

const { Layout, MemberTabs } = await import("../components/layout.js");

beforeEach(() => {
  openApplicationsFixture = [];
  openDonationsFixture = [];
});

function userWith(...permissions: string[]) {
  return { id: "u1", name: "Test User", permissions: new Set(permissions), disabled: false } as any;
}

describe("Anträge tab (MemberTabs)", () => {
  it("hides the nav entry for a user without applications:read", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<MemberTabs active="members" user={userWith("members:write")} />));
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Anträge");
  });

  it("shows the nav entry with no badge when there are no open applications", async () => {
    openApplicationsFixture = [];
    const app = new Hono();
    app.get("/", (c) => c.html(<MemberTabs active="members" user={userWith("applications:read")} />));
    const html = await (await app.request("/")).text();
    expect(html).toContain("Anträge");
    expect(html).not.toContain("badge-primary");
  });

  it("shows the open-applications count as a badge", async () => {
    openApplicationsFixture = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("members:read", "applications:read")}>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).toContain('badge-warning ml-1">3<');
  });

  it("never queries the DB for a user without the permission", async () => {
    const { db } = await import("../db/index.js");
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("members:write")}>x</Layout>));
    await app.request("/");
    expect((db as any).select).not.toHaveBeenCalled();
  });
});

describe("Layout — Spenden badge", () => {
  const render = async (...perms: string[]) => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith(...perms)}>x</Layout>));
    return (await app.request("/")).text();
  };

  it("shows open receipts count with donations:issue-receipts", async () => {
    openDonationsFixture = [{ id: "d1" }, { id: "d2" }];
    expect(await render("donations:issue-receipts")).toContain('badge-warning ml-1">2<');
  });

  it("hides the badge without the permission", async () => {
    openDonationsFixture = [{ id: "d1" }];
    expect(await render("donations:record")).not.toContain("badge-primary");
  });

  it("hides the badge at zero", async () => {
    expect(await render("donations:issue-receipts")).not.toContain("badge-primary");
  });
});

describe("Layout — Hauptmenü-Badge im aktiven Bereich", () => {
  const render = async (activeNav: any, ...perms: string[]) => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith(...perms)} activeNav={activeNav}>x</Layout>));
    return (await app.request("/")).text();
  };

  it("hides the Spenden badge when donations is active, shows it otherwise", async () => {
    openDonationsFixture = [{ id: "d1" }];
    expect(await render("donations", "donations:issue-receipts")).not.toContain("badge-primary");
    expect(await render("members", "donations:issue-receipts")).toContain('badge-warning ml-1">1<');
  });

  it("hides the Mitglieder badge when members is active, shows it otherwise", async () => {
    openApplicationsFixture = [{ id: "a1" }];
    expect(await render("members", "members:read", "applications:read")).not.toContain("badge-primary");
    expect(await render("donations", "members:read", "applications:read")).toContain('badge-warning ml-1">1<');
  });
});

describe("user menu", () => {
  it("links to /account", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<Layout user={userWith("members:read")}>x</Layout>));
    const html = await (await app.request("/")).text();
    expect(html).toContain('href="/account"');
  });
});

describe("role tabs (MemberTabs)", () => {
  it("shows Funktionen and Funktionstypen only with member-roles:read", async () => {
    const render = async (perm: string) => {
      const app = new Hono();
      app.get("/", (c) => c.html(<MemberTabs active="members" user={userWith(perm)} />));
      return (await app.request("/")).text();
    };
    expect(await render("member-roles:read")).toContain("/admin/role-types");
    expect(await render("members:write")).not.toContain("/admin/role-types");
  });
});

describe("Mitglieder nav item for roles-only users", () => {
  it("links to the role pages without members:read and hides member tabs", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html(<MemberTabs active="roles" user={userWith("member-roles:read")} />));
    const html = await (await app.request("/")).text();
    expect(html).toContain("/admin/roles");
    expect(html).not.toContain('href="/members"');
  });
});
