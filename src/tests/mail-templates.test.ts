import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

process.env.ORG_NAME = "Feuerwehr Test";
process.env.OIDC_APP_URL = "https://portal.test";

let rows: any[] = [];
const select = vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(rows) }) }));
vi.mock("../db/index.js", () => ({ db: { select } }));

const { CATALOG, buildVars, validateTemplate, renderMail, resolveTemplate, catalogDocs } = await import("../lib/mail-templates.js");

// Standardtexte direkt aus der Seed-Migration.
const sql = ["0081_mail_templates_seed", "0083_member_settings_link_template", "0084_event_info_mail_template"].map((f) => readFileSync(`drizzle/${f}.sql`, "utf8")).join("\n");
const seeded = [...sql.matchAll(/\('([\w-]+)', 'de', 'system'.*?\$s\$(.*?)\$s\$, \$b\$(.*?)\$b\$/gs)].map((m) => ({ key: m[1], subject: m[2], body: m[3] }));

const record = { event: { id: "e1", title: "Übung", startsAt: new Date("2026-04-12T16:00:00Z"), endsAt: new Date("2026-04-12T18:00:00Z"), allDay: false, location: "Gerätehaus", rsvpEnabled: true, rsvpDeadline: null, maxParticipants: 20 } };
const anna = { firstName: "Anna", lastName: "A", email: "a@x.de", optOutUrl: "https://o/1", rsvpYesUrl: "https://y/1", rsvpNoUrl: "https://n/1" };
const ben = { ...anna, firstName: "Ben", optOutUrl: "https://o/2" };

describe("mail templates", () => {
  it("catalog and seeded system rows match", () => {
    expect(seeded.map((s) => s.key).sort()).toEqual(Object.keys(CATALOG).sort());
  });

  it.each(seeded)("renders $key from its seeded text", ({ key, subject, body }) => {
    expect(validateTemplate(key, { prefix: "[{{org.name}}|{{type}}]", subject, body })).toEqual([]);
    const out = renderMail({ prefix: "[{{org.name}}|{{type}}]", subject, body }, buildVars(key, { ...record, changes: "Ort: A → B" }, [anna, ben]));
    if (key === "member-settings-link") return;
    expect(out.subject).toMatch(/^\[Feuerwehr Test\|Termin\] /);
    expect(out.text).not.toMatch(/\{\{|undefined/);
    expect(out.text).toContain("https://o/2");
    expect(out.text).toContain(key === "event-cancelled" || key === "event-mail-info" ? "Keine Termin-Mails" : "https://y/1");
    if (key === "event-cancelled" || key === "event-mail-info") expect(out.text).not.toContain("https://y/1");
  });

  it("event-mail-info requires optOutUrl in recipients", () => {
    expect(validateTemplate("event-mail-info", { subject: "x", body: "hi" })[0]).toMatch(/Pflichtplatzhalter/);
  });

  it("member-settings-link renders and requires settingsUrl", () => {
    const { subject, body } = seeded.find((s) => s.key === "member-settings-link")!;
    const out = renderMail({ prefix: "[{{org.name}}|{{type}}]", subject, body }, buildVars("member-settings-link", { settingsUrl: "https://s/1", validMinutes: 30 }, []));
    expect(out.subject).toBe("[Feuerwehr Test|Mitglied] Deine Einstellungen bei Feuerwehr Test");
    expect(out.text).toContain("https://s/1");
    expect(out.text).not.toMatch(/\{\{|undefined/);
    expect(validateTemplate("member-settings-link", { subject: "x", body: "hi" })[0]).toMatch(/Pflichtplatzhalter/);
  });

  it("validation: unknown variable, missing or misplaced required placeholder, partial", () => {
    const k = "event-created";
    expect(validateTemplate(k, { subject: "{{nope}}", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}" })[0]).toMatch(/unbekannte Variable/);
    expect(validateTemplate(k, { subject: "x", body: "hi" })[0]).toMatch(/Pflichtplatzhalter/);
    expect(validateTemplate(k, { subject: "x", body: "{{optOutUrl}}" }).join()).toMatch(/Pflichtplatzhalter/);
    expect(validateTemplate(k, { subject: "x", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}{{> p}}" }).join()).toMatch(/Partials/);
    expect(validateTemplate(k, { subject: "{{", body: "x" }).length).toBeGreaterThan(0);
    expect(validateTemplate("custom-x", { subject: "{{anything}}", body: "x" })).toEqual([]);
  });

  it("errors carry the line and a typo suggestion", () => {
    const errs = validateTemplate("event-created", { subject: "x", body: "a\nb\n{{event.titel}}{{#recipients}}{{optOutUrl}}{{/recipients}}" });
    expect(errs[0]).toBe("body: Zeile 3: unbekannte Variable „event.titel“. Meintest du „event.title“?");
    expect(validateTemplate("event-created", { subject: "x", body: "a\n{{#recipients}}" })[0]).toMatch(/Zeile 2/);
  });

  it("catalog entries have plain-text names and required labels", () => {
    for (const e of Object.values(CATALOG)) {
      expect(e.name).toBeTruthy();
      expect(e.description).toBeTruthy();
      for (const r of e.required) expect(r.label).toBeTruthy();
    }
    expect(validateTemplate("event-created", { subject: "x", body: "a\n{{#recipients}}" })[0]).toBe("body: Zeile 2: Block „recipients“ ist nicht geschlossen");
  });

  it("no HTML escaping, newlines removed from subject", () => {
    const out = renderMail({ prefix: "", subject: "{{event.title}}", body: "{{event.title}}" }, { event: { title: "A & <B>\nX" } });
    expect(out.text).toBe("A & <B>\nX");
    expect(out.subject).toBe("A & <B> X");
  });

  describe("resolveTemplate", () => {
    const sys = { locale: "de", variant: "system", category: "event", audience: "member", topic: "events", prefix: "[{{org.name}}|{{type}}]", headersMode: "fixed", extraHeaders: null, ...seeded[0] };
    const ov = (o: object) => ({ key: "event-created", locale: "de", variant: "override", subject: "S", body: "{{#recipients}}{{optOutUrl}}{{/recipients}}", ...o });
    beforeEach(() => select.mockClear());

    it("prefers a valid override", async () => {
      rows = [sys, ov({})];
      expect((await resolveTemplate("event-created"))?.subject).toBe("S");
    });
    it("falls back to system on invalid override", async () => {
      rows = [sys, ov({ body: "no opt out" })];
      expect((await resolveTemplate("event-created"))?.subject).toBe(sys.subject);
    });
    it("returns null if system row is invalid or missing", async () => {
      rows = [{ ...sys, body: "broken" }];
      expect(await resolveTemplate("event-created")).toBeNull();
      rows = [];
      expect(await resolveTemplate("event-created")).toBeNull();
    });
  });

  it("docs/mail-variables.md is up to date (run pnpm mail:docs)", () => {
    expect(readFileSync("docs/mail-variables.md", "utf8")).toBe(catalogDocs());
  });
});
