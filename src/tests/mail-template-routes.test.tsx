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
const dbAccess = vi.fn();
vi.mock("../db/index.js", () => ({ db: new Proxy({}, { get: (_t, k) => { dbAccess(String(k)); return () => { throw new Error("db used"); }; } }) }));

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

  it("preview cases: tabs, condition holds, no real data", async () => {
    const body = "{{#event.location}}ORT{{/event.location}}|{{#multiple}}MEHR{{/multiple}}|{{#event.rsvpEnabled}}RSVP{{/event.rsvpEnabled}}{{#recipients}}{{optOutUrl}}{{/recipients}}";
    const html = async (c: string) => (await (await post("/event-created/preview", { subject: "S", body, case: c })).text());
    const std = await html("default");
    expect(std).not.toContain("tablist"); // Fälle stehen in der Tab-Zeile des Editors, nicht in der Vorschau
    const page = await (await mailTemplateRoutes.request("/event-created")).text();
    for (const l of ["Standard", "Ohne Ort", "Ohne Anmeldung", "Mehrere Mitglieder an der Adresse"]) expect(page).toContain(l);
    expect(page).toContain('data-case="multiple"');
    expect(page).toContain('data-tab="entry"'); // Fall-Tabs erst nach Klick auf „Vorschau“ sichtbar (hidden)
    expect(page).toMatch(/class="btn [^"]*hidden[^"]*"[^>]*data-tab="preview" data-case="default"/);
    expect(std).toContain("ORT|");
    expect(std).toContain("VORSCHAU");
    expect(await html("noLocation")).not.toContain("ORT");
    expect(await html("noRsvp")).not.toContain("RSVP");
    expect(await html("multiple")).toContain("MEHR");
    perms = new Set(["system:admin"]);
    expect(await (await mailTemplateRoutes.request("/member-settings-link")).text()).toContain(">Vorschau<");
  });

  it("preview renders every case of every template without errors", async () => {
    const { CATALOG, previewVars, renderMail } = await import("../lib/mail-templates.js");
    for (const [key, e] of Object.entries(CATALOG)) for (const c of e.previewCases) {
      expect(() => renderMail({ prefix: "[{{org.name}}]", subject: "x", body: "y" }, previewVars(key, c.id))).not.toThrow();
    }
    const cancelled = previewVars("event-cancelled", "default") as any;
    expect(cancelled.event.rsvpEnabled).toBe(false);
  });

  it("preview errors carry line and missing required placeholders", async () => {
    const html = await (await post("/event-created/preview", { subject: "S", body: "a\n{{x}}" })).text();
    expect(html).toContain('data-line="2"');
    expect(html).toContain('data-missing="optOutUrl"');
  });

  it("preview never touches the db and subject equals the send subject", async () => {
    const { CATALOG, previewVars, renderMail } = await import("../lib/mail-templates.js");
    const row = { prefix: "[{{org.name}}]", subject: "{{event.title}}", body: "x" };
    const res = await post("/event-created/preview", { subject: row.subject, body: "{{#recipients}}{{optOutUrl}}{{/recipients}}" });
    expect(res.status).toBe(200); // db ist {}: jeder Zugriff würfe
    expect(await res.text()).toContain(renderMail(row, previewVars("event-created", "default")).subject);
    for (const e of Object.values(CATALOG)) for (const r of e.required) expect(r.label.length).toBeGreaterThan(0);
  });

  it("preview saves nothing, needs edit permission, subject equals send subject", async () => {
    const res = await post("/event-created/preview", { subject: "Hallo {{event.title}}", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}" });
    expect(res.status).toBe(200);
    expect(saveOverride).not.toHaveBeenCalled();
    expect(resetOverride).not.toHaveBeenCalled();
    const { renderMail, previewVars } = await import("../lib/mail-templates.js");
    const { subject } = renderMail({ prefix: "[{{org.name}}]", subject: "Hallo {{event.title}}", body: "x" }, previewVars("event-created"));
    expect(await res.text()).toContain(subject.replace(/&/g, "&amp;"));
    expect((await post("/member-settings-link/preview", { subject: "S", body: "{{settingsUrl}}" })).status).toBe(403);
  });

  it("preview reads no domain data (no db access)", async () => {
    const { CATALOG, previewVars } = await import("../lib/mail-templates.js");
    dbAccess.mockClear();
    for (const [key, e] of Object.entries(CATALOG)) for (const c of e.previewCases) previewVars(key, c.id);
    expect((await post("/event-created/preview", { subject: "S", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}", case: "multiple" })).status).toBe(200);
    expect(dbAccess).not.toHaveBeenCalled();
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
