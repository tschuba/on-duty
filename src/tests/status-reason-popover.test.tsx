import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { StatusReasonPopover, statusReasonText } from "../components/status-reason-popover.js";
import type { StatusReason } from "../lib/status.js";

const R: [any, StatusReason, string][] = [
  ["deceased", { kind: "deceased", date: "2023-02-02" }, "02.02.2023"],
  ["left", { kind: "left", date: "2023-01-01" }, "01.01.2023"],
  ["active", { kind: "runningRole", roleTitle: "Gruppenführer", age: 30 }, "Gruppenführer"],
  ["youth", { kind: "runningRole", roleTitle: "Jugendwart", age: 15 }, "15 Jahre"],
  ["passive", { kind: "passiveAtCutoff", roleTitle: "Kommandant", age: 70, cutoff: "2020-05-04", limit: 65 }, "04.05.2020"],
  ["supporting", { kind: "noOpenRole" }, "keine laufende Funktion"],
  ["supporting", { kind: "openRoleNotActive", roleTitle: "Kassier" }, "Kassier"],
  ["supporting", { kind: "noRoleAtCutoff", cutoff: "2020-05-04", limit: 65 }, "65. Geburtstag"],
];

describe("StatusReasonPopover", () => {
  it("Satz nennt Funktion/Datum und beginnt mit dem Status", () => {
    for (const [status, reason, needle] of R) expect(statusReasonText(status, reason)).toContain(needle);
    expect(statusReasonText("active", R[2][1])).not.toContain("Jahre");
    expect(statusReasonText("passive", R[4][1])).toMatch(/^Passiv, weil/);
  });

  it("rendert Button, Popover und Hilfe-Link mit vorhandenem Anker", async () => {
    const app = new Hono().get("/", (c) => c.html(<StatusReasonPopover status="supporting" reason={{ kind: "noOpenRole" }} />));
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/aria-controls="status-reason-\d+"/);
    expect(html).toContain('popover="manual"');
    expect(html).toContain('href="/help/members#case-1"');
  });
});
