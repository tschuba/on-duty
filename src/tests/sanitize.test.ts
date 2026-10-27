import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "../lib/sanitize.js";

describe("sanitizeRichText", () => {
  it("keeps Trix's standard markup", () => {
    const html = "<h1>Titel</h1><p>Text <strong>fett</strong> <em>kursiv</em></p><ul><li>a</li></ul>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("strips scripts and event handlers", () => {
    const html = '<p onclick="alert(1)">x</p><script>alert(1)</script>';
    expect(sanitizeRichText(html)).toBe("<p>x</p>");
  });

  it("strips unsafe link schemes", () => {
    const html = '<a href="javascript:alert(1)">x</a>';
    expect(sanitizeRichText(html)).not.toContain("javascript:");
  });

  it("adds rel/target to http(s) links", () => {
    const out = sanitizeRichText('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener"');
    expect(out).toContain('target="_blank"');
  });

  it("treats an empty Trix editor as empty", () => {
    expect(sanitizeRichText("<div></div>")).toBe("");
  });
});
