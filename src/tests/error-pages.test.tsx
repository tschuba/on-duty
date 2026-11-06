import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { applications, donations } from "../db/schema/index.js";

function chainOf(rows: unknown) {
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
  });
  return chain;
}

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => (table === applications || table === donations ? chainOf([]) : chainOf([]))),
    })),
  },
}));

const { forbiddenPage, notFoundPage, serverErrorPage } = await import("../components/error-pages.js");

describe("forbiddenPage", () => {
  it("renders the 403 page inside the normal layout", async () => {
    const app = new Hono();
    app.get("/", (c) => forbiddenPage(c));
    const res = await app.request("/");

    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("403 – Zugriff verweigert");
    expect(html).toContain("Du hast keine Berechtigung für diese Seite.");
    expect(html).toContain('href="/" class="btn btn-primary mt-6">Zur Startseite');
  });
});

describe("notFoundPage / serverErrorPage", () => {
  it("renders the 404 page", async () => {
    const app = new Hono();
    app.get("/", (c) => notFoundPage(c));
    const res = await app.request("/");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("404 – Seite nicht gefunden");
    expect(html).toContain("Die angeforderte Seite existiert nicht.");
    expect(html).toContain('href="/" class="btn btn-primary mt-6">Zur Startseite');
  });

  it("renders the 500 page with request id", async () => {
    const app = new Hono();
    app.get("/", (c) => serverErrorPage(c, undefined, "req-123"));
    const res = await app.request("/");
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("500 – Serverfehler");
    expect(html).toContain("Ein unerwarteter Fehler ist aufgetreten.");
    expect(html).toContain("Fehler-ID: req-123");
  });
});

describe("title without login", () => {
  it("shows the org name on 403 and 404", async () => {
    const { env } = await import("../env.js");
    env.ORG_NAME = "FF Altenhammer";
    const app = new Hono();
    app.get("/403", (c) => forbiddenPage(c));
    app.get("/404", (c) => notFoundPage(c));
    for (const p of ["/403", "/404"]) {
      expect(await (await app.request(p)).text()).toMatch(/<title>.* · FF Altenhammer<\/title>/);
    }
  });
});

describe("navbar without login", () => {
  it("shows the org name on 403 and 404", async () => {
    const { env } = await import("../env.js");
    env.ORG_NAME = "FF Altenhammer";
    const app = new Hono();
    app.get("/403", (c) => forbiddenPage(c));
    app.get("/404", (c) => notFoundPage(c));
    for (const p of ["/403", "/404"]) {
      expect(await (await app.request(p)).text()).toContain(">FF Altenhammer</a>");
    }
  });
});
