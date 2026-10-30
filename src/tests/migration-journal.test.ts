import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const dir = join(__dirname, "../../drizzle");
const { entries } = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
// Entries up to idx 61 carry hand-set future timestamps (until 2026-11-10); only newer ones are checked against the clock.
const LEGACY_MAX_IDX = 61;

describe("drizzle journal", () => {
  it("has gapless idx and a SQL file per tag", () => {
    entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(existsSync(join(dir, `${e.tag}.sql`)), e.tag).toBe(true);
    });
  });

  it("has strictly increasing `when` (the migrator skips anything <= the highest applied created_at)", () => {
    entries.slice(1).forEach((e, i) => expect(e.when, e.tag).toBeGreaterThan(entries[i].when));
  });

  it("has no `when` in the future for new entries", () => {
    entries.filter((e) => e.idx > LEGACY_MAX_IDX).forEach((e) => expect(e.when, e.tag).toBeLessThanOrEqual(Date.now()));
  });
});
