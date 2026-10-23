import { t } from "../i18n/index.js";
import { formatDate } from "./format.js";

type TranslationKey = Parameters<typeof t>[0];

export type RangePreset = { id: string; key: TranslationKey; start: string; end: string };

export function todayStr(): string {
  return fmt(new Date());
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Tag auf das Monatsende des Zielmonats kappen (31.01. + 1 Monat = 28./29.02.).
  const last = new Date(y, m + months, 0).getDate();
  return fmt(new Date(y, m - 1 + months, Math.min(d, last)));
}

// "future": ab heute nach vorn (Prüfungen, Jubiläen, Verleih); "past": bis heute zurück (Spenden, Anträge).
export function rangePresets(today: string, dir: "future" | "past"): RangePreset[] {
  const y = Number(today.slice(0, 4));
  const year = (n: number) => ({ start: `${n}-01-01`, end: `${n}-12-31` });
  if (dir === "future") {
    return [
      { id: "3m", key: "filter.quick.3months", start: today, end: addMonths(today, 3) },
      { id: "6m", key: "filter.quick.6months", start: today, end: addMonths(today, 6) },
      { id: "12m", key: "filter.quick.12months", start: today, end: addMonths(today, 12) },
      { id: "thisYear", key: "filter.quick.thisYear", ...year(y) },
      { id: "nextYear", key: "filter.quick.nextYear", ...year(y + 1) },
    ];
  }
  return [
    { id: "3m", key: "filter.quick.last3months", start: addMonths(today, -3), end: today },
    { id: "6m", key: "filter.quick.last6months", start: addMonths(today, -6), end: today },
    { id: "12m", key: "filter.quick.last12months", start: addMonths(today, -12), end: today },
    { id: "thisYear", key: "filter.quick.thisYear", ...year(y) },
    { id: "lastYear", key: "filter.quick.lastYear", ...year(y - 1) },
  ];
}

export type RelUnit = "D" | "W" | "M" | "Y";
export type RelDir = "past" | "future" | "both";
export const REL_UNITS: RelUnit[] = ["D", "W", "M", "Y"];
export const REL_DIRS: RelDir[] = ["past", "future", "both"];
const REL_RE = /^P(\d{1,3})([DWMY])$/;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fmt(new Date(y, m - 1, d + days));
}

function shift(today: string, n: number, unit: RelUnit): string {
  if (unit === "D") return addDays(today, n);
  if (unit === "W") return addDays(today, 7 * n);
  return addMonths(today, unit === "M" ? n : 12 * n);
}

// Heute ist immer enthalten; Monatsende wird abgeschnitten (addMonths via Date).
export function relativeRange(today: string, n: number, unit: RelUnit, dir: RelDir): { start: string; end: string } {
  return {
    start: dir === "future" ? today : shift(today, -n, unit),
    end: dir === "past" ? today : shift(today, n, unit),
  };
}

export type ParsedRange = {
  mode: "default" | "preset" | "rel" | "custom";
  start: string;
  end: string;
  id?: string; // preset
  rel?: { n: number; unit: RelUnit; dir: RelDir };
};

type RangeQuery = { range?: string; rel?: string; dir?: string; start?: string; end?: string };

// Löst die URL-Parameter gegen heute auf. Ungültiges fällt still auf den Seiten-Standard zurück.
// `start`/`end` sind hier die Werte der Seite (je nach Route aus start/end bzw. from/to gelesen).
export function parseRange(q: RangeQuery, today: string, dir: "future" | "past", defaults: { start: string; end: string }): ParsedRange {
  const fallback: ParsedRange = { mode: "default", ...defaults };
  const hasDates = q.start !== undefined || q.end !== undefined;
  const custom: ParsedRange = { mode: "custom", start: q.start ?? defaults.start, end: q.end ?? defaults.end };
  const presets = rangePresets(today, dir);
  if (q.range === "custom") return custom;
  if (q.range === "rel") {
    const m = REL_RE.exec(q.rel ?? "");
    const d = REL_DIRS.find((x) => x === q.dir);
    if (!m || !d || Number(m[1]) < 1) return fallback;
    const n = Number(m[1]), unit = m[2] as RelUnit;
    return { mode: "rel", ...relativeRange(today, n, unit, d), rel: { n, unit, dir: d } };
  }
  const p = presets.find((x) => x.id === q.range);
  if (p) return { mode: "preset", start: p.start, end: p.end, id: p.id };
  if (!hasDates) return fallback;
  // Alte Links nur mit Daten: exakter Preset-Treffer → Preset, sonst benutzerdefiniert.
  const hit = presets.find((x) => x.start === custom.start && x.end === custom.end);
  return hit ? { mode: "preset", start: hit.start, end: hit.end, id: hit.id } : custom;
}

// Parameter, die den Bereich in Links/Formularen erhalten (ohne Standard); `names` = Datumsparameter der Seite.
export function rangeParams(r: ParsedRange, names: { start: string; end: string } = { start: "start", end: "end" }): Record<string, string | undefined> {
  if (r.mode === "preset") return { range: r.id };
  if (r.mode === "rel") return { range: "rel", rel: `P${r.rel!.n}${r.rel!.unit}`, dir: r.rel!.dir };
  if (r.mode === "custom") return { range: "custom", [names.start]: r.start, [names.end]: r.end };
  return {};
}

// ── Anzeige ───────────────────────────────────────────────────────────────────

const MONTH_KEYS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const monthName = (m: number, short: boolean) => {
  const n = t(`month.${MONTH_KEYS[m - 1]}` as TranslationKey);
  return short && n.length > 4 ? n.slice(0, 3) : n;
};
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

// Kurzform für schnelle Lesbarkeit: "März 2026", "Jan – März 2026", "heute bis 23.01.2027", "23.01. – 23.06.2026".
export function formatRange(start: string, end: string, today: string): string {
  if (!start && !end) return "";
  if (!end) return `ab ${formatDate(start)}`;
  if (!start) return `bis ${formatDate(end)}`;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sd === 1 && ed === daysIn(ey, em) && start <= end) { // ganze Kalendermonate
    if (sy === ey && sm === 1 && em === 12) return String(sy);
    if (sy === ey && sm === em) return `${monthName(sm, false)} ${sy}`;
    if (sy === ey) return `${monthName(sm, true)} – ${monthName(em, true)} ${sy}`;
    return `${monthName(sm, true)} ${sy} – ${monthName(em, true)} ${ey}`;
  }
  if (start === today && end === today) return t("filter.quick.today");
  if (start === today) return `${t("filter.quick.today")} bis ${formatDate(end)}`;
  if (end === today) return `${formatDate(start)} bis ${t("filter.quick.today")}`;
  if (sy === ey) return `${formatDate(start).slice(0, 6)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

const UNIT_LABEL: Record<RelUnit, [TranslationKey, TranslationKey]> = {
  D: ["filter.quick.unit1.D", "filter.quick.unit.D"],
  W: ["filter.quick.unit1.W", "filter.quick.unit.W"],
  M: ["filter.quick.unit1.M", "filter.quick.unit.M"],
  Y: ["filter.quick.unit1.Y", "filter.quick.unit.Y"],
};

// Button-Label für "Relativ": "+3 Monate", "−1 Woche", "±10 Tage".
export function relLabel(n: number, unit: RelUnit, dir: RelDir): string {
  const sign = dir === "future" ? "+" : dir === "past" ? "−" : "±";
  return `${sign}${n} ${t(UNIT_LABEL[unit][n === 1 ? 0 : 1])}`;
}
