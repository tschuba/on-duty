import { describe, it, expect } from "vitest";
import { RowAction } from "../components/row-action.js";

const render = (el: unknown) => String(el);

describe("RowAction", () => {
  it("hides the label below md and keeps aria-label and title", () => {
    const html = render(<RowAction icon="pencil" label="Bearbeiten" />);
    expect(html).toContain('<span class="max-md:hidden">Bearbeiten</span>');
    expect(html).toContain('aria-label="Bearbeiten"');
    expect(html).toContain('title="Bearbeiten"');
    expect(html).toContain("<svg");
  });

  it("renders <a> with href, <button> otherwise", () => {
    expect(render(<RowAction icon="pencil" label="x" href="/a" />)).toMatch(/^<a href="\/a"/);
    expect(render(<RowAction icon="pencil" label="x" />)).toMatch(/^<button type="button"/);
  });

  it("keeps disabled, custom title, class and attrs", () => {
    const html = render(<RowAction icon="trash" label="Löschen" class="btn-outline btn-error join-item" disabled title="Grund" attrs={{ "hx-post": "/d" }} />);
    expect(html).toContain("disabled");
    expect(html).toContain('title="Grund"');
    expect(html).toContain('aria-label="Löschen"');
    expect(html).toContain("btn-outline btn-error join-item");
    expect(html).toContain('hx-post="/d"');
  });
});
