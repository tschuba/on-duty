import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";

process.env.ORG_NAME = "Feuerwehr Test";
process.env.OIDC_APP_URL = "https://portal.test";

let perms = new Set<string>(["events:manage"]);
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => { c.set("user", { id: "u1", permissions: perms }); await next(); },
}));
vi.mock("../lib/registration.js", async (orig) => ({ ...(await orig<typeof import("../lib/registration.js")>()), countPendingUsers: async () => 0 }));
vi.mock("../lib/backup.js", () => ({ getBackupStatus: () => Promise.resolve({ state: "unconfigured", timestamp: null, lastSuccess: null }) }));
vi.mock("../db/index.js", () => ({ db: {} }));

const sys = (key: string, perm: string, body = "Hi {{#recipients}}{{optOutUrl}}{{/recipients}}") => ({
  key, category: "event", audience: "member", prefix: "[{{org.name}}]", editPermissions: [perm], system: { subject: "Sys {{event.title}}", body }, override: null as any,
});
let templates: any[] = [];
const saveOverride = vi.fn(async () => "ok" as "ok" | "conflict");
const resetOverride = vi.fn(async () => {});
vi.mock("../lib/mail-template-store.js", () => ({ listTemplates: async () => templates, saveOverride, resetOverride }));

const { mailTemplateRoutes } = await import("../routes/mail-templates.js");
const post = (path: string, f: Record<string, string>) => mailTemplateRoutes.request(path, { method: "POST", body: formBody(f), headers: { "content-type": "application/x-www-form-urlencoded" } });

beforeEach(() => {
  vi.clearAllMocks();
  perms = new Set(["events:manage"]);
  templates = [sys("event-created", "events:manage"), sys("member-settings-link", "system:admin", "{{settingsUrl}}")];
});

describe("mail template routes", () => {
  it("lists only editable templates", async () => {
    const html = await (await mailTemplateRoutes.request("/")).text();
    expect(html).toContain("Neuer Termin");
    expect(html).not.toContain("Einstellungs-Link");
    expect(html).toContain("Auslieferungszustand");
  });

  it("empty list with a hint without any editable template; 403 for a foreign template", async () => {
    perms = new Set();
    const list = await mailTemplateRoutes.request("/");
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("keine Mail-Vorlagen");
    perms = new Set(["events:manage"]);
    expect((await mailTemplateRoutes.request("/member-settings-link")).status).toBe(403);
    expect((await post("/member-settings-link/reset", {})).status).toBe(403);
    expect(resetOverride).not.toHaveBeenCalled();
  });

  it("system:admin may edit everything; unknown key is 404", async () => {
    perms = new Set(["system:admin"]);
    expect((await mailTemplateRoutes.request("/member-settings-link")).status).toBe(200);
    expect((await mailTemplateRoutes.request("/nope")).status).toBe(404);
  });

  it("rejects unknown variable with line and suggestion, nothing saved", async () => {
    const res = await post("/event-created", { subject: "x", body: "a\n{{event.titel}} {{#recipients}}{{optOutUrl}}{{/recipients}}", updatedAt: "" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Zeile 2");
    expect(html).toContain("Meintest du „event.title“");
    expect(saveOverride).not.toHaveBeenCalled();
  });

  it("rejects missing required placeholder", async () => {
    expect((await post("/event-created", { subject: "x", body: "hi", updatedAt: "" })).status).toBe(422);
  });

  it("saves valid input and redirects", async () => {
    const res = await post("/event-created", { subject: "S", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}", updatedAt: "" });
    expect(res.status).toBe(302);
    expect(saveOverride).toHaveBeenCalledWith(expect.objectContaining({ key: "event-created" }), { subject: "S", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}" }, "u1", "");
  });

  it("shows the conflict message", async () => {
    saveOverride.mockResolvedValueOnce("conflict");
    const res = await post("/event-created", { subject: "S", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}", updatedAt: "" });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Jemand hat diese Vorlage inzwischen geändert");
  });

  it("previews with sample data and shows errors instead", async () => {
    const ok = await (await post("/event-created/preview", { subject: "{{event.title}}", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}" })).text();
    expect(ok).toContain("Übung Atemschutz");
    const bad = await (await post("/event-created/preview", { subject: "{{x}}", body: "y" })).text();
    expect(bad).toContain("alert-error");
  });

  it("back link follows ?from only for internal paths", async () => {
    const back = async (q: string) => await (await mailTemplateRoutes.request(`/event-created${q}`)).text();
    expect(await back("?from=/events")).toContain('href="/events"');
    expect(await back("?from=//evil.example")).toContain('href="/mail/templates"');
    expect(await back("?from=https://evil.example")).toContain('href="/mail/templates"');
    const res = await post("/event-created?from=/events", { subject: "S", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}", updatedAt: "" });
    expect(res.headers.get("location")).toBe("/mail/templates/event-created?from=%2Fevents");
  });

  it("reset deletes the override", async () => {
    expect((await post("/event-created/reset", {})).status).toBe(302);
    expect(resetOverride).toHaveBeenCalledWith("event-created");
  });
});
