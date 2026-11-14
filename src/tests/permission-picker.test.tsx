// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { PermissionPicker } from "../components/permission-picker.js";
import type { Permission } from "../lib/roles.js";

const OPTS = ["members:read", "members:write", "events:manage"] as Permission[];
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
const chips = () => [...document.querySelectorAll<HTMLInputElement>("input[type=hidden]")].map((i) => i.value);
const key = (k: string) => $(".pp-text").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const visible = () => [...document.querySelectorAll<HTMLElement>(".pp-panel li:not([hidden])")].map((l) => l.dataset.p);

beforeEach(() => {
  delete (window as any).__permPickerBound;
  document.body.replaceWith(document.body.cloneNode(false)); // Listener des Vortests loswerden
  document.body.innerHTML = String(<PermissionPicker name="editPermissions" options={OPTS} values={["members:read", "system:admin"]} />);
  new Function(document.querySelector("script")!.textContent!)(); // Skript läuft im Browser inline
});

describe("PermissionPicker", () => {
  it("renders chips only for offered values and hides them in the panel", () => {
    expect(chips()).toEqual(["members:read"]); // system:admin ist nicht vergebbar
    expect(visible()).not.toContain("members:read");
  });
  it("opens on focus, filters by typing, Enter takes the first hit", () => {
    $(".pp-text").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(($(".pp-panel") as HTMLElement).hidden).toBe(false);
    const i = $(".pp-text") as HTMLInputElement; i.value = "events"; i.dispatchEvent(new Event("input", { bubbles: true }));
    expect(visible()).toEqual(["events:manage"]);
    key("Enter");
    expect(chips()).toEqual(["members:read", "events:manage"]);
    expect(i.value).toBe("");
  });
  it("shows the empty hint without matches", () => {
    const i = $(".pp-text") as HTMLInputElement; i.value = "zzz"; i.dispatchEvent(new Event("input", { bubbles: true }));
    expect($(".pp-empty").classList.contains("hidden")).toBe(false);
  });
  it("Backspace on empty input and × remove chips; Escape closes; each pick signals a change", () => {
    let changed = 0; $(".pp-box").addEventListener("input", () => changed++);
    $(".pp-text").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    document.querySelector<HTMLElement>("[data-p='members:write']")!.click();
    expect(chips()).toEqual(["members:read", "members:write"]); expect(changed).toBe(1);
    key("Backspace"); expect(chips()).toEqual(["members:read"]);
    $(".pp-remove").click(); expect(chips()).toEqual([]);
    key("Escape"); expect(($(".pp-panel") as HTMLElement).hidden).toBe(true);
  });
});
