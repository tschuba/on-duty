import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { donations } from "../db/schema/index.js";

export type ReceiptStatus = "open" | "issued" | "not_required";
export type ReceiptAction = "issue" | "markNotRequired" | "reopen" | "revoke";

// Pure transition table; null = not allowed.
export function nextReceiptStatus(from: ReceiptStatus, action: ReceiptAction): ReceiptStatus | null {
  switch (action) {
    case "issue": return from === "issued" ? null : "issued";
    case "markNotRequired": return from === "open" ? "not_required" : null;
    case "reopen": return from === "not_required" ? "open" : null;
    case "revoke": return from === "issued" ? "open" : null;
  }
}

// Company name replaces the person's name (company donors, contact person stays in firstName/lastName).
export function recipientName(p: { firstName: string; lastName: string; companyName?: string | null }): string {
  return p.companyName || `${p.firstName} ${p.lastName}`;
}

// In lib/ (not routes/donations.tsx) to avoid a circular import: that route imports Layout.
export async function countOpenReceipts(): Promise<number> {
  const rows = await db.select({ id: donations.id }).from(donations).where(eq(donations.receiptStatus, "open"));
  return rows.length;
}

type SummaryInput = { amount: string | number; donorId: string; receiptStatus: string };
export type DonationSummary = {
  count: number;
  cents: number;
  averageCents: number;
  donors: number;
  open: { count: number; cents: number };
};

// Sums in integer cents (no float drift).
export function summarizeDonations(list: SummaryInput[]): DonationSummary {
  let cents = 0;
  const open = { count: 0, cents: 0 };
  const donors = new Set<string>();
  for (const d of list) {
    const c = Math.round(Number(d.amount) * 100);
    cents += c;
    donors.add(d.donorId);
    if (d.receiptStatus === "open") { open.count++; open.cents += c; }
  }
  return { count: list.length, cents, averageCents: list.length ? Math.round(cents / list.length) : 0, donors: donors.size, open };
}

export type DonorSortKey = "donor" | "count" | "amount" | "last";
export type DonorSummary<D> = { donor: D; count: number; cents: number; last: string | null };

// Per-donor totals over the given donations (caller applies the date range); donors without donations stay with 0 / null.
export function summarizeDonors<D extends { id: string; person: { firstName: string; lastName: string; companyName?: string | null } }>(
  donors: D[],
  donations: { donorId: string; amount: string | number; date: string }[],
  sort: DonorSortKey = "donor",
  dir: "asc" | "desc" = "asc",
): DonorSummary<D>[] {
  const by = new Map<string, DonorSummary<D>>(donors.map((donor) => [donor.id, { donor, count: 0, cents: 0, last: null }]));
  for (const d of donations) {
    const s = by.get(d.donorId);
    if (!s) continue;
    s.count++;
    s.cents += Math.round(Number(d.amount) * 100);
    if (!s.last || d.date > s.last) s.last = d.date;
  }
  const name = (s: DonorSummary<D>) => s.donor.person.companyName || s.donor.person.lastName;
  const byName = (a: DonorSummary<D>, b: DonorSummary<D>) =>
    name(a).localeCompare(name(b), "de") || a.donor.person.firstName.localeCompare(b.donor.person.firstName, "de");
  const cmp = (a: DonorSummary<D>, b: DonorSummary<D>) =>
    sort === "count" ? a.count - b.count : sort === "amount" ? a.cents - b.cents : sort === "last" ? (a.last ?? "").localeCompare(b.last ?? "") : byName(a, b);
  const sign = dir === "asc" ? 1 : -1;
  return [...by.values()].sort((a, b) => sign * cmp(a, b) || byName(a, b));
}
