import { isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { donations } from "../db/schema/index.js";

// In lib/ (not routes/donations.tsx) to avoid a circular import: that route imports Layout.
export async function countOpenReceipts(): Promise<number> {
  const rows = await db.select({ id: donations.id }).from(donations).where(isNull(donations.receiptIssuedAt));
  return rows.length;
}
