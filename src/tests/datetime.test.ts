import { describe, it, expect } from "vitest";
import { parseLocal, toLocalInput, zoneAbbr, allDayBounds, dayAfter } from "../lib/datetime.js";

const TZ = "Europe/Berlin";
describe("datetime", () => {
  it("Winter UTC+1, Sommer UTC+2", () => {
    expect(parseLocal("2026-01-15T18:00", TZ)!.toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(parseLocal("2026-07-15T18:00", TZ)!.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });
  it("Frühjahr: Lücke 02:30 am 29.03.2026 wird nach vorn geschoben", () => {
    expect(toLocalInput(parseLocal("2026-03-29T02:30", TZ)!, TZ)).toBe("2026-03-29T03:30");
  });
  it("Herbst: doppelte Stunde nimmt den ersten Zeitpunkt (MESZ)", () => {
    expect(parseLocal("2026-10-25T02:30", TZ)!.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("Roundtrip und Zonenkürzel", () => {
    expect(toLocalInput(parseLocal("2026-07-15T18:00", TZ)!, TZ)).toBe("2026-07-15T18:00");
    expect(zoneAbbr(parseLocal("2026-01-15T12:00", TZ)!, TZ)).toBe("MEZ");
    expect(zoneAbbr(parseLocal("2026-07-15T12:00", TZ)!, TZ)).toBe("MESZ");
  });
  it("ungültige Eingaben", () => {
    expect(parseLocal("2026-02-30T10:00", TZ)).toBeNull();
    expect(parseLocal("quatsch", TZ)).toBeNull();
    expect(parseLocal("2026-01-01T25:00", TZ)).toBeNull();
  });
  it("Ganztag und Tagesgrenze", () => {
    const b = allDayBounds("2026-03-28", "2026-03-29", TZ)!;
    expect(b.startsAt.toISOString()).toBe("2026-03-27T23:00:00.000Z");
    expect(b.endsAt.toISOString()).toBe("2026-03-29T21:59:00.000Z");
    expect(dayAfter("2026-03-28", TZ).toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });
});
