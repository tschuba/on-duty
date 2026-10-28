import { describe, it, expect } from "vitest";
import { getCeremonyYear, generateEvents, anniversaryFilterLabel, filterByYears } from "../lib/anniversaries.js";

const CUTOFF = "01-06"; // January 6

describe("getCeremonyYear", () => {
  // Examples from Requirements.md
  it("entry Dec 31, 1999 → 25-year anniversary in 2025", () => {
    expect(getCeremonyYear("1999-12-31", CUTOFF, 25)).toBe(2025);
  });

  it("entry Jan 6, 2000 (on cutoff) → 25-year anniversary in 2025", () => {
    expect(getCeremonyYear("2000-01-06", CUTOFF, 25)).toBe(2025);
  });

  it("entry Jan 7, 2000 (one day after cutoff) → 25-year anniversary in 2026", () => {
    expect(getCeremonyYear("2000-01-07", CUTOFF, 25)).toBe(2026);
  });

  // Additional edge cases
  it("entry Jan 1 (before cutoff) → no adjustment", () => {
    expect(getCeremonyYear("2000-01-01", CUTOFF, 40)).toBe(2040);
  });

  it("entry Jan 5 (day before cutoff) → no adjustment", () => {
    expect(getCeremonyYear("2000-01-05", CUTOFF, 40)).toBe(2040);
  });

  it("entry Jan 8 → +1 adjustment", () => {
    expect(getCeremonyYear("2000-01-08", CUTOFF, 40)).toBe(2041);
  });

  it("entry March 15 → +1 adjustment", () => {
    expect(getCeremonyYear("1999-03-15", CUTOFF, 25)).toBe(2025);
  });

  it("entry June 1 → +1 adjustment", () => {
    expect(getCeremonyYear("2000-06-01", CUTOFF, 25)).toBe(2026);
  });

  it("custom cutoff Jun 30", () => {
    // entry Jul 1 → after cutoff → +1
    expect(getCeremonyYear("2000-07-01", "06-30", 25)).toBe(2026);
    // entry Jun 30 → on cutoff → no adjustment
    expect(getCeremonyYear("2000-06-30", "06-30", 25)).toBe(2025);
  });
});

describe("generateEvents scope filtering", () => {
  const ay = [{ kind: "service" as const, year: 25, title: null }, { kind: "membership" as const, year: 25, title: null }];

  const mkMember = (status: "active" | "youth" | "children" | "passive" | "supporting" | "left" | "deceased") => ({
    id: status,
    firstName: "Max",
    lastName: "Muster",
    birthDate: "1990-06-15",
    entryDate: "2000-06-15", // Jun 15 > Jan 6 → ceremony year = 2000+1+25 = 2026
    status,
  });

  it("ausgeschieden: no events", () => {
    for (const st of ["left", "deceased"] as const) {
      const evs = generateEvents([mkMember(st)], ay, CUTOFF, "2025-01-01", "2027-12-31");
      expect(evs).toHaveLength(0);
    }
  });

  it("passive/children/youth: membership only", () => {
    for (const st of ["passive", "children", "youth"] as const) {
      const a = generateEvents([mkMember(st)], ay, CUTOFF, "2025-01-01", "2027-12-31").filter(e => e.kind === "anniversary");
      expect(a.map(e => e.types)).toEqual([["membership"]]);
    }
  });

  it("active without firstEntryDate: one merged row", () => {
    const a = generateEvents([mkMember("active")], ay, CUTOFF, "2025-01-01", "2027-12-31").filter(e => e.kind === "anniversary");
    expect(a).toHaveLength(1);
    expect(a[0].types).toEqual(["service", "membership"]);
  });

  it("firstEntryDate shifts service, separate rows", () => {
    const m = { ...mkMember("active"), firstEntryDate: "1990-06-15" };
    const a = generateEvents([m], ay, CUTOFF, "1990-01-01", "2027-12-31").filter(e => e.kind === "anniversary");
    expect(a.map(e => [e.date, e.types])).toEqual([["2016-01-06", ["service"]], ["2026-01-06", ["membership"]]]);
  });

  it("cutoff applies per base date", () => {
    const m = { ...mkMember("active"), firstEntryDate: "1990-01-05" }; // on/before cutoff → no +1
    const a = generateEvents([m], ay, CUTOFF, "2000-01-01", "2027-12-31").filter(e => e.types?.[0] === "service");
    expect(a[0].date).toBe("2015-01-06");
  });

  it("same date but different years or titles", () => {
    const ay2 = [{ kind: "service" as const, year: 25, title: "A" }, { kind: "membership" as const, year: 25, title: "B" }];
    const a = generateEvents([mkMember("active")], ay2, CUTOFF, "2025-01-01", "2027-12-31").filter(e => e.kind === "anniversary");
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe("A / B");
  });

  it("active: birthday + anniversary in range", () => {
    const evs = generateEvents([mkMember("active")], ay, CUTOFF, "2025-01-01", "2027-12-31");
    expect(evs.some(e => e.kind === "birthday")).toBe(true);
    expect(evs.some(e => e.kind === "anniversary")).toBe(true);
  });

  it("youth: birthday + anniversary in range", () => {
    const evs = generateEvents([mkMember("youth")], ay, CUTOFF, "2025-01-01", "2027-12-31");
    expect(evs.some(e => e.kind === "birthday")).toBe(true);
    expect(evs.some(e => e.kind === "anniversary")).toBe(true);
  });

  it("children: birthday + anniversary in range", () => {
    const evs = generateEvents([mkMember("children")], ay, CUTOFF, "2025-01-01", "2027-12-31");
    expect(evs.some(e => e.kind === "birthday")).toBe(true);
    expect(evs.some(e => e.kind === "anniversary")).toBe(true);
  });

  it("out-of-range events not included", () => {
    // ceremony year for entry Jun 15 = 2026, birthday Jun 15
    const evs = generateEvents([mkMember("active")], ay, CUTOFF, "2025-01-01", "2025-12-31");
    // anniversary in 2026 → not included; birthday in 2025 → included
    expect(evs.every(e => e.kind === "birthday")).toBe(true);
    expect(evs.some(e => e.date.startsWith("2025"))).toBe(true);
  });

  it("sorted by date then lastName", () => {
    const members = [
      { id: "1", firstName: "Anna", lastName: "Ziegler", birthDate: "1990-03-01", entryDate: "2000-01-01", status: "active" as const },
      { id: "2", firstName: "Bert", lastName: "Amann", birthDate: "1990-03-01", entryDate: "2000-01-01", status: "active" as const },
    ];
    const evs = generateEvents(members, [], CUTOFF, "2025-01-01", "2025-12-31");
    const birthdays = evs.filter(e => e.kind === "birthday");
    expect(birthdays[0].lastName).toBe("Amann");
    expect(birthdays[1].lastName).toBe("Ziegler");
  });
});

describe("generateEvents ceremony date", () => {
  const ay = [{ kind: "service" as const, year: 25, title: null }];
  const mk = (entryDate: string) => ({ id: "x", firstName: "A", lastName: "B", birthDate: "1950-03-03", entryDate, status: "active" as const });
  it.each([["2000-07-01", "2026-01-06"], ["1977-01-01", "2002-01-06"]])("entry %s → %s", (entry, expected) => {
    const a = generateEvents([mk(entry)], ay, CUTOFF, "1990-01-01", "2060-12-31").filter(e => e.kind === "anniversary");
    expect(a.map(e => e.date)).toEqual([expected]);
  });
});

describe("generateEvents refDate", () => {
  it("keeps entry day/month for display, date is ceremony", () => {
    const m = { id: "x", firstName: "A", lastName: "B", birthDate: "1950-03-03", entryDate: "2000-07-01", status: "active" as const };
    const [e] = generateEvents([m], [{ kind: "service", year: 25, title: null }], CUTOFF, "2026-01-01", "2026-12-31").filter(e => e.kind === "anniversary");
    expect([e.date, e.refDate]).toEqual(["2026-01-06", "2026-07-01"]);
    expect(e.date).toBe("2026-01-06");
  });
});

describe("anniversaryFilterLabel", () => {
  const ALL = ["service", "membership", "birthdays"];
  it.each([
    [ALL, [], 0, "Jubiläen & Geburtstage", "Alle Jubiläen und Geburtstage"],
    [ALL, ["10"], 0, "Runde Jubiläen & Geburtstage", "Alle runden Jubiläen und Geburtstage"],
    [["birthdays"], ["10"], 66, "Runde Geburtstage ab 66 J.", "Runde Geburtstage ab 66 Jahren"],
    [["service", "membership"], ["5"], 64, "Halbrunde Dienst-/Mitgliedsjubiläen ab 64 J.", "Halbrunde Dienst- und Mitgliedsjubiläen ab 64 Jahren"],
    [ALL, ["5", "10"], 64, "(Halb-)Runde Jubiläen & Geburtstage ab 64 J.", "Halbrunde und runde Jubiläen und Geburtstage ab 64 Jahren"],
    [["service"], [], 0, "Dienstjubiläen", "Alle Dienstjubiläen"],
    [["membership"], ["5", "10"], 0, "(Halb-)Runde Mitgliedsjubiläen", "Alle halbrunden und runden Mitgliedsjubiläen"],
    [["service", "birthdays"], [], 20, "Dienstjubiläen & Geburtstage ab 20 J.", "Dienstjubiläen und Geburtstage ab 20 Jahren"],
    [["membership", "birthdays"], ["5"], 0, "Halbrunde Mitgliedsjubiläen & Geburtstage", "Alle halbrunden Mitgliedsjubiläen und Geburtstage"],
  ])("%j %j %i", (kinds, mods, gte, short, long) => {
    expect(anniversaryFilterLabel(kinds, mods, gte)).toEqual({ short, long });
  });
});

describe("filterByYears", () => {
  const ev = [5, 7, 10, 15].map((years) => ({ years }) as any);
  const ys = (gte: number, mods: string[]) => filterByYears(ev, gte, mods).map((e) => e.years);
  it("no filter keeps all", () => expect(ys(0, [])).toEqual([5, 7, 10, 15]));
  it("half round excludes multiples of 10", () => expect(ys(0, ["5"])).toEqual([5, 15]));
  it("round", () => expect(ys(0, ["10"])).toEqual([10]));
  it("both mods combine", () => expect(ys(0, ["5", "10"])).toEqual([5, 10, 15]));
  it("gte applies on top", () => expect(ys(10, ["5", "10"])).toEqual([10, 15]));
});
