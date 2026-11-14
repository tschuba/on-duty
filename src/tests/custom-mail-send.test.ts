import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.ORG_NAME = "Test";

let queue: any[][] = [];
const chain = (): any => { const c: any = { from: () => c, innerJoin: () => c, where: () => c, orderBy: () => c, then: (r: any, j: any) => Promise.resolve(queue.shift() ?? []).then(r, j) }; return c; };
vi.mock("../db/index.js", () => ({ db: { select: () => chain(), insert: () => ({ values: () => Promise.resolve() }) } }));
const sendMail = vi.fn(async (_o: any) => ({ sent: true }));
vi.mock("../lib/mail.js", () => ({ sendMail: (o: any) => sendMail(o) }));
vi.mock("../lib/mail-templates.js", () => ({ resolveTemplate: async () => ({ key: "plan", topic: "info" }) }));
vi.mock("../lib/events.js", () => ({ isActiveMember: () => true, findMembersByStatus: async () => ({}) }));

const { startCustomMail, isSending, countMails, salutation } = await import("../lib/custom-mail.js");
const { verifyLinkToken } = await import("../lib/links.js");
const row = (n: number, email: string) => ({ memberId: `m${n}`, personId: `p${n}`, firstName: `F${n}`, lastName: "L", email });
const sel = { statuses: [], roleIds: [], memberIds: [] };
const tokenOf = (url: string) => verifyLinkToken(url.split("/link/")[1])!;
const settle = async () => { for (let i = 0; i < 20 && isSending("plan"); i++) await new Promise((r) => setTimeout(r, 5)); };

beforeEach(() => { sendMail.mockClear(); });

describe("startCustomMail", () => {
  // Abfragen: members, Empfänger-Join, Abbestellungen
  const setup = (rows: any[]) => { queue = [[{ id: "m1" }, { id: "m2" }, { id: "m3" }], rows, []]; };

  it("sets a per-person unsubscribe link and header; address link for shared addresses", async () => {
    setup([row(1, "a@x.de"), row(2, "b@x.de"), row(3, "B@x.de")]);
    expect(await startCustomMail("plan", { ort: "Halle" }, sel, false)).toBe(3);
    await settle();
    const calls = sendMail.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    const single = calls.find((c) => c.to === "a@x.de")!, shared = calls.find((c) => c.to === "b@x.de")!;
    expect(tokenOf(single.vars.unsubscribeUrl)).toMatchObject({ p: "mail.optout", m: "m1", t: "info" });
    expect(single.headers["List-Unsubscribe"]).toBe(`<${single.vars.unsubscribeUrl}>`);
    expect(tokenOf(shared.vars.unsubscribeUrl)).toMatchObject({ p: "mail.optout-address", t: "info" });
    expect(shared.headers).toBeUndefined();
    expect(single.vars.ort).toBe("Halle");
    expect(single.vars).toMatchObject({ addressee: "F1", multiple: false, you: "dich" });
    expect(shared.vars).toMatchObject({ addressee: "F2, F3", multiple: true, you: "euch" });
  });

  it("urgent: no link, no header", async () => {
    setup([row(1, "a@x.de")]);
    await startCustomMail("plan", {}, sel, true);
    await settle();
    expect(sendMail.mock.calls[0][0]).toMatchObject({ vars: { unsubscribeUrl: "" }, headers: undefined });
  });

  it("returns none without recipients, and busy while running", async () => {
    setup([row(1, null as any)]);
    expect(await startCustomMail("plan", {}, sel, false)).toBe("none");
    setup([row(1, "a@x.de")]);
    const first = startCustomMail("plan", {}, sel, false);
    expect(await startCustomMail("plan", {}, sel, false)).toBe("busy");
    await first; await settle();
  });
});

describe("countMails", () => {
  it("counts people and one mail per address", () => {
    const r = (n: number, email: string, state = "send") => ({ ...row(n, email), state }) as any;
    expect(countMails([r(1, "a@x.de"), r(2, "b@x.de"), r(3, " B@x.de".trim()), r(4, "c@x.de", "opted-out")])).toEqual({ people: 3, mails: 2 });
  });
  it("builds the salutation", () => {
    expect(salutation([{ firstName: "Anna" }, { firstName: "Ben" }])).toEqual({ addressee: "Anna, Ben", multiple: true, you: "euch" });
  });
});
