import { describe, expect, it } from "vitest";
import { inScope, unionScope, parseStatuses } from "../lib/member-scope.js";

describe("member scope", () => {
  it("inScope: undefined/all = everyone, set = members of set", () => {
    expect(inScope(undefined, "left")).toBe(true);
    expect(inScope("all", "deceased")).toBe(true);
    const s = new Set(["children", "youth"] as const);
    expect(inScope(new Set(s), "youth")).toBe(true);
    expect(inScope(new Set(s), "active")).toBe(false);
  });
  it("unionScope: unrestricted role wins, else union, no role = all", () => {
    expect(unionScope([])).toBe("all");
    expect(unionScope([["youth"], []])).toBe("all");
    expect(unionScope([["youth"], undefined])).toBe("all");
    expect(unionScope([["youth"], ["active"]])).toEqual(new Set(["youth", "active"]));
  });
  it("parseStatuses drops unknown values", () => {
    expect(parseStatuses(["youth", "x"])).toEqual(["youth"]);
    expect(parseStatuses(undefined)).toEqual([]);
  });
});
