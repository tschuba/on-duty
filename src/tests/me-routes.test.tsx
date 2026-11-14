import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../components/layout.js", () => ({ Layout: ({ children }: any) => children }));
vi.mock("../components/public-form.js", () => ({ PublicFooter: () => null, clientIp: (c: any) => c.req.header("x-ip") ?? "1.1.1.1" }));
let smtp = true;
vi.mock("../lib/mail.js", () => ({ isSmtpConfigured: () => smtp }));
const send = vi.fn(async () => {});
vi.mock("../lib/member-settings.js", () => ({ sendSettingsLink: (...a: any[]) => (send as any)(...a) }));

const { meRoutes } = await import("../routes/me.js");
const post = (email: string, ip = "1.1.1.1") => meRoutes.request("/", { method: "POST", headers: { "x-ip": ip }, body: new URLSearchParams({ email }) });

beforeEach(() => { send.mockClear(); smtp = true; });

describe("/me", () => {
  it("answers identically and sends once per address", async () => {
    const a = await post("a@x.de"), b = await post("a@x.de");
    expect(a.status).toBe(200);
    expect(await a.text()).toBe(await b.text());
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rate-limits per IP", async () => {
    for (let i = 0; i < 5; i++) await post(`r${i}@x.de`, "9.9.9.9");
    expect((await post("r6@x.de", "9.9.9.9")).status).toBe(429);
  });
  it("without SMTP sends nothing and says so", async () => {
    smtp = false;
    expect(await (await post("n@x.de", "2.2.2.2")).text()).toContain("nicht konfiguriert");
    expect(send).not.toHaveBeenCalled();
  });
});
