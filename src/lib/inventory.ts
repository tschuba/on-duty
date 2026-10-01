import { db } from "../db/index.js";

export type InventoryCategory = "vehicle" | "scba" | "equipment" | "ppe" | "other";

export type InspectionDueItem = {
  id: string;
  name: string;
  category: InventoryCategory;
  dueDate: string; // YYYY-MM-DD
};

type InventoryItemInput = {
  id: string;
  name: string;
  category: InventoryCategory;
  retiredAt: string | null;
  vehicleInspectionDue: string | null;
  nextInspectionDue: string | null;
};

// Prüffristen werden on-the-fly aus den Fälligkeits-Feldern generiert (analog
// src/lib/anniversaries.ts) — kein eigener Event-Store. "other" hat kein
// Prüf-Feld und taucht nie auf. Ausgemusterte Items werden nicht mehr geprüft.
export function generateInspectionDueItems(items: InventoryItemInput[], start: string, end: string): InspectionDueItem[] {
  const result: InspectionDueItem[] = [];
  for (const item of items) {
    if (item.retiredAt) continue;
    const dueDate = item.category === "vehicle" ? item.vehicleInspectionDue : item.nextInspectionDue;
    if (!dueDate || dueDate < start || dueDate > end) continue;
    result.push({ id: item.id, name: item.name, category: item.category, dueDate });
  }
  result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "de"));
  return result;
}

// Own minimal query (not routes/inventory.tsx's fetchItems with its joins) to
// avoid a circular import: that route imports Layout, Layout needs this count.
// Same db.query.inventoryItems.findMany shape routes/inventory.tsx uses, so it
// goes through the same mock in tests.
export async function countOverdueInspectionItems(): Promise<number> {
  const rows = (await db.query.inventoryItems.findMany({
    columns: { id: true, name: true, category: true, retiredAt: true, vehicleInspectionDue: true, nextInspectionDue: true },
  })) as InventoryItemInput[];
  const today = new Date().toISOString().slice(0, 10);
  return generateInspectionDueItems(rows, "0000-01-01", today).length;
}
