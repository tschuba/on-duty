import type { MemberStatus } from "./status.js";

export type EventKind = "birthday" | "anniversary";

export type AnniversaryEvent = {
  date: string;      // YYYY-MM-DD
  kind: EventKind;
  memberId: string;
  firstName: string;
  lastName: string;
  status: MemberStatus;
  years: number;     // age (birthday) or service years (anniversary)
  title?: string;    // from anniversary_years.title, anniversaries only
};

type AnniversaryYear = { year: number; title: string | null };
type MemberInput = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  entryDate: string;
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
    if (m.status === "archiviert") continue;

    // Birthdays: all non-archived members
    const birthMD = m.birthDate.slice(5);
    const birthYear = parseInt(m.birthDate.slice(0, 4), 10);
    for (let y = startYear; y <= endYear; y++) {
      const date = `${y}-${birthMD}`;
      if (date >= start && date <= end) {
        events.push({ date, kind: "birthday", memberId: m.id, firstName: m.firstName, lastName: m.lastName, status: m.status, years: y - birthYear });
      }
    }

    // Anniversaries: aktiv + jugend only
    if (m.status === "passiv") continue;
    const entryMD = m.entryDate.slice(5);
    for (const ay of anniversaryYears) {
      const ceremonyYear = getCeremonyYear(m.entryDate, cutoff, ay.year);
      const date = `${ceremonyYear}-${entryMD}`;
      if (date >= start && date <= end) {
        events.push({ date, kind: "anniversary", memberId: m.id, firstName: m.firstName, lastName: m.lastName, status: m.status, years: ay.year, title: ay.title ?? undefined });
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lastName.localeCompare(b.lastName, "de"));
  return events;
}
