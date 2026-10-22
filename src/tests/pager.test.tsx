import { describe, it, expect } from "vitest";
import { Pager, pageWindow, GRID_MAX_PAGES, gridColumns } from "../components/pager.js";

describe("Pager", () => {
  it("uses window.URL in the inline handler (bare URL resolves to document.URL)", async () => {
    const html = String(
      await (<Pager countLabel="x" page={1} totalPages={2} pageUrl={() => "?"} pageSize={25} pageSizeOptions={[10, 25]} />),
    );
    expect(html).toContain("new window.URL(");
    expect(html).not.toMatch(/new URL\(/);
  });
});

describe("pageWindow", () => {
  it.each([
    [1, 1, [1]],
    [4, 7, [1, 2, 3, 4, 5, 6, 7]],
    [1, 40, [1, 2, "…", 40]],
    [7, 40, [1, "…", 6, 7, 8, "…", 40]],
    [40, 40, [1, "…", 39, 40]],
  ])("page %i of %i", (page, total, expected) => {
    expect(pageWindow(page, total)).toEqual(expected);
  });
});

describe("Pager rendering", () => {
  const render = async (page: number, total: number) =>
    String(await (<Pager countLabel="x" page={page} totalPages={total} pageUrl={(p) => `?page=${p}`} />));

  it("marks the current page", async () => {
    const html = await render(1, 1);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("«");
    expect(html).not.toContain("dropdown-content");
  });
  it("stays on one line and compact on mobile", async () => {
    const html = String(await (<Pager countLabel="x" page={2} totalPages={5} pageUrl={(p) => `?page=${p}`} pageSize={10} pageSizeOptions={[10, 25]} />));
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("aria-label=");
    expect(html).toContain("whitespace-nowrap hidden sm:inline");
    expect(html).toContain("dropdown dropdown-top join-item sm:hidden");
    expect(html).toContain("join-item btn btn-primary hidden sm:inline-flex");
    expect(html).toContain("join-item btn hidden sm:inline-flex");
  });
  it("uses a grid popup for 8–50 pages", async () => {
    const html = await render(5, GRID_MAX_PAGES);
    expect(html).toContain("dropdown-content");
    expect(html).toContain("repeat(7,");
    expect(html).not.toContain('type="number"');
  });
  it("uses a number input above the grid limit", async () => {
    const html = await render(5, GRID_MAX_PAGES + 1);
    expect(html).toContain('type="number"');
    expect(html).not.toContain("repeat(7,");
  });
});

describe("gridColumns", () => {
  it.each([[8, 3], [16, 4], [32, 6], [50, 7]])("%i pages -> %i columns", (n, c) => {
    expect(gridColumns(n)).toBe(c);
  });
});
