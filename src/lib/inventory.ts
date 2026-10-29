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

// Feste Felder, die ein Posten per "Feld hinzufügen" bekommen kann (Schlüssel in inventory_items.enabled_fields).
export const INVENTORY_FIELDS = ["quantity", "numbers", "serials", "location", "inspection", "assignments"] as const;
export type InventoryField = (typeof INVENTORY_FIELDS)[number];

export const hasField = (enabled: readonly string[] | null | undefined, f: InventoryField) => Boolean(enabled?.includes(f));

type LockState = {
  quantity: number;
  retiredQuantity: number;
  numbers: number;
  serials: number;
  assignments: number;
  locationText: string | null;
  latitude: string | null;
  longitude: string | null;
  vehicleInspectionDue: string | null;
  nextInspectionDue: string | null;
  lastInspectionDate: string | null;
  activeLoans: number;
};

// Ein Feld darf nur abgewählt werden, wenn es leer ist — nichts geht still verloren.
export function isFieldEmpty(f: InventoryField, s: LockState): boolean {
  switch (f) {
    case "quantity": return s.activeLoans === 0 && s.quantity <= 1 && s.retiredQuantity === 0;
    case "numbers": return s.numbers === 0;
    case "serials": return s.serials === 0;
    case "assignments": return s.assignments === 0;
    case "location": return !s.locationText && s.latitude == null && s.longitude == null;
    case "inspection": return !s.vehicleInspectionDue && !s.nextInspectionDue && !s.lastInspectionDate;
  }
}

// Koordinaten nur zusammen; Strings, weil sie roh aus dem Formular bzw. numeric-Spalte kommen.
export function validateLocation(latitude: string, longitude: string): { latitude?: "invalid" | "pair"; longitude?: "invalid" | "pair" } {
  const parse = (v: string, max: number) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && Math.abs(n) <= max;
  };
  const errors: { latitude?: "invalid" | "pair"; longitude?: "invalid" | "pair" } = {};
  if (latitude && !parse(latitude, 90)) errors.latitude = "invalid";
  if (longitude && !parse(longitude, 180)) errors.longitude = "invalid";
  if (!latitude !== !longitude) errors[latitude ? "longitude" : "latitude"] ??= "pair";
  return errors;
}

export type FieldDefType = "text" | "number" | "date" | "boolean" | "select";

// Wert eines freien Felds gegen seinen Typ prüfen; leer ist immer erlaubt. Gibt den zu speichernden Wert zurück.
export function normalizeFieldValue(type: FieldDefType, options: string[] | null, raw: string): { value: string | null; error?: true } {
  const v = raw.trim();
  if (!v) return { value: null };
  if (type === "number") return Number.isFinite(Number(v.replace(",", "."))) ? { value: v.replace(",", ".") } : { value: null, error: true };
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { value: v } : { value: null, error: true };
  if (type === "boolean") return v === "1" || v === "0" ? { value: v } : { value: null, error: true };
  if (type === "select") return options?.includes(v) ? { value: v } : { value: null, error: true };
  return { value: v };
}
