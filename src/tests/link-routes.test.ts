import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.ORG_NAME = "Test";

let queue: any[][] = [];
function chain(): any {
  const c: any = { from: () => c, where: () => c, then: (r: any, j: any) => Promise.resolve(queue.shift() ?? []).then(r, j) };
  return c;
}
vi.mock("../db/index.js", () => ({ db: { select: () => chain() } }));
vi.mock("../components/layout.js", () => ({ Layout: ({ children }: any) => children }));
vi.mock("../components/public-form.js", () => ({ PublicFooter: () => null, clientIp: () => "1.1.1.1" }));
const setRsvp = vi.fn();
const setOptOut = vi.fn(async () => true);
vi.mock("../lib/events.js", () => ({ invitedMembers: async () => ["m1"], isActiveMember: () => true, setRsvp: (...a: any[]) => setRsvp(...a) }));
vi.mock("../lib/event-mail.js", () => ({ setOptOut: (...a: any[]) => (setOptOut as any)(...a) }));

const { linkRoutes } = await import("../routes/links.js");
const { signLinkToken } = await import("../lib/links.js");
const post = (token: string) => linkRoutes.request(`/${token}`, { method: "POST" });

beforeEach(() => { queue = []; setRsvp.mockReset(); setOptOut.mockClear(); });

describe("link routes", () => {
  it("GET changes nothing", async () => {
    const res = await linkRoutes.request(`/${signLinkToken({ p: "mail.optout", m: "m1", t: "events" })}`);
    expect(res.status).toBe(200);
    expect(setOptOut).not.toHaveBeenCalled();
  });
  it("rejects a tampered token", async () => {
    expect((await post("abc.def")).status).toBe(404);
  });
  it("POST opt-out sets opt-out", async () => {
    expect((await post(signLinkToken({ p: "mail.optout", m: "m1", t: "events" }))).status).toBe(200);
    expect(setOptOut).toHaveBeenCalledWith("m1", "events", true, "person", "link");
  });
  it("POST opt-out-address uses address scope", async () => {
    await post(signLinkToken({ p: "mail.optout-address", m: "m1", t: "events" }));
    expect(setOptOut).toHaveBeenCalledWith("m1", "events", true, "address", "address-link");
  });
  it("RSVP success calls setRsvp as non-manager", async () => {
    queue = [[{ id: "e1", title: "Übung" }], [{ id: "m1" }]];
    setRsvp.mockResolvedValue("ok");
    const res = await post(signLinkToken({ p: "event.rsvp-yes", m: "m1", e: "e1" }));
    expect(res.status).toBe(200);
    expect(setRsvp).toHaveBeenCalledWith("e1", "m1", "yes", false);
  });
  it.each(["deadline", "full", "cancelled"])("RSVP lock %s shows reason with 422", async (lock) => {
    queue = [[{ id: "e1", title: "Übung" }], [{ id: "m1" }]];
    setRsvp.mockResolvedValue(lock);
    expect((await post(signLinkToken({ p: "event.rsvp-no", m: "m1", e: "e1" }))).status).toBe(422);
  });
});
