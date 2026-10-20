import { isFormer, type MemberStatus } from "./status.js";

export type EventKind = "birthday" | "anniversary";
export type AnniversaryType = "service" | "membership";

export type AnniversaryEvent = {
  date: string;      // YYYY-MM-DD
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
    const birthMD = m.birthDate.slice(5);
    const birthYear = parseInt(m.birthDate.slice(0, 4), 10);
    for (let y = startYear; y <= endYear; y++) {
      const date = `${y}-${birthMD}`;
      if (date >= start && date <= end) {
        events.push({ date, kind: "birthday", memberId: m.id, firstName: m.firstName, lastName: m.lastName, status: m.status, years: y - birthYear });
      }
    }

    // Service: aktiv only, based on first entry into any fire brigade.
    // Membership: everyone who has not left, based on entry into ours.
    const bases: { type: AnniversaryType; base: string }[] = [];
    if (m.status === "aktiv") bases.push({ type: "service", base: m.firstEntryDate ?? m.entryDate });
    bases.push({ type: "membership", base: m.entryDate });

    const found = new Map<string, AnniversaryEvent>();
    for (const { type, base } of bases) {
      for (const ay of anniversaryYears) {
        if (ay.kind !== type) continue;
        const date = `${getCeremonyYear(base, cutoff, ay.year)}-${cutoff}`;
        if (date < start || date > end) continue;
        const key = `${date}|${ay.year}`;
        const prev = found.get(key);
        if (prev) {
          prev.types!.push(type);
          if (ay.title && ay.title !== prev.title) prev.title = prev.title ? `${prev.title} / ${ay.title}` : ay.title;
        } else {
          found.set(key, { date, kind: "anniversary", memberId: m.id, firstName: m.firstName, lastName: m.lastName, status: m.status, years: ay.year, title: ay.title ?? undefined, types: [type] });
        }
      }
    }
    events.push(...found.values());
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lastName.localeCompare(b.lastName, "de"));
  return events;
}
