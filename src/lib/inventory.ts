import { db } from "../db/index.js";
import { addMonths } from "./quick-range.js";

export type InventoryCategory = "vehicle" | "scba" | "equipment" | "ppe" | "other";

export type InspectionDueItem = {
  id: string;
  name: string;
  inspectionId: string;
  inspectionName: string;
  dueDate: string; // YYYY-MM-DD
};

type InventoryItemInput = {
  id: string;
  name: string;
  retiredAt: string | null;
  inspections: { id: string; name: string; dueDate: string | null }[];
};

// Prüffristen kommen aus den Prüfarten der Posten (inventory_inspections) — eine Zeile je offener Prüfart,
// kein eigener Event-Store. Ausgemusterte Posten werden nicht mehr geprüft; ohne dueDate ist eine Prüfart erledigt.
// `names` (optional) beschränkt auf bestimmte Prüfart-Namen, ohne Beachtung der Groß-/Kleinschreibung.
export function generateInspectionDueItems(items: InventoryItemInput[], start: string, end: string, names?: string[]): InspectionDueItem[] {
  const wanted = names?.length ? new Set(names.map((n) => n.toLowerCase())) : null;
  const result: InspectionDueItem[] = [];
  for (const item of items) {
    if (item.retiredAt) continue;
    for (const insp of item.inspections) {
      const dueDate = insp.dueDate;
      if (!dueDate || dueDate < start || dueDate > end) continue;
      if (wanted && !wanted.has(insp.name.toLowerCase())) continue;
      result.push({ id: item.id, name: item.name, inspectionId: insp.id, inspectionName: insp.name, dueDate });
    }
  }
  result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "de") || a.inspectionName.localeCompare(b.inspectionName, "de"));
  return result;
}

// Own minimal query (not routes/inventory.tsx's fetchItems with its joins) to
// avoid a circular import: that route imports Layout, Layout needs this count.
// Same db.query.inventoryItems.findMany shape routes/inventory.tsx uses, so it
// goes through the same mock in tests.
export async function countOverdueInspectionItems(): Promise<number> {
  const rows = (await db.query.inventoryItems.findMany({
    columns: { id: true, name: true, retiredAt: true },
    with: { inspections: { columns: { id: true, name: true, dueDate: true } } },
  })) as InventoryItemInput[];
  const today = new Date().toISOString().slice(0, 10);
  return generateInspectionDueItems(rows, "0000-01-01", today).length;
}

// Neue Fälligkeit nach "Als geprüft markieren": alte Fälligkeit + Intervall (die Frist driftet nicht);
// liegt das nicht nach dem Prüfdatum oder gibt es keine alte Fälligkeit: Prüfdatum + Intervall; ohne Intervall: erledigt.
export function nextDueDate(oldDue: string | null, intervalMonths: number | null, inspectedAt: string): string | null {
  if (!intervalMonths) return null;
  const anchored = oldDue ? addMonths(oldDue, intervalMonths) : null;
  return anchored && anchored > inspectedAt ? anchored : addMonths(inspectedAt, intervalMonths);
}

// ── Prüfarten im Posten-Formular ─────────────────────────────────────────────

export type InspectionFormRow = { id: string; name: string; interval: string; last: string; due: string };
export type InspectionRowError = "name" | "nameLength" | "interval" | "date" | "future" | "duplicate";
export const INSPECTION_NAME_MAX = 60;

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Zeilen kommen als parallele Felder (insp_id/insp_name/insp_interval/insp_last/insp_due); komplett leere Zeilen
// entfallen, die Fehler-Indizes beziehen sich auf die verbleibenden Zeilen.
export function parseInspectionRows(body: Record<string, any>, today: string): { rows: InspectionFormRow[]; errors: Record<number, InspectionRowError> } {
  const col = (key: string): string[] => {
    const raw = body[key];
    return (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => String(v).trim());
  };
  const [ids, names, intervals, lasts, dues] = ["insp_id", "insp_name", "insp_interval", "insp_last", "insp_due"].map(col);
  const rows: InspectionFormRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const row = { id: ids[i] ?? "", name: names[i], interval: intervals[i] ?? "", last: lasts[i] ?? "", due: dues[i] ?? "" };
    if (row.name || row.interval || row.last || row.due) rows.push(row);
  }
  const errors: Record<number, InspectionRowError> = {};
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const interval = Number(r.interval);
    const key = r.name.toLowerCase();
    const error: InspectionRowError | undefined =
      !r.name ? "name"
      : r.name.length > INSPECTION_NAME_MAX ? "nameLength"
      : r.interval && !(/^\d+$/.test(r.interval) && interval >= 1 && interval <= 120) ? "interval"
      : (r.last && !isIsoDate(r.last)) || (r.due && !isIsoDate(r.due)) ? "date"
      : r.last > today ? "future"
      : seen.has(key) ? "duplicate"
      : undefined;
    if (error) errors[i] = error;
    seen.add(key);
  });
  return { rows, errors };
}

// Abgleich mit dem Bestand wie bei Nummern/Seriennummern: Zeile mit bekannter id ändern, ohne id anlegen, fehlende löschen.
export function diffInspections<T extends { id: string }>(existingIds: string[], rows: T[]): { insert: T[]; update: T[]; deleteIds: string[] } {
  const known = new Set(existingIds);
  const kept = new Set(rows.filter((r) => known.has(r.id)).map((r) => r.id));
  return {
    insert: rows.filter((r) => !known.has(r.id)),
    update: rows.filter((r) => known.has(r.id)),
    deleteIds: existingIds.filter((id) => !kept.has(id)),
  };
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
  inspections: number;
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
    case "inspection": return s.inspections === 0;
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

// Auswahlwerte aus einem Textfeld (eine Zeile je Wert): getrimmt, ohne Leerzeilen und Duplikate.
export function parseOptions(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

// Verwendete Auswahlwerte dürfen nicht entfernt werden; liefert die blockierten.
export function blockedOptionRemovals(oldOptions: string[], newOptions: string[], usedValues: (string | null)[]): string[] {
  return oldOptions.filter((o) => !newOptions.includes(o) && usedValues.includes(o));
}
