import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { applications } from "../db/schema/index.js";

// Used by both routes/applications.tsx (list default filter) and layout.tsx (nav
// badge) — kept here, not in routes/applications.tsx, to avoid a circular import
// (that route file imports Layout).
export async function countOpenApplications(): Promise<number> {
  const rows = await db.select({ id: applications.id }).from(applications).where(eq(applications.status, "open"));
  return rows.length;
}
