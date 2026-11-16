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

type SummaryInput = { amount: string | number; date: string; type: string | null; donorId: string; receiptStatus: string };
type Bucket = { count: number; cents: number; cashCents: number; transferCents: number };
export type DonationSummary = Bucket & {
  averageCents: number;
  donors: number;
  open: { count: number; cents: number };
  years: (Bucket & { year: string })[];
};

// Sums in integer cents (no float drift); years sorted descending.
export function summarizeDonations(list: SummaryInput[]): DonationSummary {
  const add = (b: Bucket, d: SummaryInput, cents: number) => {
    b.count++;
    b.cents += cents;
    if (d.type === "cash") b.cashCents += cents;
    if (d.type === "transfer") b.transferCents += cents;
  };
  const total: Bucket = { count: 0, cents: 0, cashCents: 0, transferCents: 0 };
  const open = { count: 0, cents: 0 };
  const byYear = new Map<string, Bucket>();
  const donors = new Set<string>();
  for (const d of list) {
    const cents = Math.round(Number(d.amount) * 100);
    add(total, d, cents);
    donors.add(d.donorId);
    if (d.receiptStatus === "open") { open.count++; open.cents += cents; }
    const year = d.date.slice(0, 4);
    const b = byYear.get(year) ?? { count: 0, cents: 0, cashCents: 0, transferCents: 0 };
    add(b, d, cents);
    byYear.set(year, b);
  }
  return {
    ...total,
    averageCents: total.count ? Math.round(total.cents / total.count) : 0,
    donors: donors.size,
    open,
    years: [...byYear].map(([year, b]) => ({ year, ...b })).sort((a, b) => b.year.localeCompare(a.year)),
  };
}
