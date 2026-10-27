import { describe, it, expect } from "vitest";
import { parseRequestValues, validateRequest } from "../lib/loan-request.js";

const now = new Date(2026, 5, 10, 12, 0);
const rules = { individualTracking: true, timesRequired: false, maxQuantity: 1 };
const ok = { firstName: "A", lastName: "B", email: "a@b.de", plannedFrom: "2026-06-12", plannedTo: "2026-06-13", message: "hi" };
const run = (o: Record<string, string> = {}, r = rules) => validateRequest(parseRequestValues({ ...ok, ...o }), r, now);

describe("validateRequest", () => {
  it("accepts a valid request", () => expect(run().errors).toEqual({}));
  it("requires message, names and contact", () => {
    const e = run({ message: "", firstName: "", lastName: "", email: "" }).errors;
    expect(Object.keys(e).sort()).toEqual(["contact", "firstName", "lastName", "message"]);
  });
  it("rejects bad email/phone", () => {
    expect(run({ email: "x" }).errors.contact).toBeDefined();
    expect(run({ email: "", phone: "12" }).errors.contact).toBeDefined();
    expect(run({ email: "", phone: "+49 9281 1234" }).errors.contact).toBeUndefined();
  });
  it("checks date bounds", () => {
    expect(run({ plannedFrom: "2026-06-09" }).errors.dates).toBeDefined();
    expect(run({ plannedTo: "2027-06-11" }).errors.dates).toBeDefined();
    expect(run({ plannedTo: "2027-06-10" }).errors.dates).toBeUndefined();
    expect(run({ plannedFrom: "2026-06-14" }).errors.dates).toBeDefined();
  });
  it("handles times: both-or-none, required, same-day order, past today", () => {
    expect(run({ plannedFromTime: "10:00" }).errors.times).toBeDefined();
    expect(run({}, { ...rules, timesRequired: true }).errors.times).toBeDefined();
    expect(run({ plannedTo: "2026-06-12", plannedFromTime: "10:00", plannedToTime: "10:00" }).errors.times).toBeDefined();
    expect(run({ plannedTo: "2026-06-12", plannedFromTime: "10:00", plannedToTime: "11:00" }).errors.times).toBeUndefined();
    expect(run({ plannedFrom: "2026-06-10", plannedFromTime: "11:00", plannedToTime: "13:00" }).errors.times).toBeDefined();
  });
  it("limits quantity", () => {
    const r = { individualTracking: false, timesRequired: false, maxQuantity: 3 };
    expect(run({ quantity: "3" }, r).quantity).toBe(3);
    expect(run({ quantity: "4" }, r).errors.quantity).toBeDefined();
    expect(run({ quantity: "5" }).quantity).toBe(1);
  });
});
