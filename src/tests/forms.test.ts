import { describe, it, expect } from "vitest";
import { parseList, parseTags } from "../lib/forms.js";

describe("parseList", () => {
  it("normalises string | string[], trims, drops empties and duplicates", () => {
    expect(parseList({ k: ["a ", "", "a", "A"] }, "k")).toEqual(["a", "A"]);
    expect(parseList({ k: "x" }, "k")).toEqual(["x"]);
    expect(parseList({}, "k")).toEqual([]);
  });
  it("parseTags still splits on commas", () => {
    expect(parseTags({ t: "a,b, a" }, "t")).toEqual(["a", "b"]);
    expect(parseTags({ t: ["a,b", "c"] }, "t")).toEqual(["a", "b", "c"]);
  });
});
