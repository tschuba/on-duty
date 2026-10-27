import { describe, it, expect } from "vitest";
import { canonicalizeTags } from "../lib/tags.js";

describe("canonicalizeTags", () => {
  it("uses existing spelling and dedupes case-insensitively", () => {
    expect(canonicalizeTags(["übung", "Übung", "neu"], ["Übung"])).toEqual(["Übung", "neu"]);
  });
  it("aligns within a batch", () => {
    const ex: string[] = [];
    expect(canonicalizeTags(["Atemschutz"], ex)).toEqual(["Atemschutz"]);
    expect(canonicalizeTags(["atemschutz"], ex)).toEqual(["Atemschutz"]);
  });
  it("keeps umlaut variants distinct", () => {
    expect(canonicalizeTags(["Uebung"], ["Übung"])).toEqual(["Uebung"]);
  });
});
