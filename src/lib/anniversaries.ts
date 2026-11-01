import { isFormer, type MemberStatus } from "./status.js";
import { t } from "../i18n/index.js";

export type EventKind = "birthday" | "anniversary";
export type AnniversaryType = "service" | "membership";

export type AnniversaryEvent = {
  date: string;      // YYYY-MM-DD; day of the birthday/anniversary (filter, sort, grouping)
  ceremonyDate?: string; // anniversaries only: first cutoff on/after the anniversary day
  days?: string[];   // merged rows only (see mergeEvents): all anniversary days, ascending; days[0] === date
  kind: EventKind;
  memberId: string;
  firstName: string;
  lastName: string;
  status: MemberStatus;
  years: number;     // age (birthday) or service years (anniversary)
  title?: string;    // from anniversary_years.title, anniversaries only
  types?: AnniversaryType[]; // anniversaries only; both when service and membership coincide
};

type AnniversaryYear = { kind: AnniversaryType; year: number; title: string | null };
type MemberInput = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  entryDate: string;
  firstEntryDate?: string | null;
  status: MemberStatus;
};

// cutoff: "MM-DD", e.g. "01-06" = January 6
export function getCeremonyYear(entryDate: string, cutoff: string, anniversaryCount: number): number {
  const em = parseInt(entryDate.slice(5, 7), 10);
  const ed = parseInt(entryDate.slice(8, 10), 10);
  const [cm, cd] = cutoff.split("-").map(Number);
  const entryYear = parseInt(entryDate.slice(0, 4), 10);
  const adjustment = em * 100 + ed <= cm * 100 + cd ? 0 : 1;
  return entryYear + adjustment + anniversaryCount;
}

// Day of the n-th recurrence of base (YYYY-MM-DD); Feb 29 falls on Mar 1 in non-leap years (BGB).
export function recurrenceDate(base: string, n: number): string {
  const y = parseInt(base.slice(0, 4), 10) + n;
  const md = base.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === "02-29" && !leap ? `${y}-03-01` : `${y}-${md}`;
}

// Returns all events in [start, end] (YYYY-MM-DD strings, inclusive), sorted by date then lastName.
export function generateEvents(
  members: MemberInput[],
  anniversaryYears: AnniversaryYear[],
  cutoff: string,
  start: string,
  end: string
): AnniversaryEvent[] {
  const events: AnniversaryEvent[] = [];
  const startYear = parseInt(start.slice(0, 4), 10);
  const endYear = parseInt(end.slice(0, 4), 10);

  for (const m of members) {
    if (isFormer(m.status)) continue;

    // Birthdays: all members who have not left
    const birthYear = parseInt(m.birthDate.slice(0, 4), 10);
    for (let y = startYear; y <= endYear; y++) {
      const date = recurrenceDate(m.birthDate, y - birthYear);
      if (date >= start && date <= end) {
        events.push({ date, kind: "birthday", memberId: m.id, firstName: m.firstName, lastName: m.lastName, status: m.status, years: y - birthYear });
      }
    }

    // Service: aktiv only, based on first entry into any fire brigade.
    // Membership: everyone who has not left, based on entry into ours.
    const bases: { type: AnniversaryType; base: string }[] = [];
    if (m.status === "active") bases.push({ type: "service", base: m.firstEntryDate ?? m.entryDate });
    bases.push({ type: "membership", base: m.entryDate });

    const found = new Map<string, AnniversaryEvent>();
    for (const { type, base } of bases) {
      for (const ay of anniversaryYears) {
        if (ay.kind !== type) continue;
        const date = recurrenceDate(base, ay.year);
        if (date < start || date > end) continue;
        const key = `${date}|${ay.year}`;
        const prev = found.get(key);
        if (prev) {
          prev.types!.push(type);
          if (ay.title && ay.title !== prev.title) prev.title = prev.title ? `${prev.title} / ${ay.title}` : ay.title;
        } else {
          found.set(key, { date, ceremonyDate: `${getCeremonyYear(base, cutoff, ay.year)}-${cutoff}`, kind: "anniversary", memberId: m.id, firstName: m.firstName, lastName: m.lastName, status: m.status, years: ay.year, title: ay.title ?? undefined, types: [type] });
        }
      }
    }
    events.push(...found.values());
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lastName.localeCompare(b.lastName, "de"));
  return events;
}

// Merges service and membership events of one person (same ceremony and years, different
// anniversary days) into one row when directly adjacent in the already filtered, sorted list.
export function mergeEvents(events: AnniversaryEvent[]): AnniversaryEvent[] {
  const out: AnniversaryEvent[] = [];
  for (const e of events) {
    const p = out[out.length - 1];
    if (p && e.kind === "anniversary" && p.kind === "anniversary" && p.memberId === e.memberId
      && p.ceremonyDate === e.ceremonyDate && p.years === e.years) {
      p.days = [...(p.days ?? [p.date]), e.date];
      p.types = [...new Set([...p.types!, ...e.types!])];
      if (e.title && e.title !== p.title) p.title = p.title ? `${p.title} / ${e.title}` : e.title;
    } else out.push({ ...e });
  }
  return out;
}

// Mindestjahre und Halbrund/Rund (OR über die gewählten Werte, leer = keine Einschränkung).
// Von Seite und Export gemeinsam genutzt.
export function filterByYears(events: AnniversaryEvent[], gte: number, mods: string[]): AnniversaryEvent[] {
  const want5 = mods.includes("5"), want10 = mods.includes("10");
  return events.filter((e) =>
    (gte <= 0 || e.years >= gte) &&
    (!want5 && !want10 || (want10 && e.years % 10 === 0) || (want5 && e.years % 5 === 0 && e.years % 10 !== 0)),
  );
}

// Beschriftung des Filter-Buttons: short im Button, long als Tooltip/Überschrift.
// kinds = aktive Arten (alle drei, wenn nichts gewählt ist).
export function anniversaryFilterLabel(kinds: string[], mods: string[], gte: number): { short: string; long: string } {
  const order = ["service", "membership", "birthdays"].filter((k) => kinds.includes(k));
  const kindId = order.length === 3 || order.length === 0 ? "all" : order.join("+");
  const modId = mods.includes("5") && mods.includes("10") ? "both" : mods.includes("5") ? "5" : mods.includes("10") ? "10" : "";
  const hasGte = gte > 0;
  // "all": Adjektiv nach "Alle" (kleingeschrieben, dekliniert)
  const build = (v: "short" | "long", modForm: "short" | "long" | "all" = v) => {
    const noun = t(`anniversaries.label.kind.${kindId}.${v}` as "anniversaries.label.kind.all.short");
    const mod = modId ? t(`anniversaries.label.mod.${modId}.${modForm}` as "anniversaries.label.mod.5.short") + " " : "";
    const suffix = hasGte ? t(`anniversaries.label.gte.${v}`, { n: gte }) : "";
    return mod + noun + suffix;
  };
  return {
    short: build("short"),
    long: hasGte ? build("long") : t("anniversaries.label.allPrefix") + build("long", "all"),
  };
}
