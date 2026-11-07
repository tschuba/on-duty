import { describe, it, expect } from "vitest";
import { normalizeEventTags } from "../lib/event-tags.js";
import { parseEventForm, validateEventForm } from "../lib/events.js";

const TZ = "Europe/Berlin";

describe("parseEventForm", () => {
  it("defaults visibility to loggedIn and dedupes tags/members", () => {
    const v = parseEventForm({ title: " Übung ", tags: ["a", "a,b"], memberIds: ["m1", "m1"] });
    expect(v.visibility).toBe("loggedIn");
    expect(v.title).toBe("Übung");
    expect(v.tags).toEqual(["a", "b"]);
    expect(v.memberIds).toEqual(["m1"]);
  });
  it("accepts public/members and allDay checkbox", () => {
    expect(parseEventForm({ visibility: "members", allDay: "on" }).visibility).toBe("members");
    expect(parseEventForm({ allDay: "on" }).allDay).toBe(true);
  });
});

describe("validateEventForm", () => {
  const base = { title: "Übung", location: "", coordinates: "", description: "", allDay: false, startsAt: "2026-07-15T18:00", endsAt: "2026-07-15T20:00", visibility: "loggedIn" as const, tags: [], memberIds: [], rsvpEnabled: false, maxParticipants: "", rsvpDeadline: "" };

  it("accepts a valid timed event", () => {
    const r = validateEventForm(base, TZ);
    expect("errors" in r).toBe(false);
  });
  it("rejects malformed or out-of-range coordinates, accepts a valid pair", () => {
    for (const coordinates of ["junk", "48.1", "91, 11"]) {
      const r = validateEventForm({ ...base, coordinates }, TZ);
      expect("errors" in r && r.errors.coordinates).toBeTruthy();
    }
    expect("errors" in validateEventForm({ ...base, coordinates: "48.137154, 11.576124" }, TZ)).toBe(false);
  });
  it("validates RSVP limit and deadline only when enabled", () => {
    const on = { ...base, rsvpEnabled: true };
    for (const maxParticipants of ["0", "-1", "1.5", "abc"]) {
      const r = validateEventForm({ ...on, maxParticipants }, TZ);
      expect("errors" in r && r.errors.maxParticipants).toBeTruthy();
    }
    expect("errors" in validateEventForm({ ...base, maxParticipants: "0" }, TZ)).toBe(false);
    const late = validateEventForm({ ...on, rsvpDeadline: "2026-07-15T18:01" }, TZ);
    expect("errors" in late && late.errors.rsvpDeadline).toBeTruthy();
    const ok = validateEventForm({ ...on, maxParticipants: "20", rsvpDeadline: "2026-07-15T12:00" }, TZ);
    expect("errors" in ok).toBe(false);
    if (!("errors" in ok)) { expect(ok.maxParticipants).toBe(20); expect(ok.rsvpDeadline?.toISOString()).toBe("2026-07-15T10:00:00.000Z"); }
  });
  it("rejects missing title", () => {
    const r = validateEventForm({ ...base, title: "" }, TZ);
    expect("errors" in r && r.errors.title).toBeTruthy();
  });
  it("rejects end before start", () => {
    const r = validateEventForm({ ...base, startsAt: "2026-07-15T20:00", endsAt: "2026-07-15T18:00" }, TZ);
    expect("errors" in r && r.errors.dates).toBeTruthy();
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
