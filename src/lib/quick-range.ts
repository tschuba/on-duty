import type { t } from "../i18n/index.js";

type TranslationKey = Parameters<typeof t>[0];

export type RangePreset = { key: TranslationKey; start: string; end: string };

export function todayStr(): string {
  return fmt(new Date());
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fmt(new Date(y, m - 1 + months, d));
}

// "future": ab heute nach vorn (Prüfungen, Jubiläen, Verleih); "past": bis heute zurück (Spenden, Anträge).
export function rangePresets(today: string, dir: "future" | "past"): RangePreset[] {
  const y = Number(today.slice(0, 4));
  const year = (n: number) => ({ start: `${n}-01-01`, end: `${n}-12-31` });
  if (dir === "future") {
    return [
      { key: "filter.quick.3months", start: today, end: addMonths(today, 3) },
      { key: "filter.quick.6months", start: today, end: addMonths(today, 6) },
      { key: "filter.quick.12months", start: today, end: addMonths(today, 12) },
      { key: "filter.quick.thisYear", ...year(y) },
      { key: "filter.quick.nextYear", ...year(y + 1) },
    ];
  }
  return [
    { key: "filter.quick.last3months", start: addMonths(today, -3), end: today },
    { key: "filter.quick.last6months", start: addMonths(today, -6), end: today },
    { key: "filter.quick.last12months", start: addMonths(today, -12), end: today },
    { key: "filter.quick.thisYear", ...year(y) },
    { key: "filter.quick.lastYear", ...year(y - 1) },
  ];
}
