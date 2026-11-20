import { describe, expect, it } from "vitest";
import { fillReturnTo, safeReturnTo } from "../lib/return-to.js";

describe("safeReturnTo", () => {
  it("accepts same-origin paths only", () => {
    expect(safeReturnTo("/inventory/x?a=1")).toBe("/inventory/x?a=1");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil", "", undefined]) expect(safeReturnTo(bad)).toBeUndefined();
  });
});

describe("fillReturnTo", () => {
  it("fills or drops the {id} parameter", () => {
    expect(fillReturnTo("/a/new?x=1&item={id}", "42")).toBe("/a/new?x=1&item=42");
    expect(fillReturnTo("/a/new?x=1&item={id}")).toBe("/a/new?x=1");
  });
});
