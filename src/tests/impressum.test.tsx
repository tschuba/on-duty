import { describe, it, expect } from "vitest";
import { missingImpressumFields, isImpressumComplete } from "../lib/org-config.js";

const full = { orgName: "FF", orgStreet: "S", orgHouseNumber: "1", orgZip: "1", orgCity: "C", orgRepresentative: "X", orgContactEmail: "a@b.de" };

describe("missingImpressumFields", () => {
  it("lists all required fields when empty", () => expect(missingImpressumFields({})).toHaveLength(7));
  it("is complete without phone and register", () => expect(isImpressumComplete(full)).toBe(true));
  it("treats blanks as missing", () => expect(missingImpressumFields({ ...full, orgRepresentative: "  " })).toEqual(["orgRepresentative"]));
});

// ── Route, Footer, Admin-Hinweis ────────────────────────────────────────────
import { vi, beforeEach } from "vitest";

let config: Record<string, string> = {};
vi.mock("../lib/org-config.js", async () => ({
  ...(await vi.importActual<typeof import("../lib/org-config.js")>("../lib/org-config.js")),
  loadOrgConfig: vi.fn(() => Promise.resolve(config)),
}));
vi.mock("../components/layout.js", () => ({ Layout: ({ children }: any) => <div>{children}</div> }));

const { impressumRoutes } = await import("../routes/impressum.js");
const { datenschutzRoutes } = await import("../routes/datenschutz.js");
const { PublicFooter } = await import("../components/public-form.js");
const { ImpressumHint } = await import("../components/impressum-hint.js");

const renderAsync = async (el: any) => String(await el);

beforeEach(() => { config = {}; });

describe("GET /impressum", () => {
  it("404 when incomplete", async () => {
    expect((await impressumRoutes.request("/")).status).toBe(404);
  });
  it("200 with register line", async () => {
    config = { ...full, orgRegisterCourt: "AG Hof", orgRegisterNumber: "VR 1", orgContactPhone: "0123" };
    const res = await impressumRoutes.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    const html = await res.text();
    expect(html).toContain("AG Hof VR 1");
    expect(html).toContain("0123");
  });
  it("omits register without number and never shows notificationEmail", async () => {
    config = { ...full, orgRegisterCourt: "AG Hof", notificationEmail: "intern@x.de" };
    const html = await (await impressumRoutes.request("/")).text();
    expect(html).not.toContain("AG Hof");
    expect(html).not.toContain("intern@x.de");
  });
});

describe("GET /datenschutz", () => {
  it("404 without inline text", async () => {
    expect((await datenschutzRoutes.request("/")).status).toBe(404);
  });
  it("renders text, address and link to Impressum", async () => {
    config = { ...full, orgPrivacyText: "<p>Wir speichern wenig.</p>" };
    const res = await datenschutzRoutes.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Wir speichern wenig.");
    expect(html).toContain("mailto:a@b.de");
    expect(html).toContain('href="/impressum"');
  });
  it("Impressum links to Datenschutz only with inline text", async () => {
    config = { ...full, orgPrivacyText: "x" };
    expect(await (await impressumRoutes.request("/")).text()).toContain('href="/datenschutz"');
    config = full;
    expect(await (await impressumRoutes.request("/")).text()).not.toContain('href="/datenschutz"');
  });
});

describe("PublicFooter", () => {
  it("links Impressum only when complete", async () => {
    expect(await renderAsync(PublicFooter())).not.toContain("/impressum");
    config = full;
    expect(await renderAsync(PublicFooter())).toContain('href="/impressum"');
  });
});

describe("ImpressumHint", () => {
  it("shows warning only when incomplete", async () => {
    expect(await renderAsync(ImpressumHint())).toContain("/organisation#master");
    config = full;
    expect(await renderAsync(ImpressumHint())).not.toContain("/organisation");
  });
});
