import { describe, it, expect } from "vitest";
import { normalizeEventTags } from "../lib/event-tags.js";
import { parseEventForm, validateEventForm } from "../lib/events.js";

const TZ = "Europe/Berlin";

describe("parseEventForm", () => {
  it("defaults visibility to loggedIn and dedupes tags/roles", () => {
    const v = parseEventForm({ title: " Übung ", tags: ["a", "a,b"], roleIds: ["r1", "r1"] });
    expect(v.visibility).toBe("loggedIn");
    expect(v.title).toBe("Übung");
    expect(v.tags).toEqual(["a", "b"]);
    expect(v.roleIds).toEqual(["r1"]);
  });
  it("accepts public/roles and allDay checkbox", () => {
    expect(parseEventForm({ visibility: "roles", allDay: "on" }).visibility).toBe("roles");
    expect(parseEventForm({ allDay: "on" }).allDay).toBe(true);
  });
});

describe("validateEventForm", () => {
  const base = { title: "Übung", location: "", description: "", allDay: false, startsAt: "2026-07-15T18:00", endsAt: "2026-07-15T20:00", visibility: "loggedIn" as const, tags: [], roleIds: [] };

  it("accepts a valid timed event", () => {
    const r = validateEventForm(base, TZ);
    expect("errors" in r).toBe(false);
  });
  it("rejects missing title", () => {
    const r = validateEventForm({ ...base, title: "" }, TZ);
    expect("errors" in r && r.errors.title).toBeTruthy();
  });
  it("rejects end before start", () => {
    const r = validateEventForm({ ...base, startsAt: "2026-07-15T20:00", endsAt: "2026-07-15T18:00" }, TZ);
    expect("errors" in r && r.errors.dates).toBeTruthy();
  });
  it("roles visibility requires at least one role", () => {
    const r = validateEventForm({ ...base, visibility: "roles", roleIds: [] }, TZ);
    expect("errors" in r && r.errors.roleIds).toBeTruthy();
  });
  it("allDay uses day bounds", () => {
    const r = validateEventForm({ ...base, allDay: true, startsAt: "2026-07-15", endsAt: "2026-07-16" }, TZ);
    expect("errors" in r).toBe(false);
    if (!("errors" in r)) {
      expect(r.startsAt.toISOString()).toBe("2026-07-14T22:00:00.000Z");
      expect(r.endsAt.toISOString()).toBe("2026-07-16T21:59:00.000Z");
    }
  });
});

it("normalizeEventTags maps labels to keys and dedupes", () => {
  expect(normalizeEventTags(["übung", "drill", "Pflichttermin", "Grillen"])).toEqual(["drill", "mandatory", "Grillen"]);
});
