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
