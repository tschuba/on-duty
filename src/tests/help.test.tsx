import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../db/index.js", () => ({ db: {} }));
let perms = new Set<string>(["members:read"]);
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => { c.set("user", { id: "u1", name: "T", permissions: perms, disabled: false }); await next(); },
}));

const { helpRoutes, statusMatrix } = await import("../routes/help.js");
const { visibleTips } = await import("../lib/help-tips.js");
const app = new Hono().route("/help", helpRoutes);

describe("Hilfe", () => {
  it("rendert Übersicht, Mitglieder und Tipps mit Ankern", async () => {
    expect((await app.request("/help")).status).toBe(200);
    const html = await (await app.request("/help/members")).text();
    for (const id of ["status", "matrix", "trouble", "tips", ...[1, 2, 3, 4, 5, 6, 7].map((n) => `case-${n}`)]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("hashchange"); // Fall klappt beim Sprung auf
    expect((await app.request("/help/tips")).status).toBe(200);
    expect(html).toContain("braucht eine laufende Funktion im aktiven Dienst"); // members.error.status.activeNoRole
  });

  it("Matrix folgt den Grenzwerten", () => {
    const m = statusMatrix({ children: 10, youth: 16, active: 60 });
    expect(m.map((r) => [r.withRole, r.without])).toEqual([
      ["children", "supporting"], ["youth", "supporting"], ["active", "supporting"], ["passive", "supporting"],
    ]);
    expect(m[3].from).toBe(60);
  });

  it("Karten nur mit Recht, gleiche Quelle", () => {
    const ids = (p: string[]) => visibleTips(new Set(p)).map((x) => x.id);
    expect(ids([])).not.toContain("export");
    expect(ids(["members:read"])).toContain("export");
    expect(visibleTips(new Set(["members:read"]), ["members"]).every((x) => x.area === "members")).toBe(true);
  });
  it("Kontextlinks der App zeigen auf vorhandene Anker", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const files = readdirSync("src/routes").filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(`src/routes/${f}`, "utf8"));
    const anchors = new Set(files.flatMap((src) => [...src.matchAll(/\/help\/members#([a-z]+)/g)].map((m) => m[1])));
    expect(anchors.size).toBeGreaterThan(0);
    const html = await (await app.request("/help/members")).text();
    for (const a of anchors) expect(html).toContain(`id="${a}"`);
  });

  it("Fehlersuche zeigt alle Fälle, Mail-Tipps nur auf /help/tips", async () => {
    perms = new Set(["members:read"]);
    const html = await (await app.request("/help/members")).text();
    expect(html.match(/<details/g)?.length).toBe(7);
    expect(html).not.toContain("Platzhalter in Mail-Vorlagen");
    expect(await (await app.request("/help/tips")).text()).toContain("Platzhalter in Mail-Vorlagen");
  });
});
