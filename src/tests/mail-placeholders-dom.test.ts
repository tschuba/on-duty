// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

const DOM = `<script data-leave="Verlassen?" data-tip-if="Nur wenn vorhanden" data-tip-end="Ende des Blocks" data-ac-count="{n} Treffer" data-ac-none="Keine"></script>
<form id="tpl-form"><input name="subject"><textarea name="body"></textarea></form>
<button id="ph-toggle"></button><button id="ph-close"></button><div id="ph-backdrop"></div><div id="ph-resize"></div>
<div id="pane-edit"></div>
<div id="ph-col"><input id="ph-search">
<button data-side="ph" class="tab-active"></button><button data-side="tech"></button>
<script id="ph-data" type="application/json">[{"name":"lst","desc":"Liste","example":"","type":"list"}]</script><div id="side-ph"><section data-g><ul>
<li data-s="Café"><button data-ph="a.cafe"></button></li><li data-k="l[].nm" data-d="Listenname" data-e="Anna"><button data-ph="l[].nm"></button></li><li data-s="Name" data-k="a.name" data-d="Name" data-e="Max"><button data-ph="a.name"></button></li></ul></section>
<button data-cond="a.name"></button></div><div id="side-tech" class="hidden"></div><p id="ph-empty" class="hidden"></p></div>
<input type="radio" name="t" data-tab="edit" checked><input type="radio" name="t" data-tab="entry" class="tab"><input type="radio" name="t" data-tab="preview" data-case class="hidden">`;

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
  it("shows tooltip for caret in token; none for unknown, closes on Esc", () => {
    vi.useFakeTimers();
    const a = area(), tip = () => document.getElementById("ph-tip")!;
    a.focus(); a.value = "x{{a.name}}{{#a.name}}{{/a.name}}{{zz}}";
    a.dispatchEvent(new Event("input"));
    const at = (p: number) => { a.setSelectionRange(p, p); a.dispatchEvent(new Event("keyup")); vi.advanceTimersByTime(500); };
    at(4); expect(tip().textContent).toBe("NameMax"); expect(tip().getAttribute("role")).toBe("tooltip"); expect(a.getAttribute("aria-describedby")).toBe("ph-tip");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(tip().classList.contains("hidden")).toBe(true);
    at(14); expect(tip().textContent).toBe("Nur wenn vorhanden: Name");
    at(24); expect(tip().textContent).toBe("Ende des Blocks");
    at(38); expect(tip().classList.contains("hidden")).toBe(true);
    a.value = "{{nm}}"; a.dispatchEvent(new Event("input")); at(3); expect(tip().textContent).toBe("ListennameAnna"); // Platzhalter innerhalb einer Liste
    a.value = "{{#lst}}"; a.dispatchEvent(new Event("input")); at(4); expect(tip().textContent).toBe("Liste"); // Listen-Block: nur Erklärung
    a.value = "{{& a.name }}"; a.dispatchEvent(new Event("input")); at(5); expect(tip().textContent).toBe("NameMax"); // unescaped + Leerzeichen
    vi.useRealTimers();
  });
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
    expect(($("ph-toggle") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-tab=entry]")!.classList.contains("hidden")).toBe(true);
    expect(document.querySelector("[data-case]")!.classList.contains("hidden")).toBe(false);
    document.querySelector<HTMLElement>("[data-tab=edit]")!.click();
    expect(($("ph-toggle") as HTMLButtonElement).disabled).toBe(false);
  });
  it("warns on leave only when dirty", () => {
    const ev = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e; };
    expect(ev().defaultPrevented).toBe(false);
    const body = document.querySelector<HTMLTextAreaElement>("[name=body]")!, orig = body.value;
    body.value = orig + "x";
    $("tpl-form").dispatchEvent(new Event("input"));
    expect(ev().defaultPrevented).toBe(true);
    body.value = orig; // manuell zurück zum Original
    $("tpl-form").dispatchEvent(new Event("input"));
    expect(ev().defaultPrevented).toBe(false);
    body.value = orig + "x";
    $("tpl-form").dispatchEvent(new Event("input"));
    $("tpl-form").dispatchEvent(new Event("submit"));
    expect(ev().defaultPrevented).toBe(false);
  });
});

describe("placeholder highlight mirror", () => {
  const hl = () => [...document.querySelectorAll<HTMLElement>("[aria-hidden] [data-hl]")];
  const mir = () => area().previousElementSibling as HTMLElement;
  it("highlights placeholders and block tags only, escapes HTML, keeps incomplete tags as text", () => {
    type(area() as any, "a <b> {{x.y}} {{#c}}t{{/c}} {{^c}} {{unfertig");
    expect(hl().map((e) => [e.dataset.hl, e.textContent])).toEqual([["ph", "{{x.y}}"], ["block", "{{#c}}"], ["block", "{{/c}}"], ["block", "{{^c}}"]]);
    expect(mir().textContent).toBe(area().value);
    expect(mir().querySelector("b")).toBeNull();
    expect(mir().getAttribute("aria-hidden")).toBe("true");
  });
  it("follows scroll, insertion and subject field", () => {
    document.querySelector<HTMLElement>("[data-ph='a.name']")!.click();
    expect(hl()[0].textContent).toBe("{{a.name}}");
    area().scrollTop = 5; area().dispatchEvent(new Event("scroll"));
    expect(mir().scrollTop).toBe(area().scrollTop);
    const s = document.querySelector<HTMLInputElement>("[name=subject]")!;
    type(s, "Hi {{a.name}}");
    expect((s.previousElementSibling as HTMLElement).textContent).toBe("Hi {{a.name}}");
  });
  it("grows with the field (box follows the field)", () => {
    const a = area() as HTMLTextAreaElement;
    Object.defineProperty(a, "offsetHeight", { configurable: true, value: 321 });
    a.style.borderLeft = a.style.borderRight = "1px solid"; // jsdom liefert sonst keine Border-Breite
    Object.defineProperty(a, "clientWidth", { configurable: true, value: 400 });
    a.dispatchEvent(new Event("input"));
    expect(mir().style.height).toBe("321px");
    expect(mir().style.width).toBe("402px"); // clientWidth + Border
  });
  describe("autocomplete", () => {
    const menu = () => document.getElementById("ac-menu")!;
    const opts = () => [...menu().querySelectorAll("[role=option]")].map((o) => o.querySelector(".font-mono")!.textContent);
    const typeCh = (a: HTMLTextAreaElement, ch: string) => {
      const p = a.selectionStart!; a.value = a.value.slice(0, p) + ch + a.value.slice(a.selectionEnd!); a.setSelectionRange(p + 1, p + 1);
      a.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch }));
    };
    const key = (a: HTMLElement, k: string) => { const e = new KeyboardEvent("keydown", { key: k, cancelable: true }); a.dispatchEvent(e); return e; };
    it("opens on typed {{, filters, block mode, ARIA, live region", () => {
      const a = area(); a.focus();
      typeCh(a, "{"); expect(menu().classList.contains("hidden")).toBe(true);
      typeCh(a, "{");
      expect(menu().classList.contains("hidden")).toBe(false);
      expect(opts()).toEqual(["a.cafe", "l[].nm", "a.name"]);
      expect(a.getAttribute("role")).toBe("combobox"); expect(a.getAttribute("aria-expanded")).toBe("true");
      expect(a.getAttribute("aria-controls")).toBe("ac-menu"); expect(a.getAttribute("aria-activedescendant")).toBe("ac-o0");
      expect(menu().getAttribute("role")).toBe("listbox");
      expect(document.querySelector("[aria-live=polite]")!.textContent).toBe("3 Treffer");
      typeCh(a, "n"); expect(opts()).toEqual(["l[].nm", "a.name"]);
      a.value = ""; typeCh(a, "{"); typeCh(a, "{"); typeCh(a, "#");
      expect(opts()).toEqual(["a.name", "lst"]); // nur Blockfähiges
    });
    it("keys: arrows + Enter accept, no doubled }}, Esc closes, Enter without menu is untouched", () => {
      const a = area(); a.focus();
      a.value = "x}}"; a.setSelectionRange(1, 1); typeCh(a, "{"); typeCh(a, "{");
      key(a, "ArrowDown"); expect(a.getAttribute("aria-activedescendant")).toBe("ac-o1");
      expect(key(a, "Enter").defaultPrevented).toBe(true);
      expect(a.value).toBe("x{{l[].nm}}"); expect(menu().classList.contains("hidden")).toBe(true);
      expect(key(a, "Enter").defaultPrevented).toBe(false);
      a.value = ""; typeCh(a, "{"); typeCh(a, "{"); typeCh(a, "a"); key(a, "Tab"); expect(a.value).toBe("{{a.cafe}}");
      a.value = ""; typeCh(a, "{"); typeCh(a, "{"); key(a, "Escape"); expect(a.value).toBe("{{"); expect(menu().classList.contains("hidden")).toBe(true);
      typeCh(a, "a"); expect(menu().classList.contains("hidden")).toBe(false); // weiter tippen öffnet erneut
    });
    it("does not open on programmatic input or insert click", () => {
      const a = area(); a.value = "{{"; a.setSelectionRange(2, 2); a.dispatchEvent(new Event("input"));
      expect(menu().classList.contains("hidden")).toBe(true);
      document.querySelector<HTMLElement>("[data-ph='a.name']")!.click();
      expect(menu().classList.contains("hidden")).toBe(true);
    });
  });
});
