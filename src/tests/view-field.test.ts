import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ViewField", () => {
  it("is defined only in src/components", () => {
    const dir = new URL("../routes/", import.meta.url);
    const offenders = readdirSync(dir).filter((f) => /function ViewField\b/.test(readFileSync(new URL(f, dir), "utf8")));
    expect(offenders).toEqual([]);
  });
});
