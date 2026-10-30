import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Replay against real data was checked by hand on a scratch DB; this guards the shipped seed + copy rules.
const sql = readFileSync("drizzle/0061_inventory_inspections.sql", "utf8");

describe("migration 0061 inventory inspections", () => {
  it("ships the four templates without a default interval", () => {
    const m = sql.match(/INSERT INTO "inventory_inspection_templates" \("name"\) VALUES (.+);/);
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(["HU", "UVV-Prüfung", "Druckprüfung", "Prüfung"]);
  });

  it("copies legacy dates only when set, never sets an interval, and backfills the field", () => {
    expect(sql).toContain(`"vehicle_inspection_due" IS NOT NULL`);
    expect(sql).toContain(`"next_inspection_due" IS NOT NULL OR "last_inspection_date" IS NOT NULL`);
    expect(sql).not.toMatch(/INSERT INTO "inventory_inspections" \([^)]*interval_months/);
    expect(sql).toContain(`array_append("enabled_fields", 'inspection')`);
  });
});
