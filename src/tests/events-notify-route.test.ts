import { describe, it, expect, vi, beforeEach } from "vitest";
import { formBody } from "./test-utils.js";

process.env.ORG_NAME = "Test";
process.env.OIDC_APP_URL = "http://localhost:3000";
process.env.APP_TIMEZONE = "Europe/Berlin";

let found: any;
let smtp = true;
const updates: any[] = [];
const sendChangeMails = vi.fn();
let targets: any = { mode: "all", recipients: [] };
let recipients: any[] = [];
const sendable = (n: number, id = "m") => Array.from({ length: n }, (_, i) => ({ memberId: `${id}${i}`, personId: `p${id}${i}`, firstName: "F", lastName: `L${i}`, email: "a@x.de", state: "send" }));

vi.mock("../lib/settings.js", () => ({ getSettings: async () => ({ eventsPublicEnabled: "true" }), setSetting: vi.fn() }));
vi.mock("../lib/mail.js", () => ({ isSmtpConfigured: () => smtp }));
vi.mock("../lib/event-mail.js", async (orig) => ({
  ...(await orig<typeof import("../lib/event-mail.js")>()),
  eventMailRecipients: async () => recipients,
  mailRecipientsFor: async (ids: string[]) => recipients.filter((r) => ids.includes(r.memberId)),
  createdTargets: async () => targets,
  eventDelivery: async () => [],
  startEventMails: vi.fn(async () => true),
  sendChangeMails: (...a: unknown[]) => sendChangeMails(...a),
}));
const chain = (r: any[] = []): any => { const c: any = { from: () => c, innerJoin: () => c, where: () => c, orderBy: () => Promise.resolve(r), then: (f: any) => Promise.resolve(r).then(f) }; return c; };
vi.mock("../db/index.js", () => {
  const upd = { set: (v: any) => { updates.push(v); const w: any = { where: () => Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve([found]) }) }; return w; } };
  const tx = { insert: () => ({ values: () => Promise.resolve() }), update: () => upd, delete: () => ({ where: () => Promise.resolve() }), select: () => chain() };
  return { db: { query: { events: { findFirst: () => Promise.resolve(found) } }, select: () => chain(), update: () => upd, transaction: async (cb: any) => cb(tx) } };
});
vi.mock("../middleware/auth.js", async () => ({
  ...(await vi.importActual<any>("../middleware/auth.js")),
  requireAuth: () => async (c: any, next: any) => { c.set("user", { id: "u1", permissions: new Set(["events:manage"]), roleIds: new Set() }); await next(); },
}));

const { eventRoutes } = await import("../routes/events.js");

const future = (h: number) => new Date(Math.floor((Date.now() + 864e5 * 30 + h * 36e5) / 6e4) * 6e4);
const ev = (o: Record<string, unknown> = {}) => ({
  id: "e1", title: "Übung", location: "Halle", description: null, allDay: false, startsAt: future(0), endsAt: future(2), visibility: "loggedIn",
  rsvpEnabled: false, rsvpDeadline: null, maxParticipants: null, cancelledAt: null, latitude: null, longitude: null, tags: [], invitees: [], ...o,
});
const localInput = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }).format(d).replace(" ", "T");
const form = (e: any, o: Record<string, string> = {}) => ({ title: e.title, location: e.location ?? "", startsAt: localInput(e.startsAt), endsAt: localInput(e.endsAt), visibility: e.visibility, ...o });
const edit = (e: any, o: Record<string, string> = {}) => eventRoutes.request("/e1/edit", { method: "POST", body: formBody(form(e, o)) });

beforeEach(() => { smtp = true; updates.length = 0; sendChangeMails.mockClear(); recipients = sendable(2); targets = { mode: "all", recipients: [] }; found = ev(); });

describe("POST /events/:id/edit mail question", () => {
  it("asks before saving when the location changed, showing old → new", async () => {
    const res = await edit(found, { location: "Gerätehaus" });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("Ort: Halle → Gerätehaus");
    expect(body).toContain('name="notify" value="send"');
    expect(body).toContain('name="location" value="Gerätehaus"');
    expect(updates).toHaveLength(0);
  });
  it("asks when the end time or the RSVP deadline changed", async () => {
    expect(await (await edit(found, { endsAt: localInput(future(5)) })).text()).toContain("Zeit:");
    expect(await (await edit(found, { rsvpEnabled: "on", rsvpDeadline: localInput(future(-1)) })).text()).toContain("Anmeldefrist:");
  });
  it("never asks for title/description changes", async () => {
    const res = await edit(found, { title: "Neu", description: "x" });
    expect(res.status).toBe(302);
    expect(updates).toHaveLength(1);
    expect(sendChangeMails).not.toHaveBeenCalled();
  });
  it("saves and sends after notify=send, only saves after notify=skip", async () => {
    expect((await edit(found, { location: "G", notify: "send" })).status).toBe(302);
    expect(sendChangeMails).toHaveBeenCalledWith(found, { changes: [expect.stringContaining("Halle → G")], added: [] });
    sendChangeMails.mockClear();
    expect((await edit(found, { location: "G", notify: "skip" })).status).toBe(302);
    expect(updates).toHaveLength(2);
    expect(sendChangeMails).not.toHaveBeenCalled();
  });
  it("offers 'new invitee' mails only for members newly added", async () => {
    found = ev({ visibility: "members", invitees: [{ memberId: "m0" }] });
    recipients = sendable(2);
    const body = await (await eventRoutes.request("/e1/edit", { method: "POST", body: formBody({ ...form(found), memberIds: ["m0", "m1"] } as any) })).text();
    expect(body).toContain("Neu eingeladen");
    expect(body).not.toContain("Termin geändert");
    await eventRoutes.request("/e1/edit", { method: "POST", body: formBody({ ...form(found), memberIds: ["m0", "m1"], notify: "send" } as any) });
    expect(sendChangeMails).toHaveBeenCalledWith(found, { changes: [], added: ["m1"] });
  });
  it("never asks for a cancelled or already finished event", async () => {
    found = ev({ cancelledAt: new Date() });
    expect((await edit(found, { location: "G", notify: "send" })).status).toBe(302);
    expect((await edit(found, { location: "G" })).status).toBe(302);
    found = ev({ startsAt: new Date(Date.now() - 4e6), endsAt: new Date(Date.now() - 2e6) });
    expect((await edit(found, { location: "G" })).status).toBe(302);
    expect(sendChangeMails).not.toHaveBeenCalled();
    expect(updates).toHaveLength(3);
  });
  it("skips the question without SMTP", async () => {
    smtp = false;
    expect((await edit(found, { location: "G" })).status).toBe(302);
    expect(sendChangeMails).not.toHaveBeenCalled();
  });
});

describe("POST /events/:id/cancel|uncancel", () => {
  it("sends only on notify=send", async () => {
    await eventRoutes.request("/e1/cancel", { method: "POST", body: formBody({ notify: "send" }) });
    expect(sendChangeMails).toHaveBeenCalledWith(found, { cancel: "cancelled" });
    sendChangeMails.mockClear();
    await eventRoutes.request("/e1/uncancel", { method: "POST", body: formBody({ notify: "send" }) });
    expect(sendChangeMails).toHaveBeenCalledWith(found, { cancel: "uncancelled" });
    sendChangeMails.mockClear();
    await eventRoutes.request("/e1/cancel", { method: "POST", body: formBody({ notify: "skip" }) });
    expect(sendChangeMails).not.toHaveBeenCalled();
    expect(updates).toHaveLength(3);
  });
});

describe("GET /events/:id mail UI", () => {
  const page = async (q = "") => (await eventRoutes.request(`/e1${q}`)).text();
  it("shows the catch-up button when nobody was mailed yet", async () => {
    targets = { mode: "all", recipients: sendable(2) };
    expect(await page()).toContain("Mitglieder benachrichtigen");
  });
  it("labels it 'retry' when failed recipients exist", async () => {
    targets = { mode: "failed", recipients: sendable(1) };
    expect(await page()).toContain("Fehlgeschlagene erneut senden");
  });
  it("hides it when everything was sent, or the event is cancelled/over", async () => {
    targets = { mode: "failed", recipients: [] };
    expect(await page()).not.toContain("?notify=created");
    targets = { mode: "all", recipients: sendable(1) };
    found = ev({ cancelledAt: new Date() });
    expect(await page()).not.toContain("?notify=created");
    found = ev({ startsAt: new Date(Date.now() - 4e6), endsAt: new Date(Date.now() - 2e6) });
    expect(await page()).not.toContain("?notify=created");
  });
  it("opens the created-modal on ?notify=created, with 'Mail senden' focused", async () => {
    targets = { mode: "all", recipients: sendable(3) };
    const body = await page("?notify=created");
    expect(body).toContain("3 Mitglieder erhalten die Mail");
    expect(body).toMatch(/<button[^>]*autofocus[^>]*>Mail senden/);
  });
  it("adds the cancel modal only with SMTP", async () => {
    expect(await page()).toContain('id="cancel-dialog"');
    smtp = false;
    expect(await page()).not.toContain('id="cancel-dialog"');
  });
});
