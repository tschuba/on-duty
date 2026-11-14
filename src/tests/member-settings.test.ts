import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.ORG_NAME = "Test";

let queue: any[][] = [];
const logged: any[] = [];
function chain(): any {
  const c: any = { from: () => c, innerJoin: () => c, where: () => c, then: (r: any, j: any) => Promise.resolve(queue.shift() ?? []).then(r, j) };
  return c;
}
vi.mock("../db/index.js", () => ({ db: { select: () => chain(), insert: () => ({ values: (v: any) => { logged.push(v); return Promise.resolve(); } }) } }));
const sendMail = vi.fn(async (_o: any) => ({ sent: true }));
vi.mock("../lib/mail.js", () => ({ sendMail: (o: any) => sendMail(o) }));
vi.mock("../lib/mail-templates.js", () => ({ resolveTemplate: async () => ({ key: "member-settings-link" }), buildVars: (_k: string, rec: any) => rec }));
const setEnabled = vi.fn();
vi.mock("../lib/event-mail.js", () => ({ isOptedOut: async (id: string) => id === "p2", setEventMailsEnabled: (...a: any[]) => setEnabled(...a) }));

const { sendSettingsLink, loadSettings, saveSettings } = await import("../lib/member-settings.js");
const person = (n: number) => ({ memberId: `m${n}`, personId: `p${n}`, firstName: `F${n}`, lastName: "L" });

beforeEach(() => { queue = []; logged.length = 0; sendMail.mockClear(); setEnabled.mockClear(); });

describe("sendSettingsLink", () => {
  it("sends nothing for an unknown address", async () => {
    queue = [[]];
    await sendSettingsLink("x@x.de");
    expect(sendMail).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });
  it("sends one mail with a settings link and logs every person at the address", async () => {
    queue = [[person(1), person(2)]];
    await sendSettingsLink(" A@x.de ");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe("A@x.de");
    expect(sendMail.mock.calls[0][0].vars.settingsUrl).toContain("/link/");
    expect(logged.flat().map((l: any) => [l.personId, l.template, l.status])).toEqual([["p1", "member-settings-link", "sent"], ["p2", "member-settings-link", "sent"]]);
  });
});

describe("loadSettings / saveSettings", () => {
  it("maps opt-out to the switch for each person at the member's address", async () => {
    queue = [[{ email: "a@x.de" }], [person(1), person(2)]];
    expect((await loadSettings("m1")).map((p) => [p.personId, p.events])).toEqual([["p1", true], ["p2", false]]);
  });
  it("saves per person; unchecked means off; foreign ids are ignored", async () => {
    queue = [[{ email: "a@x.de" }], [person(1), person(2)]];
    await saveSettings("m1", ["p1", "p999"]);
    expect(setEnabled.mock.calls).toEqual([["p1", true, "settings"], ["p2", false, "settings"]]);
  });
});
