// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

const DOM = `<script data-leave="Verlassen?"></script>
<form id="tpl-form"><input name="subject"><textarea name="body"></textarea></form>
<button id="ph-toggle"></button><button id="ph-close"></button><div id="ph-backdrop"></div>
<div id="pane-edit"></div><div id="pane-preview" class="hidden"></div>
<div id="ph-col"><input id="ph-search">
<button data-side="ph" class="tab-active"></button><button data-side="tech"></button>
<div id="side-ph"><section data-g><ul>
<li data-s="Café"><button data-ph="a.cafe"></button></li><li data-s="Name"><button data-ph="a.name"></button></li></ul></section>
<button data-cond="a.name"></button></div><div id="side-tech" class="hidden"></div><p id="ph-empty" class="hidden"></p></div>
<button data-tab="entry" class="hidden"></button><button data-tab="preview" data-case></button>`;

const $ = (id: string) => document.getElementById(id)!;
const area = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const type = (el: HTMLInputElement, v: string) => { el.value = v; el.dispatchEvent(new Event("input")); };

const add = window.addEventListener.bind(window);
const unload: EventListener[] = [];
beforeEach(async () => {
  unload.splice(0).forEach((l) => window.removeEventListener("beforeunload", l));
  window.addEventListener = ((t: string, l: any, o?: any) => { if (t === "beforeunload") unload.push(l); add(t, l, o); }) as any;
  vi.resetModules();
  document.body.innerHTML = DOM;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  localStorage.clear();
  await import("../browser/mail-placeholders.js");
});

describe("mail placeholders editor", () => {
  it("inserts placeholders and conditional blocks", () => {
    document.querySelector<HTMLElement>("[data-ph='a.name']")!.click();
    expect(area().value).toBe("{{a.name}}");
    document.querySelector<HTMLElement>("[data-cond]")!.click();
    expect(area().value).toBe("{{a.name}}{{#a.name}}{{/a.name}}");
    area().value = "xyz"; area().setSelectionRange(1, 2);
    document.querySelector<HTMLElement>("[data-cond]")!.click();
    expect(area().value).toBe("x{{#a.name}}y{{/a.name}}z");
  });
  it("inserts into last focused field", () => {
    const s = document.querySelector<HTMLInputElement>("[name=subject]")!;
    s.dispatchEvent(new Event("focus"));
    document.querySelector<HTMLElement>("[data-ph='a.name']")!.click();
    expect(s.value).toBe("{{a.name}}");
  });
  it("toggles/closes pane and remembers it", () => {
    expect($("pane-edit").dataset.open).toBe("true");
    $("ph-toggle").click();
    expect($("pane-edit").dataset.open).toBe("false");
    expect(localStorage.getItem("mailPlaceholders")).toBe("false");
    $("ph-toggle").click();
    expect($("pane-edit").dataset.open).toBe("true");
    $("ph-col").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect($("pane-edit").dataset.open).toBe("false");
  });
  it("mobile: starts closed, insert closes pane, close button shuts", () => {
    vi.resetModules();
    document.body.innerHTML = DOM;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    return import("../browser/mail-placeholders.js").then(() => {
      expect($("pane-edit").dataset.open).toBe("false");
      $("ph-toggle").click();
      expect($("pane-edit").dataset.open).toBe("true");
      document.querySelector<HTMLElement>("[data-ph='a.name']")!.click();
      expect($("pane-edit").dataset.open).toBe("false");
      $("ph-toggle").click(); $("ph-close").click();
      expect($("pane-edit").dataset.open).toBe("false");
    });
  });
  it("switches side tabs", () => {
    document.querySelector<HTMLElement>("[data-side=tech]")!.click();
    expect($("side-tech").classList.contains("hidden")).toBe(false);
    expect($("side-ph").classList.contains("hidden")).toBe(true);
  });
  it("searches accent-insensitively, Enter inserts single hit, Escape clears", () => {
    const se = $("ph-search") as HTMLInputElement;
    type(se, "cafe");
    expect(document.querySelectorAll("li[hidden]").length).toBe(1);
    se.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(area().value).toBe("{{a.cafe}}");
    type(se, "zzz");
    expect($("ph-empty").classList.contains("hidden")).toBe(false);
    se.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(se.value).toBe("");
    expect($("ph-empty").classList.contains("hidden")).toBe(true);
  });
  it("preview/entry tabs", () => {
    // Der Eintrags-Tab springt zur zuletzt gewählten Vorschau-Variante.
    document.querySelector<HTMLElement>("[data-tab=entry]")!.click();
    expect($("pane-edit").classList.contains("hidden")).toBe(true);
    expect(($("ph-toggle") as HTMLButtonElement).disabled).toBe(true);
  });
  it("warns on leave only when dirty", () => {
    const ev = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e; };
    expect(ev().defaultPrevented).toBe(false);
    $("tpl-form").dispatchEvent(new Event("input"));
    expect(ev().defaultPrevented).toBe(true);
    $("tpl-form").dispatchEvent(new Event("submit"));
    expect(ev().defaultPrevented).toBe(false);
  });
});
