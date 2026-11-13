import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.ORG_NAME = "Test";

let queue: any[][] = [];
const logged: any[] = [];
function chain(): any {
  const c: any = { from: () => c, innerJoin: () => c, where: () => c, limit: () => c, then: (r: any, j: any) => Promise.resolve(queue.shift() ?? []).then(r, j) };
  return c;
}
vi.mock("../db/index.js", () => ({ db: { select: () => chain(), insert: () => ({ values: (v: any) => { logged.push(v); return Promise.resolve(); } }) } }));
const sendMail = vi.fn(async (_o: any) => ({ sent: true }));
vi.mock("../lib/mail.js", () => ({ sendMail: (o: any) => sendMail(o) }));
vi.mock("../lib/mail-templates.js", () => ({ resolveTemplate: async () => ({ key: "event-created" }), buildVars: (_k: string, rec: any, r: any[]) => ({ n: r.length, all: rec.optOutAllUrl }) }));
vi.mock("../lib/events.js", () => ({ invitedMembers: async () => ["m1", "m2", "m3", "m4"] }));

const { eventMailRecipients, sendEventMails, startEventMails } = await import("../lib/event-mail.js");
const future = new Date(Date.now() + 86400000);
const ev: any = { id: "e1", visibility: "loggedIn", endsAt: future };
const row = (n: number, email: string | null) => ({ memberId: `m${n}`, personId: `p${n}`, firstName: `F${n}`, lastName: "L", email });

beforeEach(() => { queue = []; logged.length = 0; sendMail.mockClear(); });

describe("eventMailRecipients", () => {
  it("classifies send / no-email / opted-out", async () => {
    queue = [[row(1, "a@x.de"), row(2, null), row(3, " "), row(4, "d@x.de")], [{ personId: "p4" }]];
    const r = await eventMailRecipients(ev);
    expect(r.map((x) => x.state)).toEqual(["send", "no-email", "no-email", "opted-out"]);
  });
  it("returns nobody for past events", async () => {
    expect(await eventMailRecipients({ ...ev, endsAt: new Date(Date.now() - 1000) })).toEqual([]);
  });
});

describe("sendEventMails", () => {
  it("bundles one mail per address, sets List-Unsubscribe only for single recipient, logs per person", async () => {
    queue = [[row(1, "Shared@x.de"), row(2, "shared@x.de "), row(3, "solo@x.de"), row(4, null)], []];
    await sendEventMails(ev);
    expect(sendMail).toHaveBeenCalledTimes(2);
    const [shared, solo] = sendMail.mock.calls.map((c) => c[0]);
    expect(shared.vars).toMatchObject({ n: 2 });
    expect(shared.vars.all).toContain("/link/");
    expect(shared.headers).toBeUndefined();
    expect(solo.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(logged.flat().map((l: any) => l.personId).sort()).toEqual(["p1", "p2", "p3"]);
    expect(logged.flat().every((l: any) => l.status === "sent" && l.eventId === "e1")).toBe(true);
  });
  it("logs failed when sending fails", async () => {
    queue = [[row(1, "a@x.de")], []];
    sendMail.mockResolvedValueOnce({ sent: false });
    await sendEventMails(ev);
    expect(logged.flat()[0].status).toBe("failed");
  });
});

describe("startEventMails", () => {
  it("refuses when already sent (mail_log)", async () => {
    queue = [[{ id: "l1" }]];
    expect(await startEventMails(ev)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("lets only one of two concurrent calls through", async () => {
    queue = [[], [], [row(1, "a@x.de")], []];
    const [a, b] = await Promise.all([startEventMails(ev), startEventMails(ev)]);
    expect([a, b].sort()).toEqual([false, true]);
  });
});
