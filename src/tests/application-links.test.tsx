import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

process.env.OIDC_APP_URL = "http://localhost:3000";
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../components/impressum-hint.js", () => ({ ImpressumHint: () => null }));
const { formatFormStatusText, ApplicationLinks, ApplicationFormSettings } = await import("../components/application-links.js");

const form = (o: object) => ({ isActive: true, startDate: null, endDate: null, ...o }) as never;
const html = async (el: unknown) => new Hono().get("/", (c) => c.html(el as never)).request("/").then((r) => r.text());

describe("formatFormStatusText", () => {
  it("describes missing and unbounded forms", () => {
    expect(formatFormStatusText(undefined).active).toBe(false);
    expect(formatFormStatusText(form({})).active).toBe(true);
    expect(formatFormStatusText(form({ isActive: false })).active).toBe(false);
  });
  it("includes dates for bounded forms", () => {
    expect(formatFormStatusText(form({ startDate: "2999-01-02" })).text).toContain("02.01.2999");
    expect(formatFormStatusText(form({ endDate: "2999-01-02" })).text).toContain("02.01.2999");
    const r = formatFormStatusText(form({ startDate: "2000-01-02", endDate: "2999-03-04" })).text;
    expect(r).toContain("02.01.2000");
    expect(r).toContain("04.03.2999");
  });
});

describe("ApplicationLinks / ApplicationFormSettings", () => {
  it("shows the settings button only for managers", async () => {
    const forms = { membership: form({}), youth: undefined };
    expect(await html(ApplicationLinks({ forms, canManageForms: false }))).not.toContain("form-settings-membership");
    expect(await html(ApplicationLinks({ forms, canManageForms: true }))).toContain("form-settings-membership");
  });
  it("renders one settings dialog per form type", async () => {
    const out = await html(ApplicationFormSettings({ forms: { membership: form({}), youth: undefined } }));
    expect(out).toContain('id="form-settings-membership"');
    expect(out).toContain('id="form-settings-youth"');
  });
});
