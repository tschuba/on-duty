import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Replay against legacy rows (incl. a second run) was checked by hand on a scratch DB; this guards the shipped seed + copy rules.
const sql = readFileSync("drizzle/0063_inventory_templates_seed.sql", "utf8");

describe("migration 0063 inventory templates seed", () => {
  it("ships the six templates with their fixed fields", () => {
    const rows = [...sql.matchAll(/\('([^']+)', ARRAY\[([^\]]*)\]\)/g)].map((m) => [m[1], m[2].replaceAll("'", "").split(", ")]);
    expect(rows).toEqual([
      ["Fahrzeug", ["numbers", "inspection"]],
      ["Atemschutz", ["numbers", "serials", "inspection"]],
      ["Gerät", ["quantity", "numbers", "serials", "inspection"]],
      ["PSA", ["quantity", "numbers", "serials", "assignments", "inspection"]],
      ["Sonstiges", ["quantity", "numbers"]],
      ["Hydrant", ["location", "inspection"]],
    ]);
  });

  it("reuses fields and inspection templates of the same name instead of creating or overwriting them", () => {
    expect(sql).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "inventory_inspection_templates" t WHERE lower(t."name") = lower(v.name))`);
    expect(sql).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "inventory_field_defs" d WHERE lower(d."name") = lower(v.name))`);
    expect(sql).not.toMatch(/UPDATE "inventory_(field_defs|inspection_templates)"/);
  });

  it("turns the old category into a tag unless the item already has it, and copies plate/year only when set", () => {
    expect(sql).toContain(`lower(g."tag") = lower(m.tag)`);
    expect(sql).toContain(`"license_plate" IS NOT NULL AND i."license_plate" <> ''`);
    expect(sql).toContain(`"year_of_manufacture" IS NOT NULL`);
  });

  it("does not repeat the backfills of 0059/0061", () => {
    expect(sql).not.toContain("INSERT INTO \"inventory_inspections\"");
    expect(sql).not.toMatch(/UPDATE "inventory_items"/);
  });
});
