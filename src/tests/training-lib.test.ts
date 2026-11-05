import { describe, it, expect } from "vitest";
import { parseTrainingInput, trainingStatuses, sortTrainings, nextTrainingDir, parseTrainingSort } from "../lib/training.js";

const rec = (id: string, title: string, completedAt: string | null, expiresAt: string | null, memberId = "m1") => ({ id, memberId, title, completedAt, expiresAt });
const T = "2026-06-01";

describe("trainingStatuses", () => {
  it("classifies expiry", () => {
    const s = trainingStatuses([
      rec("a", "A", "2020-01-01", "2026-05-31"),
      rec("b", "B", "2020-01-01", "2026-06-01"),
      rec("c", "C", "2020-01-01", "2026-08-30"),
      rec("d", "D", "2020-01-01", "2026-08-31"),
      rec("e", "E", "2020-01-01", null),
    ], T);
    expect([...s.values()]).toEqual(["expired", "soon", "soon", "valid", "noExpiry"]);
  });
  it("marks older same-title record as replaced (case/trim-insensitive), same member only", () => {
    const s = trainingStatuses([
      rec("old", "Atemschutz", "2020-01-01", "2021-01-01"),
      rec("new", " atemschutz ", "2025-01-01", "2030-01-01"),
      rec("other", "Atemschutz", "2020-01-01", "2021-01-01", "m2"),
    ], T);
    expect(s.get("old")).toBe("replaced");
    expect(s.get("new")).toBe("valid");
    expect(s.get("other")).toBe("expired");
  });
  it("records without completedAt neither replace nor get replaced", () => {
    const s = trainingStatuses([rec("a", "X", null, "2020-01-01"), rec("b", "X", "2025-01-01", "2030-01-01")], T);
    expect(s.get("a")).toBe("expired");
    expect(s.get("b")).toBe("valid");
  });
});

describe("parseTrainingInput", () => {
  const ok = { title: " Truppmann ", completedAt: "2026-01-01" };
  it("accepts and trims", () => {
    expect(parseTrainingInput(ok, T)).toEqual({ value: { title: "Truppmann", completedAt: "2026-01-01", expiresAt: null, organizer: null, notes: null } });
  });
  it("rejects invalid input", () => {
    expect(parseTrainingInput({ ...ok, title: " " }, T)).toEqual({ error: "title" });
    expect(parseTrainingInput({ title: "x" }, T)).toEqual({ error: "dates" });
    expect(parseTrainingInput({ ...ok, completedAt: "2026-13-40" }, T)).toEqual({ error: "date" });
    expect(parseTrainingInput({ ...ok, completedAt: "2026-06-02" }, T)).toEqual({ error: "future" });
    expect(parseTrainingInput({ ...ok, expiresAt: "2025-12-31" }, T)).toEqual({ error: "order" });
    expect(parseTrainingInput({ title: "x", expiresAt: "2030-01-01" }, T)).toHaveProperty("value");
  });
});

describe("sortTrainings", () => {
  const f = (x: { t: string; c: string | null; e: string | null }) => ({ member: null, title: x.t, completedAt: x.c, expiresAt: x.e, organizer: null });
  const rows = [
    { t: "B", c: "2020-01-01", e: null },
    { t: "A", c: "2021-01-01", e: "2025-01-01" },
    { t: "C", c: "2022-01-01", e: "2026-01-01" },
    { t: "D", c: "2021-01-01", e: "2025-01-01" },
  ];
  it("defaults to expiry desc, completion desc, title; empty last", () => {
    expect(sortTrainings(rows, f).map((x) => x.t)).toEqual(["C", "A", "D", "B"]);
  });
  it("sorts by chosen column and keeps empty values last in both directions", () => {
    expect(sortTrainings(rows, f, "expiresAt", "asc").map((x) => x.t)).toEqual(["A", "D", "C", "B"]);
    expect(sortTrainings(rows, f, "title", "desc").map((x) => x.t)).toEqual(["D", "C", "B", "A"]);
  });
  it("toggles direction", () => {
    expect(nextTrainingDir("title", "title", "asc")).toBe("desc");
    expect(nextTrainingDir("expiresAt", "title", "asc")).toBe("desc");
    expect(parseTrainingSort("nope")).toBeUndefined();
  });
});
