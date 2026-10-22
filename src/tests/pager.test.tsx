import { describe, it, expect } from "vitest";
import { Pager } from "../components/pager.js";

describe("Pager", () => {
  it("uses window.URL in the inline handler (bare URL resolves to document.URL)", async () => {
    const html = String(
      await (<Pager countLabel="x" page={1} totalPages={2} pageUrl={() => "?"} pageSize={25} pageSizeOptions={[10, 25]} />),
    );
    expect(html).toContain("new window.URL(");
    expect(html).not.toMatch(/new URL\(/);
  });
});
