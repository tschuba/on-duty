import { describe, it, expect } from "vitest";
import { slugify } from "../lib/slug.js";
import { checkHeader, parseHeaders } from "../lib/mail-headers.js";
import { customFields, customPreviewVars, renderMail, validateTemplate } from "../lib/mail-templates.js";

describe("slugify", () => {
  it("converts umlauts, collapses separators, caps at 60", () => {
    expect(slugify("Übungsplan Herbst – Größe!")).toBe("uebungsplan-herbst-groesse");
    expect(slugify("a".repeat(80))).toHaveLength(60);
  });
});

describe("mail headers", () => {
  it("accepts X- headers, rejects reserved, foreign and injected ones", () => {
    expect(parseHeaders("X-Foo: bar\nX-Baz: 1").headers).toEqual({ "X-Foo": "bar", "X-Baz": "1" });
    for (const h of ["Cc: a@b.c", "Bcc: a", "Reply-To: a", "X-On-Duty-Event: x", "no colon", "X-Bad Name: 1"]) expect(parseHeaders(h).errors, h).toHaveLength(1);
    expect(checkHeader("X-A", "v\nBcc: x")).toBeTruthy();
  });
});

describe("custom template validation", () => {
  it("turns unknown placeholders into fields", () => {
    expect(customFields({ prefix: "{{org.name}}", subject: "{{ort}}", body: "{{#zeit}}{{treffpunkt_uhrzeit}}{{/zeit}} {{recipient.name}} {{unsubscribeUrl}}" })).toEqual(["ort", "zeit", "treffpunkt_uhrzeit"]);
    expect(validateTemplate("", { subject: "{{ort}}", body: "{{recipient.name}} {{org.url}} {{unsubscribeUrl}}" })).toEqual([]);
  });
  it("rejects dotted and reserved names, suggests globals", () => {
    const e = validateTemplate("", { subject: "x", body: "{{org.nam}} {{recipients}} {{a.b}} {{unsubscribeUrl}}" });
    expect(e.join("\n")).toContain("Meintest du „org.name“");
    expect(e.some((x) => x.includes("„recipients“ ist reserviert"))).toBe(true);
    expect(e.some((x) => x.includes("„a.b“"))).toBe(true);
    expect(validateTemplate("", { subject: "x", body: "{{> p}} {{unsubscribeUrl}}" })).toHaveLength(1);
  });
  it("accepts the salutation variables without turning them into fields", () => {
    const input = { subject: "x", body: "Hallo {{addressee}}, {{#multiple}}seid{{/multiple}} {{you}} {{unsubscribeUrl}}" };
    expect(validateTemplate("", input)).toEqual([]);
    expect(customFields(input)).toEqual([]);
  });
  it("highlights empty fields in preview, not fields with example", () => {
    const out = renderMail({ prefix: "", subject: "{{ort}}", body: "{{#ort}}{{ort}}{{/ort}} {{wann}}" }, customPreviewVars([{ name: "ort" }, { name: "wann", example: "heute" }]));
    expect(out.subject).toBe("\u0001ort\u0002");
    expect(out.text).toContain("heute");
  });
});

describe("custom mail send", () => {
  it("renders a custom template with field values and globals", () => {
    const out = renderMail({ prefix: "", subject: "{{ort}}", body: "Hallo {{recipient.firstName}}, {{wann}}" }, { ort: "Halle", wann: "heute", recipient: { firstName: "Anna" } });
    expect(out).toEqual({ subject: "Halle", text: "Hallo Anna, heute" });
  });
});
