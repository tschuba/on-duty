import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { applicationForms } from "../db/schema/index.js";

export type ApplicationFormType = "membership" | "youth";
export type ApplicationForm = typeof applicationForms.$inferSelect;

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// With no dates, isActive applies unconditionally. With a start and/or end date,
// isActive instead applies only within that window (both ends inclusive) —
// outside it, the opposite holds. E.g. isActive=true + startDate only = inactive
// before that date, active from it onward; isActive=true + endDate only = active
// up to and including that date, inactive after.
export function isFormCurrentlyActive(form: Pick<ApplicationForm, "isActive" | "startDate" | "endDate"> | undefined, today = todayDateString()): boolean {
  if (!form) return false;
  if (!form.startDate && !form.endDate) return form.isActive;
  const inWindow = (!form.startDate || today >= form.startDate) && (!form.endDate || today <= form.endDate);
  return inWindow ? form.isActive : !form.isActive;
}

export async function loadApplicationForm(type: ApplicationFormType): Promise<ApplicationForm | undefined> {
  return db.query.applicationForms.findFirst({ where: eq(applicationForms.type, type) });
}

export async function isApplicationFormActive(type: ApplicationFormType): Promise<boolean> {
  return isFormCurrentlyActive(await loadApplicationForm(type));
}

export async function loadApplicationForms(): Promise<Record<ApplicationFormType, ApplicationForm | undefined>> {
  const rows = await db.query.applicationForms.findMany();
  return {
    membership: rows.find((r) => r.type === "membership"),
    youth: rows.find((r) => r.type === "youth"),
  };
}

export async function saveApplicationForm(
  type: ApplicationFormType,
  values: { isActive: boolean; startDate: string | null; endDate: string | null },
): Promise<void> {
  await db.update(applicationForms).set(values).where(eq(applicationForms.type, type));
}
