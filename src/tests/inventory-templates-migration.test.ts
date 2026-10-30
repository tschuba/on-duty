import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Replay against legacy rows (incl. a second run) was checked by hand on a scratch DB; this guards the shipped seed + copy rules.
const sql = readFileSync("drizzle/0063_inventory_templates_seed.sql", "utf8");
const drop = readFileSync("drizzle/0064_inventory_drop_category.sql", "utf8");

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

describe("migration 0064 drop category", () => {
  // Replay on a scratch DB after 0063: items, tags and field values stayed intact.
  it("drops the category column, its enum and the legacy inventory columns, nothing else", () => {
    const dropped = [...drop.matchAll(/DROP COLUMN "([a-z_]+)"/g)].map((m) => m[1]);
    expect(dropped).toEqual(["category", "license_plate", "year_of_manufacture", "vehicle_inspection_due", "next_inspection_due", "last_inspection_date"]);
    expect(drop).toContain('DROP TYPE "public"."inventory_category"');
    expect(drop).not.toMatch(/DELETE|TRUNCATE|DROP TABLE/);
  });

  it("runs after the seed, which still reads the dropped columns", () => {
    const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    const tags = entries.map((e) => e.tag);
    expect(tags.indexOf("0063_inventory_templates_seed")).toBeLessThan(tags.indexOf("0064_inventory_drop_category"));
  });
});

describe("migration 0065 template descriptions", () => {
  const add = readFileSync("drizzle/0065_foamy_smiling_tiger.sql", "utf8");

  it("describes each shipped template within 120 characters and never overwrites an entered text", () => {
    const rows = [...add.matchAll(/^\s+\('([^']+)', '([^']+)'\),?$/gm)].map((m) => m);
    expect(rows.map((m) => m[1])).toEqual(["Fahrzeug", "Atemschutz", "Gerät", "PSA", "Sonstiges", "Hydrant"]);
    rows.forEach((m) => expect(m[2].length, m[1]).toBeLessThanOrEqual(120));
    expect(add).toContain(`t."description" IS NULL`);
  });
});
