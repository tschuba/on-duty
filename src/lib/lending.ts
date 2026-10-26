import { db } from "../db/index.js";

// "Überfällig" = geplantBis in der Vergangenheit und zurückgegebenAm leer —
// analog zum Prüffristen-Pattern in lib/inventory.ts, für die rote Badge-Zahl
// am Verleih-Tab (siehe InventoryTabs in routes/inventory.tsx).
export async function countOverdueLoans(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const loans = await db.query.lendingLoans.findMany({
    columns: { plannedTo: true, returnedAt: true },
  });
  return loans.filter((l) => l.plannedTo && l.plannedTo < today && !l.returnedAt).length;
}

// Zeiten optional ("HH:MM" oder "HH:MM:SS" aus der DB) — fehlend = ganzer Tag.
export type LoanRange = {
  plannedFrom: string | null; plannedTo: string | null; pickedUpAt: string | null; returnedAt: string | null;
  plannedFromTime?: string | null; plannedToTime?: string | null;
};

// Tatsächliches Datum hat Vorrang pro Rand — siehe Backlog-Doc "Überlappungs-
// Zeitraum pro Vorgang". Ein Vorgang ganz ohne Datum geht nicht in die Prüfung ein.
export function effectiveRange(loan: LoanRange): { from: string; to: string } | null {
  const from = loan.pickedUpAt ?? loan.plannedFrom;
  const to = loan.returnedAt ?? loan.plannedTo;
  if (!from && !to) return null;
  // Zeiten gelten nur für den geplanten Rand; Abhol-/Rückgabetag ist tagesgenau.
  const fromTime = !loan.pickedUpAt && loan.plannedFrom ? loan.plannedFromTime?.slice(0, 5) : undefined;
  const toTime = !loan.returnedAt && loan.plannedTo ? loan.plannedToTime?.slice(0, 5) : undefined;
  // Ein offenes Ende (nur von oder nur bis gesetzt) blockiert alles vor/nach
  // dem bekannten Rand — min/max-Sentinel statt Sonderfall-Vergleichslogik.
  return {
    from: from ? `${from}T${fromTime || "00:00"}` : "0000-01-01T00:00",
    to: to ? `${to}T${toTime || "23:59"}` : "9999-12-31T23:59",
  };
}

export function rangesOverlap(a: { from: string; to: string }, b: { from: string; to: string }): boolean {
  return a.from <= b.to && b.from <= a.to;
}

export type LoanStatus = "planned" | "active" | "overdue" | "returned";

// Gleiche Regel wie der inline `overdue`-Badge in routes/lending.tsx
// (Vorgangsseite) — hier benannt für die Vorgangsübersicht.
export function loanStatus(l: LoanRange, today: string): LoanStatus {
  if (l.returnedAt) return "returned";
  if (l.plannedTo && l.plannedTo < today) return "overdue";
  return l.pickedUpAt ? "active" : "planned";
}

// Verfügbare Menge zum Stichtag — siehe Backlog-Doc "Einzel-Tracking vs. Stückzahl":
// verfügbar = quantity - retiredQuantity - Σ(Menge aller am Stichtag laufenden Vorgänge).
export function availableQuantity(
  item: { quantity: number; retiredQuantity: number },
  loans: (LoanRange & { quantity: number })[],
  today: string,
): number {
  const day = { from: `${today}T00:00`, to: `${today}T23:59` };
  const used = loans.reduce((sum, l) => {
    const range = effectiveRange(l);
    return range && rangesOverlap(range, day) ? sum + l.quantity : sum;
  }, 0);
  return item.quantity - item.retiredQuantity - used;
}

export type ItemStatus = "retired" | "lendable" | "active";

// Ausgemustert gewinnt vor verleihbar; ohne lending:read ist Verleihbarkeit
// unbekannt (`lendable` = false) und das Item gilt als aktiv.
export function itemStatus(item: { retiredAt: unknown }, lendable: boolean): ItemStatus {
  if (item.retiredAt) return "retired";
  return lendable ? "lendable" : "active";
}

export type LoanDateError = "noDates" | "plannedToBeforeFrom" | "returnedWithoutPickup" | "returnedBeforePickup" | "timesIncomplete" | "plannedToTimeBeforeFrom";

// Tatsachen müssen zueinander passen: Rückgabe setzt Abholung voraus und liegt
// nicht davor; geplantes Ende nicht vor geplantem Start; mindestens ein Datum ist Pflicht.
export function validateLoanDates(l: LoanRange): LoanDateError | null {
  if (!l.plannedFrom && !l.plannedTo && !l.pickedUpAt && !l.returnedAt) return "noDates";
  if (l.plannedFrom && l.plannedTo && l.plannedTo < l.plannedFrom) return "plannedToBeforeFrom";
  const ft = l.plannedFromTime?.slice(0, 5), tt = l.plannedToTime?.slice(0, 5);
  if (Boolean(ft) !== Boolean(tt)) return "timesIncomplete";
  if (ft && tt && l.plannedFrom && l.plannedFrom === l.plannedTo && tt <= ft) return "plannedToTimeBeforeFrom";
  if (!l.returnedAt) return null;
  if (!l.pickedUpAt) return "returnedWithoutPickup";
  return l.returnedAt < l.pickedUpAt ? "returnedBeforePickup" : null;
}
