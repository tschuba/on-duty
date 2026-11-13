import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.ORG_NAME = "Test";

let queue: any[][] = [];
const logged: any[] = [];
function chain(): any {
  const c: any = { from: () => c, innerJoin: () => c, where: () => c, limit: () => c, orderBy: () => c, then: (r: any, j: any) => Promise.resolve(queue.shift() ?? []).then(r, j) };
  return c;
}
const conflict = vi.fn();
vi.mock("../db/index.js", () => ({ db: { select: () => chain(), insert: () => ({ values: (v: any) => { logged.push(v); return Object.assign(Promise.resolve(), { onConflictDoUpdate: (o: any) => { conflict(o); return Promise.resolve(); } }); } }) } }));
const sendMail = vi.fn(async (_o: any) => ({ sent: true }));
vi.mock("../lib/mail.js", () => ({ sendMail: (o: any) => sendMail(o) }));
vi.mock("../lib/mail-templates.js", () => ({ resolveTemplate: async () => ({ key: "event-created" }), whenText: () => "W", buildVars: (_k: string, rec: any, r: any[]) => ({ n: r.length, all: rec.optOutAllUrl }) }));
vi.mock("../lib/events.js", () => ({ invitedMembers: async () => ["m1", "m2", "m3", "m4"], isActiveMember: (m: any) => !m.exitDate && !m.deathDate }));

const { eventMailRecipients, sendEventMails, startEventMails, eventChanges, createdTargets, eventDelivery, sendChangeMails, setEventMailsEnabled, infoMailRecipients, sendEventInfoMail } = await import("../lib/event-mail.js");
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
  it("refuses created when every latest entry is sent", async () => {
    queue = [[{ personId: "p1", status: "sent" }], [row(1, "a@x.de")]];
    expect(await startEventMails(ev)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("lets only one of two concurrent calls through", async () => {
    queue = [[], [row(1, "a@x.de")], [], [row(1, "a@x.de")], []];
    const [a, b] = await Promise.all([startEventMails(ev), startEventMails(ev)]);
    expect([a, b].sort()).toEqual([false, true]);
  });
});

describe("sendChangeMails", () => {
  it("sends changes to all but newly invited, and created to the newly invited", async () => {
    queue = [[row(1, "a@x.de"), row(2, "b@x.de")], [], [row(1, "a@x.de"), row(2, "b@x.de")], []];
    sendChangeMails(ev, { changes: ["Ort: A → B"], added: ["m2"] });
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(2));
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(["a@x.de", "b@x.de"]);
    expect(sendMail.mock.calls[0][0].key).toBe("event-updated");
    expect(sendMail.mock.calls[1][0].key).toBe("event-created");
  });
  it("sends cancelled to everyone", async () => {
    queue = [[row(1, "a@x.de")], []];
    sendChangeMails(ev, { cancel: "cancelled" });
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    expect(sendMail.mock.calls[0][0].key).toBe("event-cancelled");
  });
});

describe("eventChanges", () => {
  const base = { startsAt: new Date("2030-01-01T10:00:00Z"), endsAt: new Date("2030-01-01T12:00:00Z"), allDay: false, location: "Halle", rsvpDeadline: null };
  it("ignores unchanged", () => expect(eventChanges(base, { ...base }, "UTC")).toEqual([]));
  it("reports time, location and deadline", () => {
    const l = eventChanges(base, { ...base, endsAt: new Date("2030-01-01T13:00:00Z"), location: null, rsvpDeadline: new Date("2029-12-30T10:00:00Z") }, "UTC");
    expect(l).toHaveLength(3);
    expect(l[1]).toBe("Ort: Halle → keine");
  });
});

describe("createdTargets", () => {
  it("all when nothing logged", async () => {
    queue = [[], [row(1, "a@x.de")], []];
    const r = await createdTargets(ev);
    expect(r.mode).toBe("all");
    expect(r.recipients).toHaveLength(1);
  });
  it("only failed persons when logged", async () => {
    queue = [[{ personId: "p1", status: "sent" }, { personId: "p2", status: "failed" }, { personId: "p2", status: "failed" }], [row(1, "a@x.de"), row(2, "b@x.de")], []];
    const r = await createdTargets(ev);
    expect(r.mode).toBe("failed");
    expect(r.recipients.map((x) => x.personId)).toEqual(["p2"]);
  });
  it("nobody when all sent", async () => {
    queue = [[{ personId: "p1", status: "sent" }], [row(1, "a@x.de")], []];
    expect((await createdTargets(ev)).recipients).toEqual([]);
  });
});

describe("eventDelivery", () => {
  it("maps each reason", async () => {
    queue = [[{ personId: "p1", status: "failed" }, { personId: "p1", status: "sent" }, { personId: "p4", status: "failed" }], [row(1, "a@x.de"), row(2, null), row(3, "c@x.de"), row(4, "d@x.de"), row(5, "e@x.de")], [{ personId: "p3" }]];
    const r = await eventDelivery(ev, true);
    expect(r.map((x) => x.delivery)).toEqual(["sent", "no-email", "opted-out", "failed", "pending"]);
  });
  it("flags missing smtp", async () => {
    queue = [[], [row(1, "a@x.de")], []];
    expect((await eventDelivery(ev, false))[0].delivery).toBe("no-smtp");
  });
});

describe("setEventMailsEnabled", () => {
  it("writes opt-out with the given source when the value changes", async () => {
    queue = [[]]; // keine Zeile = nicht abbestellt
    await setEventMailsEnabled("p1", false, "account");
    expect(logged.flat()[0]).toMatchObject({ personId: "p1", topic: "events", optedOut: true, source: "account" });
  });
  it("re-enables (opted_out=false)", async () => {
    queue = [[{ o: true }]];
    await setEventMailsEnabled("p1", true, "admin");
    expect(logged.flat()[0]).toMatchObject({ optedOut: false, source: "admin" });
  });
  it("does nothing when unchanged", async () => {
    queue = [[{ o: true }]];
    await setEventMailsEnabled("p1", false, "admin");
    expect(logged).toHaveLength(0);
  });
});

describe("infoMailRecipients", () => {
  it("skips opted-out, no address and already sent", async () => {
    // members (active), persons+members join, opted-out, mail_log sent
    queue = [[{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5", exitDate: "2020-01-01" }], [row(1, "a@x.de"), row(2, "b@x.de"), row(3, null), row(4, "d@x.de")], [{ personId: "p4" }], [{ personId: "p2" }]];
    expect((await infoMailRecipients()).map((r) => r.memberId)).toEqual(["m1"]);
  });
});

describe("sendEventInfoMail", () => {
  const members = [{ id: "m1" }, { id: "m2" }];
  it("second run reaches only new members", async () => {
    queue = [members, [row(1, "a@x.de"), row(2, "b@x.de")], [], []];
    expect(await sendEventInfoMail()).toBe(2);
    await vi.waitFor(() => expect(logged.flat()).toHaveLength(2));
    const sent = logged.flat().map((l: any) => ({ personId: l.personId }));
    expect(logged.flat().every((l: any) => l.template === "event-mail-info" && l.status === "sent")).toBe(true);
    queue = [[...members, { id: "m3" }], [row(1, "a@x.de"), row(2, "b@x.de"), row(3, "c@x.de")], [], sent];
    expect(await sendEventInfoMail()).toBe(1);
  });
  it("returns 0 when nobody is left", async () => {
    queue = [members, [row(1, "a@x.de")], [], [{ personId: "p1" }]];
    expect(await sendEventInfoMail()).toBe(0);
  });
});
