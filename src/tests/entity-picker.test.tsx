// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { EntityPicker, PickerOptions } from "../components/entity-picker.js";

function mount() {
  document.body.innerHTML = `<form>${String(<EntityPicker id="pid" name="personId" searchUrl="/s" required />)}</form>`;
  document.querySelectorAll("script").forEach((s) => new Function(s.textContent!)());
  const input = document.querySelector<HTMLInputElement>(".picker-input")!;
  const ul = document.querySelector<HTMLElement>(".picker-list")!;
  ul.innerHTML = String(<PickerOptions options={[{ id: "1", name: "Anna" }, { id: "2", name: "Bob", sub: "Ort" }]} />);
  ul.hidden = false;
  [...ul.children].forEach((o, n) => { o.id = `o${n}`; });
  return { input, ul, hidden: document.getElementById("pid") as HTMLInputElement };
}
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("EntityPicker", () => {
  it("arrow + Enter selects, × clears", () => {
    const { input, hidden } = mount();
    key(input, "ArrowDown"); key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe("o1");
    key(input, "Enter");
    expect(hidden.value).toBe("2");
    expect(input.value).toBe("Bob");
    expect(input.readOnly).toBe(true);
    document.querySelector<HTMLElement>(".picker-clear")!.click();
    expect(hidden.value).toBe("");
    expect(input.readOnly).toBe(false);
  });
  it("Escape closes; required message until selected", () => {
    const { input, ul } = mount();
    expect(input.validationMessage).not.toBe("");
    key(input, "Escape");
    expect(ul.hidden).toBe(true);
  });
  it("escapes names in markup", () => {
    expect(String(<PickerOptions options={[{ id: "1", name: "<b>x</b>" }]} />)).not.toContain("<b>x");
  });
});
