import { t } from "../i18n/index.js";
import { isValidEmail, isValidPhone } from "./contact.js";

export type RequestValues = {
  firstName: string; lastName: string; email: string; phone: string;
  plannedFrom: string; plannedTo: string; plannedFromTime: string; plannedToTime: string;
  quantity: string; message: string;
};

export type RequestItemRules = { individualTracking: boolean; timesRequired: boolean; maxQuantity: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseRequestValues(body: Record<string, any>): RequestValues {
  const s = (k: string) => String(body[k] ?? "").trim();
  return {
    firstName: s("firstName"), lastName: s("lastName"), email: s("email"), phone: s("phone"),
    plannedFrom: s("plannedFrom"), plannedTo: s("plannedTo"),
    plannedFromTime: s("plannedFromTime"), plannedToTime: s("plannedToTime"),
    quantity: s("quantity"), message: s("message"),
  };
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Ergebnis: Fehler je Feld (leer = gültig) und die normalisierte Menge.
export function validateRequest(v: RequestValues, rules: RequestItemRules, now = new Date()): { errors: Record<string, string>; quantity: number } {
  const errors: Record<string, string> = {};
  if (!v.firstName) errors.firstName = t("common.required");
  if (!v.lastName) errors.lastName = t("common.required");
  if (!v.email && !v.phone) errors.contact = t("apply.error.contactRequired");
  else if (v.email && !isValidEmail(v.email)) errors.contact = t("lend.error.invalidEmail");
  else if (v.phone && !isValidPhone(v.phone)) errors.contact = t("lend.error.invalidPhone");
  if (!v.message) errors.message = t("common.required");

  const today = ymd(now);
  const limit = ymd(addMonths(now, 12));
  const datesOk = DATE_RE.test(v.plannedFrom) && DATE_RE.test(v.plannedTo);
  if (!v.plannedFrom || !v.plannedTo) errors.dates = t("lend.error.datesRequired");
  else if (!datesOk) errors.dates = t("lend.error.datesInvalid");
  else if (v.plannedTo < v.plannedFrom) errors.dates = t("lending.loans.error.plannedToBeforeFrom");
  else if (v.plannedFrom < today) errors.dates = t("lend.error.inPast");
  else if (v.plannedTo > limit) errors.dates = t("lend.error.tooFar");

  const hasFrom = Boolean(v.plannedFromTime), hasTo = Boolean(v.plannedToTime);
  if (hasFrom !== hasTo) errors.times = t("lending.loans.error.timesIncomplete");
  else if (!hasFrom && rules.timesRequired) errors.times = t("lend.error.timesRequired");
  else if (hasFrom && (!TIME_RE.test(v.plannedFromTime) || !TIME_RE.test(v.plannedToTime))) errors.times = t("lend.error.timesInvalid");
  else if (hasFrom && !errors.dates) {
    if (v.plannedFrom === v.plannedTo && v.plannedToTime <= v.plannedFromTime) errors.times = t("lending.loans.error.plannedToTimeBeforeFrom");
    else if (v.plannedFrom === today && v.plannedFromTime < `${pad(now.getHours())}:${pad(now.getMinutes())}`) errors.times = t("lend.error.inPast");
  }

  let quantity = 1;
  if (!rules.individualTracking && rules.maxQuantity > 1) {
    quantity = Number(v.quantity || "1");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > rules.maxQuantity) {
      errors.quantity = t("lend.error.quantity", { max: rules.maxQuantity });
      quantity = 1;
    }
  }
  return { errors, quantity };
}
