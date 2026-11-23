// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

const DOM = `<main id="busy-main"><form id="f" method="post"><button id="s" type="submit" name="dir" value="up">x</button></form>
<form id="n" method="post" data-no-busy><button type="submit">n</button></form><a id="a" href="/x">l</a><a id="b" href="/y" target="_blank">b</a></main>
<div id="busy-overlay" hidden data-aborted="ab" data-error="er"><button id="busy-cancel" hidden></button></div><div id="busy-bar" hidden></div>`;
const submit = (id: string, prevent = false) => {
  const e = new Event("submit", { bubbles: true, cancelable: true });
  if (prevent) e.preventDefault();
  document.getElementById(id)!.dispatchEvent(e);
  return e;
};
const ov = () => document.getElementById("busy-overlay")!;

// Listener früherer Modul-Instanzen entfernen (document/window überleben resetModules)
const added: Array<[EventTarget, string, any]> = [];
for (const t of [document, document.body, window] as EventTarget[]) {
  const orig = t.addEventListener.bind(t);
  t.addEventListener = ((n: string, l: any, o?: any) => { added.push([t, n, l]); orig(n, l, o); }) as any;
}
beforeEach(async () => {
  added.splice(0).forEach(([t, n, l]) => t.removeEventListener(n, l));
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = DOM;
  (window as any).showToast = vi.fn();
  window.stop = vi.fn();
  await import("../browser/busy.js");
});

describe("busy", () => {
  it("overlay erst nach 300 ms, Button erst nach dem Submit gesperrt", () => {
    submit("f");
    expect((document.getElementById("s") as HTMLButtonElement).disabled).toBe(false);
    vi.advanceTimersByTime(1);
    expect((document.getElementById("s") as HTMLButtonElement).disabled).toBe(true);
    expect(ov().hidden).toBe(true);
    vi.advanceTimersByTime(300);
    expect(ov().hidden).toBe(false);
    expect(document.getElementById("busy-main")!.hasAttribute("inert")).toBe(true);
  });
  it("zweiter Submit wird verworfen", () => {
    submit("f");
    expect(submit("f").defaultPrevented).toBe(true);
  });
  it("abgebrochener Submit und data-no-busy lösen nichts aus", () => {
    submit("f", true); submit("n");
    vi.advanceTimersByTime(1000);
    expect(ov().hidden).toBe(true);
    expect(document.getElementById("f")!.dataset.busy).toBeUndefined();
  });
  it("Links: normal ja, target=_blank nein", () => {
    document.getElementById("b")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(400);
    expect(ov().hidden).toBe(true);
    document.getElementById("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(300);
    expect(ov().hidden).toBe(false);
  });
  it("Abbrechen nach 15 s gibt frei", () => {
    submit("f");
    vi.advanceTimersByTime(15000);
    const c = document.getElementById("busy-cancel") as HTMLButtonElement;
    expect(c.hidden).toBe(false);
    c.click();
    expect(ov().hidden).toBe(true);
    expect(window.stop).toHaveBeenCalled();
    expect(document.getElementById("f")!.dataset.busy).toBeUndefined();
    expect((document.getElementById("s") as HTMLButtonElement).disabled).toBe(false);
  });
  it("pageshow persisted setzt zurück", () => {
    submit("f");
    vi.advanceTimersByTime(300);
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(ov().hidden).toBe(true);
    expect(document.getElementById("f")!.dataset.busy).toBeUndefined();
  });
  it("htmx: Overlay mind. 400 ms, Debounce-Anfrage nur Balken", () => {
    const elt = document.createElement("button");
    const xhr = {} as XMLHttpRequest;
    const fire = (n: string, el: Element, x: XMLHttpRequest) => document.body.dispatchEvent(new CustomEvent(n, { detail: { elt: el, xhr: x } }));
    fire("htmx:beforeRequest", elt, xhr);
    vi.advanceTimersByTime(300);
    expect(ov().hidden).toBe(false);
    fire("htmx:afterRequest", elt, xhr);
    vi.advanceTimersByTime(399);
    expect(ov().hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ov().hidden).toBe(true);

    const s = document.createElement("input"); s.setAttribute("hx-trigger", "input changed delay:300ms");
    const x2 = {} as XMLHttpRequest;
    fire("htmx:beforeRequest", s, x2);
    expect(document.getElementById("busy-bar")!.hidden).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(ov().hidden).toBe(true);
    fire("htmx:afterRequest", s, x2);
    expect(document.getElementById("busy-bar")!.hidden).toBe(true);
  });
});
