import { describe, expect, it } from "vitest";
import { courseColumns, parseTrainings, trainingKey } from "../lib/import.js";

const rows = [{ mID: 1, Gruppenführer: 44000, Leer: null, Text: "x", "AS-tauglich bis": 46000, "letzte G26": 45000, "CSA-tauglich bis": 47000, Zukunft: 60000 }];
const headers = ["mID", "Gruppenführer", "Leer", "Text", "AS-tauglich bis", "letzte G26", "CSA-tauglich bis", "Zukunft"];

describe("training import", () => {
  it("erkennt nur Spalten mit Datumswerten als Lehrgang", () => {
    expect(courseColumns(headers, rows)).toEqual(["Gruppenführer", "Zukunft"]);
  });
  it("mappt Lehrgänge und Tauglichkeiten, Zukunftsdatum → Warnung", () => {
    const { entries, warnings } = parseTrainings(rows[0], ["Gruppenführer", "Zukunft"], "2026-01-01");
    expect(entries.map((e) => e.title)).toEqual(["Gruppenführer", "Atemschutz-Tauglichkeit", "CSA-Tauglichkeit", "G26"]);
    expect(entries[1]).toMatchObject({ completedAt: "2023-03-15", expiresAt: "2025-12-09" });
    expect(warnings).toHaveLength(1);
  });
  it("Duplikatschlüssel ist case-insensitiv", () => {
    expect(trainingKey("a", { title: " X ", completedAt: "2020-01-01" })).toBe(trainingKey("a", { title: "x", completedAt: "2020-01-01" }));
  });
});
