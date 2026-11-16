// Editorleiste im Mail-Vorlagen-Editor (Einfügen, Platzhalterliste, Suche, Tabs, Leave-Warnung).
import { slugify } from "../lib/slug.js";
import { parseHeaders } from "../lib/mail-headers.js";
const $ = (id: string) => document.getElementById(id) as HTMLElement;
type Field = HTMLInputElement | HTMLTextAreaElement;

const f = $("tpl-form") as HTMLFormElement;
const msg = document.querySelector<HTMLScriptElement>("script[data-leave]")?.dataset.leave ?? "";
// Geändert = Formularinhalt weicht vom Ausgangsstand ab (manuelles Zurückändern gilt als unverändert).
const snap = () => JSON.stringify([...new FormData(f)]);
const base = snap();
let dirty = false;
// Fallback ohne Fokus: Text (Hauptarbeitsfläche)
let last = f.elements.namedItem("body") as Field;
f.addEventListener("input", () => { dirty = snap() !== base; });
f.addEventListener("reset", () => { dirty = false; });
f.addEventListener("submit", () => { dirty = false; });
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = msg; } });
f.querySelectorAll<Field>("input,textarea").forEach((el) => el.addEventListener("focus", () => { last = el; }));

const pane = $("pane-edit");
const md = matchMedia("(min-width: 768px)");

// Gemeinsamer Einfüger. wrap: umschließt die Markierung; ohne Markierung steht `inner` zwischen den Tags, der Cursor dahinter.
export function insert(text: string, wrap?: { open: string; close: string; inner: string }) {
  const s = last.selectionStart ?? 0, e = last.selectionEnd ?? 0;
  if (!wrap) last.setRangeText(text, s, e, "end");
  else {
    const sel = last.value.slice(s, e), inner = sel || wrap.inner;
    last.setRangeText(wrap.open + inner + wrap.close, s, e, "end");
    const p = s + wrap.open.length + inner.length;
    last.setSelectionRange(p, p);
  }
  if (!md.matches) setPh(false);
  last.focus();
  last.dispatchEvent(new Event("input", { bubbles: true })); // zeichnet den Spiegel neu, setzt dirty
  last.dispatchEvent(new Event("change", { bubbles: true })); // aktualisiert die Pflichtplatzhalter-Leiste (hx-trigger=change)
}

document.querySelectorAll<HTMLElement>("[data-ph]").forEach((b) => b.addEventListener("click", () => insert(`{{${b.dataset.ph}}}`)));
document.querySelectorAll<HTMLElement>("[data-cond]").forEach((b) => b.addEventListener("click", () => {
  const k = b.dataset.cond!;
  insert("", { open: `{{#${k}}}`, close: `{{/${k}}}`, inner: "" });
}));

// Platzhalterliste: Popover (Esc, Klick daneben und Fokus-Rückgabe macht der Browser).
const pb = $("ph-btn") as HTMLButtonElement, pp = $("side-ph");
const setPh = (o: boolean) => { if (!o) pp.hidePopover?.(); };
pp.addEventListener("toggle", (e) => {
  const o = (e as ToggleEvent).newState === "open";
  pb.setAttribute("aria-expanded", String(o));
  if (o) $("ph-search").focus();
});

const se = $("ph-search") as HTMLInputElement;
const nf = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
se.addEventListener("input", () => {
  const q = nf(se.value.trim());
  let any = false;
  document.querySelectorAll<HTMLElement>("#side-ph section[data-g]").forEach((d) => {
    let n = 0;
    d.querySelectorAll<HTMLElement>("li[data-s]").forEach((li) => {
      const m = !q || nf(li.dataset.s!).includes(q);
      li.hidden = !m;
      if (m) n++;
    });
    d.hidden = n === 0;
    if (n) any = true;
  });
  $("ph-empty").classList.toggle("hidden", any);
});
se.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && se.value) { e.stopPropagation(); se.value = ""; se.dispatchEvent(new Event("input")); }
  if (e.key === "Enter") {
    e.preventDefault();
    const v = document.querySelectorAll<HTMLElement>("#side-ph li[data-s]:not([hidden]) [data-ph]");
    if (v.length === 1) v[0].click();
  }
});

// Radio-Tabs (daisyUI tabs-lift). „Vorschau“ (entry) springt zur zuletzt gewählten Variante und wird durch die Varianten-Tabs ersetzt.
const cs = document.querySelectorAll<HTMLElement>("[data-case]"), en = document.querySelector<HTMLElement>("[data-tab=entry]");
let lc = cs[0];
document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.addEventListener("change", () => {
  const k = b.dataset.tab;
  if (k === "entry") { lc.click(); return; }
  const p = k === "preview";
  if (p) lc = b;
  pb.disabled = p;
  if (en) { en.classList.toggle("hidden", p); cs.forEach((o) => o.classList.toggle("hidden", !p)); }
}));

// Höhe des Editor-Bereichs: füllt von seiner Oberkante bis zur Oberkante des Footers (nur Desktop).
function fit() {
  const top = pane.getBoundingClientRect().top;
  if (!md.matches) { pane.style.height = ""; return; }
  const main = pane.closest("main"), foot = document.querySelector("footer");
  // Reserve unter dem Bereich: Tab-Padding + Rahmen (17px), Seiten-Padding unten, Footer
  const below = 17 + (main ? parseFloat(getComputedStyle(main).paddingBottom) : 0) + (foot?.offsetHeight ?? 0);
  if (top > 0) pane.style.height = `${Math.max(320, innerHeight - top - below)}px`;
}
fit();
addEventListener("resize", fit);

// Platzhalter-Hervorhebung: deckungsgleicher Spiegel hinter Betreff/Text (Feld bleibt Input/Textarea, kein contenteditable).
// shortcut: Spiegel statt Chips; Chips/Rich-Text siehe 161. Der Spiegel dient später auch der Cursorposition (169).
const tok = (c: string) => `color-mix(in oklab, var(--color-${c}) `;
const MARK = ``;
const BG_PH = "rgba(59,130,246,.28)", BG_BLOCK = `${tok("secondary")}24%, transparent)`;
const PH = `${MARK}background:${BG_PH};border-radius:3px;color:color-mix(in oklab, #3b82f6 65%, var(--color-base-content));`;
const BLOCK = `${MARK}background:${BG_BLOCK};border-radius:3px;color:color-mix(in oklab, #8b5cf6 65%, var(--color-base-content));`;

// Wechselseitige Hervorhebung: Platzhalter-Name im Text <-> Eintrag in der Platzhalterliste.
const nameOf = (tok: string) => tok.replace(/^\{\{[#/^&]?\s*|\s*\}\}$/g, "");
function setHot(n: string) {
  document.querySelectorAll<HTMLElement>("[data-n]").forEach((o) => {
    const on = !!n && o.dataset.n === n;
    o.style.outline = on ? "2px solid var(--color-primary)" : "";
    o.style.background = on ? (o.dataset.hl === "block" ? "color-mix(in oklab, #8b5cf6 55%, transparent)" : "rgba(59,130,246,.6)") : o.dataset.hl === "block" ? BG_BLOCK : BG_PH;
  });
  document.querySelectorAll<HTMLElement>("#side-ph li[data-s]").forEach((li) => {
    const b = li.querySelector<HTMLElement>("[data-ph],[data-cond]");
    const on = !!n && (b?.dataset.ph ?? b?.dataset.cond) === n;
    li.style.outline = on ? "2px solid var(--color-primary)" : "";
    li.style.background = on ? "color-mix(in oklab, var(--color-primary) 25%, transparent)" : "";
    li.style.borderRadius = on ? "var(--radius-field, 0.25rem)" : "";
  });
}
// Tooltip (Klartextname + Beispielwert) für Platzhalter im Text; Texte stammen aus dem Script-Tag (i18n).
const ds = document.querySelector<HTMLScriptElement>("script[data-leave]")!.dataset;
const info = new Map<string, { d: string; e: string; l?: boolean }>();
// Listen (z. B. recipients) haben keinen Eintrag in der Platzhalterliste, stehen aber in #ph-data.
try { for (const v of JSON.parse($("ph-data")?.textContent ?? "[]")) info.set(v.name, { d: v.desc, e: v.example ?? "", l: v.type === "list" }); } catch { /* ohne Daten nur Platzhalterliste */ }
document.querySelectorAll<HTMLElement>("#side-ph li[data-k]").forEach((li) => info.set(li.dataset.k!, { d: li.dataset.d ?? "", e: li.dataset.e ?? "" }));
const tip = document.createElement("div");
tip.id = "ph-tip"; tip.setAttribute("role", "tooltip");
// daisyUI-Tooltip: ein unsichtbarer Wrapper deckt den Platzhalter ab, das Tooltip hängt an dessen Unterkante.
tip.className = "tooltip tooltip-open tooltip-bottom fixed z-50 hidden pointer-events-none";
document.body.append(tip);
let tipField: Field | null = null;
function hideTip() { tip.classList.add("hidden"); tipField?.removeAttribute("aria-describedby"); tipField = null; }
function showTip(span: HTMLElement | undefined, field: Field) {
  const raw = span?.textContent ?? "", n = span?.dataset.n ?? "", i = info.get(n) ?? info.get(`${[...info.keys()].find((k) => k.endsWith(`[].${n}`))}`);
  const parts = !span || !i ? [] : raw.startsWith("{{/") ? [ds.tipEnd!] : raw.startsWith("{{^") ? [] : raw.startsWith("{{#") && !i.l ? [`${ds.tipIf}: ${i.d}`] : [i.d, i.e];
  const [head, ex] = parts.filter(Boolean);
  if (!head) { hideTip(); return; }
  // Erklärung normal, Beispielwert darunter, abgesetzt: Monospace, gedämpft, mit Trennlinie.
  const c = document.createElement("div");
  c.className = "tooltip-content text-left";
  c.append(head);
  if (ex) { const e = document.createElement("div"); e.className = "mt-1 pt-1 border-t border-current/30 font-mono opacity-70"; e.textContent = ex; c.append(e); }
  tip.replaceChildren(c);
  const r = span!.getBoundingClientRect();
  tip.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  tip.classList.remove("hidden");
  field.setAttribute("aria-describedby", "ph-tip"); tipField = field;
}
addEventListener("scroll", hideTip, true);
addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); }, true);

const side0 = $("side-ph");
side0.addEventListener("mouseover", (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-s]"); const b = li?.querySelector<HTMLElement>("[data-ph],[data-cond]"); setHot(b?.dataset.ph ?? b?.dataset.cond ?? ""); });
side0.addEventListener("mouseleave", () => setHot(""));
side0.addEventListener("focusin", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ph],[data-cond]"); setHot(b?.dataset.ph ?? b?.dataset.cond ?? ""); });
side0.addEventListener("focusout", () => setHot(""));

export function mirror(field: Field) {
  const m = document.createElement("div");
  m.setAttribute("aria-hidden", "true");
  m.className = field.className;
  m.style.cssText = `display:block;position:absolute;overflow:hidden;pointer-events:none;z-index:0;background:transparent;border-color:transparent;box-shadow:none;white-space:${field instanceof HTMLTextAreaElement ? "pre-wrap;overflow-wrap:break-word" : "pre"}`;
  // Der Spiegel liegt im (relativ positionierten) floating-label direkt vor dem Feld.
  field.before(m);
  field.classList.add("relative", "bg-transparent");
  // Der Spiegel zeichnet den Text (farbig); das Feld zeigt nur noch Cursor und Auswahl.
  field.style.color = "transparent"; field.style.caretColor = "var(--color-base-content)";
  const draw = () => {
    const cs = getComputedStyle(field);
    // Spiegel exakt auf die Box des Felds legen; ein Scrollbar verengt dessen Textbreite (clientWidth).
    const bw = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    m.style.left = `${field.offsetLeft}px`;
    m.style.top = `${field.offsetTop}px`;
    // Input: Chrome meldet clientWidth um ~24px zu klein, daher offsetWidth; Textarea: clientWidth (Scrollbar).
    m.style.width = `${field instanceof HTMLInputElement ? field.offsetWidth : field.clientWidth + bw}px`;
    m.style.height = `${field.offsetHeight}px`;
    // Einzeiliges Feld: daisyUI zentriert den Text vertikal, der Spiegel tut es über line-height.
    if (field instanceof HTMLInputElement) { m.style.paddingTop = m.style.paddingBottom = "0"; m.style.lineHeight = `${field.clientHeight}px`; }
    m.replaceChildren();
    let i = 0;
    for (const x of field.value.matchAll(/\{\{[^}]*\}\}/g)) {
      m.append(field.value.slice(i, x.index));
      const s = document.createElement("span");
      s.textContent = x[0];
      s.dataset.hl = /^\{\{[#/^]/.test(x[0]) ? "block" : "ph";
      s.style.cssText = s.dataset.hl === "block" ? BLOCK : PH;
      s.dataset.n = nameOf(x[0]);
      m.append(s);
      i = x.index! + x[0].length;
    }
    m.append(field.value.slice(i));
    m.scrollTop = field.scrollTop;
    m.scrollLeft = field.scrollLeft;
  };
  // Das Feld fängt die Maus ab: Treffer gegen die Rechtecke der Spiegel-Spans prüfen.
  (field as HTMLElement).addEventListener("mousemove", (e: MouseEvent) => {
    const hit = [...m.querySelectorAll<HTMLElement>("span[data-n]")].find((o) => [...o.getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom));
    setHot(hit?.dataset.n ?? "");
    showTip(hit, field);
  });
  field.addEventListener("mouseleave", () => { setHot(""); hideTip(); });
  // Tastatur/Touch: Cursor im Token zeigt nach kurzer Verzögerung dasselbe Tooltip.
  let t: ReturnType<typeof setTimeout>;
  const caret = () => {
    clearTimeout(t); hideTip();
    if (document.activeElement !== field) return;
    const c = field.selectionStart ?? 0;
    let k = -1;
    [...field.value.matchAll(/\{\{[^}]*\}\}/g)].forEach((x, j) => { if (c >= x.index! && c <= x.index! + x[0].length) k = j; });
    if (k >= 0) t = setTimeout(() => showTip(m.querySelectorAll<HTMLElement>("span[data-n]")[k], field), 400);
  };
  field.addEventListener("keyup", caret);
  field.addEventListener("click", caret);
  field.addEventListener("blur", () => { clearTimeout(t); hideTip(); });
  field.addEventListener("input", () => { clearTimeout(t); hideTip(); });
  field.addEventListener("input", draw);
  field.addEventListener("scroll", draw);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(draw).observe(field);
  draw();
  return draw;
}
["subject", "body"].forEach((n) => mirror(f.elements.namedItem(n) as Field));

// Autovervollständigung bei „{{“ (nur bei getipptem Zeichen; Quelle: Platzhalterliste + Listen aus #ph-data).
type Ent = { n: string; s: string; d: string; v: boolean; blk: boolean };
const catalog = (): Ent[] => {
  const m = new Map<string, Ent>();
  document.querySelectorAll<HTMLElement>("#side-ph [data-ph],#side-ph [data-cond]").forEach((b) => {
    const n = (b.dataset.ph ?? b.dataset.cond)!, li = b.closest<HTMLElement>("li");
    const e = m.get(n) ?? { n, s: li?.dataset.s ?? n, d: li?.dataset.d ?? "", v: false, blk: false };
    if (b.dataset.cond) e.blk = true; else e.v = true;
    m.set(n, e);
  });
  info.forEach((i, n) => { if (i.l) m.set(n, { n, s: `${n} ${i.d}`, d: i.d, v: false, blk: true }); });
  return [...m.values()];
};
const menu = document.createElement("ul");
menu.id = "ac-menu"; menu.setAttribute("role", "listbox");
menu.className = "fixed z-50 hidden max-h-60 overflow-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg text-sm";
const live = document.createElement("div");
live.className = "sr-only"; live.setAttribute("aria-live", "polite");
document.body.append(menu, live);
menu.addEventListener("mousedown", (e) => e.preventDefault()); // Fokus bleibt im Feld
let acField: Field | null = null, acIdx = 0, acHits: Ent[] = [];
const TOKEN = /\{\{([#^]?)([^{}\s]*)$/;
const tokenAt = (x: Field) => TOKEN.exec(x.value.slice(0, x.selectionStart ?? 0));

function acClose() {
  if (!acField) return;
  menu.classList.add("hidden");
  for (const a of ["aria-activedescendant", "aria-controls"]) acField.removeAttribute(a);
  acField.setAttribute("aria-expanded", "false");
  acField = null;
}
function acPlace(x: Field) {
  const fr = x.getBoundingClientRect(), wide = x instanceof HTMLTextAreaElement && md.matches;
  let r: DOMRect = fr;
  if (x instanceof HTMLTextAreaElement) {
    // Cursorposition über den Spiegel (liegt direkt vor dem Feld).
    const mi = x.previousElementSibling as HTMLElement, w = document.createTreeWalker(mi, NodeFilter.SHOW_TEXT);
    let left = x.selectionStart ?? 0;
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      if (left <= n.length) {
        const g = document.createRange(); g.setStart(n, left); g.collapse(true);
        const q = g.getClientRects()[0];
        if (q && (q.width || q.height) && q.bottom > fr.top && q.top < fr.bottom) r = q; // sonst (aus dem Feld gescrollt): Feldrand
        break;
      }
      left -= n.length;
    }
  }
  menu.style.width = wide ? "18rem" : `${fr.width}px`;
  menu.style.left = `${Math.max(8, Math.min(wide ? r.left : fr.left, innerWidth - (wide ? 288 : fr.width) - 8))}px`;
  // Zu wenig Platz unter dem Feld: darüber öffnen, Höhe auf den verfügbaren Platz begrenzen.
  menu.style.maxHeight = "";
  const h = menu.offsetHeight, below = innerHeight - r.bottom - 12, above = r.top - 12;
  if (h > below && above > below) {
    const mh = Math.min(h, above);
    menu.style.maxHeight = `${mh}px`;
    menu.style.top = `${r.top - mh - 4}px`;
  } else {
    menu.style.maxHeight = `${Math.min(h, Math.max(below, 96))}px`;
    menu.style.top = `${r.bottom + 4}px`;
  }
}
function acRender(x: Field, q: string, blk: boolean) {
  const nq = nf(q);
  acHits = catalog().filter((e) => (blk ? e.blk : e.v) && nf(`${e.n} ${e.s}`).includes(nq));
  acIdx = Math.min(acIdx, Math.max(acHits.length - 1, 0));
  menu.replaceChildren(...(acHits.length ? acHits.map((e, i) => {
    const li = document.createElement("li");
    li.id = `ac-o${i}`; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === acIdx));
    li.className = `cursor-pointer rounded-field px-2 py-1 ${i === acIdx ? "bg-primary text-primary-content" : ""}`;
    const d = document.createElement("div"); d.textContent = e.d || e.n;
    const c = document.createElement("div"); c.className = "font-mono text-xs opacity-70 break-all"; c.textContent = e.n;
    li.append(d, c);
    li.addEventListener("click", () => acAccept(x, e));
    return li;
  }) : [Object.assign(document.createElement("li"), { textContent: ds.acNone, className: "px-2 py-1 opacity-70" })]));
  menu.querySelector(`#ac-o${acIdx}`)?.scrollIntoView?.({ block: "nearest" });
  acField = x;
  x.setAttribute("aria-expanded", "true"); x.setAttribute("aria-controls", "ac-menu");
  if (acHits.length) x.setAttribute("aria-activedescendant", `ac-o${acIdx}`); else x.removeAttribute("aria-activedescendant");
  menu.classList.remove("hidden");
  acPlace(x);
  live.textContent = acHits.length ? (ds.acCount ?? "").replace("{n}", String(acHits.length)) : ds.acNone ?? "";
}
function acAccept(x: Field, e: Ent) {
  const tk = tokenAt(x);
  if (!tk) return acClose();
  const c = x.selectionStart ?? 0, end = x.value.startsWith("}}", c) ? c + 2 : c;
  acClose();
  x.setRangeText(`{{${tk[1]}${e.n}}}`, c - tk[0].length, end, "end");
  x.focus();
  x.dispatchEvent(new Event("input", { bubbles: true })); // kein InputEvent: löst das Menü nicht erneut aus
  x.dispatchEvent(new Event("change", { bubbles: true }));
}
for (const n of ["subject", "body"]) {
  const x = f.elements.namedItem(n) as Field;
  x.setAttribute("role", "combobox"); x.setAttribute("aria-expanded", "false"); x.setAttribute("aria-autocomplete", "list");
  x.addEventListener("input", (e) => {
    const tk = tokenAt(x);
    const typed = e instanceof InputEvent && e.inputType === "insertText";
    if (!tk || (acField !== x && !typed)) { if (acField === x) acClose(); return; }
    if (acField !== x) { acIdx = 0; acClose(); }
    acRender(x, tk[2], tk[1] !== "");
  });
  x.addEventListener("keydown", ((e: KeyboardEvent) => {
    if (acField !== x) return;
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); acClose(); }
    else if ((k === "ArrowDown" || k === "ArrowUp") && acHits.length) {
      e.preventDefault();
      acIdx = (acIdx + (k === "ArrowDown" ? 1 : acHits.length - 1)) % acHits.length;
      const t = tokenAt(x)!; acRender(x, t[2], t[1] !== "");
    } else if ((k === "Enter" || k === "Tab") && acHits.length) { e.preventDefault(); acAccept(x, acHits[acIdx]); }
  }) as EventListener);
  x.addEventListener("click", acClose);
  x.addEventListener("blur", acClose);
}

// Freie Vorlagen: key folgt dem Namen, bis er von Hand geändert wird; Header-Regeln wie auf dem Server (gemeinsame Funktion).
const nameEl = f.elements.namedItem("name") as HTMLInputElement | null, keyEl = f.elements.namedItem("key") as HTMLInputElement | null;
if (nameEl && keyEl) {
  let manual = keyEl.value !== "" && keyEl.value !== slugify(nameEl.value);
  keyEl.addEventListener("input", () => { manual = true; });
  nameEl.addEventListener("input", () => { if (!manual) keyEl.value = slugify(nameEl.value); });
}
const hdrRows = document.getElementById("hdr-rows");
if (hdrRows) {
  // Zeilen (hn/hv) → Text „X-Name: Wert“ wie readCustom auf dem Server; leere Zeilen zählen nicht.
  const check = () => {
    const names = [...hdrRows.querySelectorAll<HTMLInputElement>("[name=hn]")];
    const text = names.map((n) => [n.value.trim(), (n.closest("[data-hrow]")?.querySelector<HTMLInputElement>("[name=hv]")?.value ?? "").trim()]).filter(([n, v]) => n || v).map(([n, v]) => `${n}: ${v}`).join("\n");
    const errs = parseHeaders(text).errors;
    names.forEach((n) => n.setCustomValidity(""));
    names[0]?.setCustomValidity(errs[0] ?? "");
    const out = document.getElementById("err-headers");
    if (out) out.textContent = errs.join(" ");
  };
  hdrRows.addEventListener("input", check);
  hdrRows.addEventListener("click", () => queueMicrotask(check)); // nach „Entfernen“
  check();
}

// Einstellungen (eingeklappt): fehlende/fehlerhafte Angaben bleiben als Badge sichtbar; beim Absenden-Versuch klappt der Bereich auf.
const meta = document.getElementById("tpl-meta") as HTMLDetailsElement | null;
if (meta) {
  let srv = meta.dataset.err === "1"; // Serverfehler gelten bis zur nächsten Eingabe
  const warn = $("tpl-meta-warn");
  const show = () => { warn.hidden = !(srv || meta.querySelector(":invalid")); };
  meta.addEventListener("input", () => { srv = false; show(); });
  meta.addEventListener("click", () => queueMicrotask(show)); // nach „Entfernen“ einer Header-Zeile
  meta.addEventListener("invalid", () => { meta.open = true; show(); }, true);
  show();
}
