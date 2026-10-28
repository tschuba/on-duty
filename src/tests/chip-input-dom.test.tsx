// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { ChipInput } from "../components/chip-input.js";

function mount(extra = "") {
  document.body.innerHTML = `<form><script type="application/json" id="sg">["Übung","Atemschutz"]</script>${String(
    <ChipInput name="tags" label="T" splitOnComma caseSensitive={false} suggestionsFrom="#sg" />)}${extra}</form>`;
  document.querySelectorAll("script").forEach((s) => { if (s.type !== "application/json") new Function(s.textContent!)(); });
  const input = document.querySelector<HTMLInputElement>(".chip-text")!;
  return input;
}
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const chips = () => [...document.querySelectorAll("[data-chip]")].map((c) => (c as HTMLElement).dataset.chip);

describe("ChipInput suggestions", () => {
  it("arrow + Enter picks the suggestion, not the typed text", () => {
    const input = mount();
    input.focus(); input.value = "üb";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    key(input, "Enter");
    expect(chips()).toEqual(["Übung"]);
  });
  it("Escape closes; Enter then commits typed text with canonical case", () => {
    const input = mount();
    input.value = "übung";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    key(input, "Escape");
    expect(document.querySelector<HTMLElement>(".chip-list")!.hidden).toBe(true);
    key(input, "Enter");
    expect(chips()).toEqual(["Übung"]);
  });
});

describe("ChipInput presets", () => {
  const presets = [{ key: "drill", label: "Übung", badge: "badge-info" }];
  const mountP = () => {
    document.body.innerHTML = `<form>${String(<ChipInput name="tags" label="T" splitOnComma caseSensitive={false} presets={presets} />)}</form>`;
    document.querySelectorAll("script").forEach((s) => { new Function(s.textContent!)(); });
    return document.querySelector<HTMLInputElement>(".chip-text")!;
  };
  const btn = () => document.querySelector<HTMLElement>(".chip-preset")!;
  const values = () => [...document.querySelectorAll<HTMLInputElement>("input[name=tags]")].map((i) => i.value);
  it("button adds the key, hides itself, returns after removal", () => {
    mountP();
    btn().click();
    expect(values()).toEqual(["drill"]);
    expect(btn().hidden).toBe(true);
    document.querySelector<HTMLElement>(".chip-remove")!.click();
    expect(values()).toEqual([]);
    expect(btn().hidden).toBe(false);
  });
  it("typing the label maps to the preset, no duplicate", () => {
    const input = mountP();
    btn().click();
    input.value = "übung"; key(input, "Enter");
    expect(values()).toEqual(["drill"]);
  });
  it("typing the label first hides the button", () => {
    const input = mountP();
    input.value = "ÜBUNG"; key(input, "Enter");
    expect(values()).toEqual(["drill"]);
    expect(btn().hidden).toBe(true);
  });
});
