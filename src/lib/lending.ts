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

export type LoanRange = { plannedFrom: string | null; plannedTo: string | null; pickedUpAt: string | null; returnedAt: string | null };

// Tatsächliches Datum hat Vorrang pro Rand — siehe Backlog-Doc "Überlappungs-
// Zeitraum pro Vorgang". Ein Vorgang ganz ohne Datum geht nicht in die Prüfung ein.
export function effectiveRange(loan: LoanRange): { from: string; to: string } | null {
  const from = loan.pickedUpAt ?? loan.plannedFrom;
  const to = loan.returnedAt ?? loan.plannedTo;
  if (!from && !to) return null;
  // Ein offenes Ende (nur von oder nur bis gesetzt) blockiert alles vor/nach
  // dem bekannten Rand — min/max-Sentinel statt Sonderfall-Vergleichslogik.
  return { from: from ?? "0000-01-01", to: to ?? "9999-12-31" };
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
  const day = { from: today, to: today };
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

export type LoanDateError = "noDates" | "plannedToBeforeFrom" | "returnedWithoutPickup" | "returnedBeforePickup";

// Tatsachen müssen zueinander passen: Rückgabe setzt Abholung voraus und liegt
// nicht davor; geplantes Ende nicht vor geplantem Start; mindestens ein Datum ist Pflicht.
export function validateLoanDates(l: LoanRange): LoanDateError | null {
  if (!l.plannedFrom && !l.plannedTo && !l.pickedUpAt && !l.returnedAt) return "noDates";
  if (l.plannedFrom && l.plannedTo && l.plannedTo < l.plannedFrom) return "plannedToBeforeFrom";
  if (!l.returnedAt) return null;
  if (!l.pickedUpAt) return "returnedWithoutPickup";
  return l.returnedAt < l.pickedUpAt ? "returnedBeforePickup" : null;
}
