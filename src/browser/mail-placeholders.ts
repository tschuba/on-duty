// Platzhalter-Spalte im Mail-Vorlagen-Editor (Einfügen, Spalte, Suche, Tabs, Leave-Warnung).
const $ = (id: string) => document.getElementById(id) as HTMLElement;
type Field = HTMLInputElement | HTMLTextAreaElement;

const f = $("tpl-form") as HTMLFormElement;
const msg = document.querySelector<HTMLScriptElement>("script[data-leave]")?.dataset.leave ?? "";
let dirty = false;
// Fallback ohne Fokus: Text (Hauptarbeitsfläche)
let last = f.elements.namedItem("body") as Field;
f.addEventListener("input", () => { dirty = true; });
f.addEventListener("submit", () => { dirty = false; });
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = msg; } });
f.querySelectorAll<Field>("input,textarea").forEach((el) => el.addEventListener("focus", () => { last = el; }));

const pg = $("ph-toggle") as HTMLButtonElement, cl = $("ph-close") as HTMLButtonElement, pane = $("pane-edit");
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
  dirty = true;
}

document.querySelectorAll<HTMLElement>("[data-ph]").forEach((b) => b.addEventListener("click", () => insert(`{{${b.dataset.ph}}}`)));
document.querySelectorAll<HTMLElement>("[data-cond]").forEach((b) => b.addEventListener("click", () => {
  const k = b.dataset.cond!;
  insert("", { open: `{{#${k}}}`, close: `{{/${k}}}`, inner: "" });
}));

function setPh(o: boolean, save?: boolean) {
  pane.dataset.open = String(o);
  pg.setAttribute("aria-expanded", String(o));
  cl.setAttribute("aria-expanded", String(o));
  if (!o) side("ph");
  if (save && md.matches) try { localStorage.setItem("mailPlaceholders", String(o)); } catch { /* privater Modus */ }
}
function shut() { setPh(false, true); (md.matches ? cl : pg).focus(); }
let sv: string | null = null;
try { sv = localStorage.getItem("mailPlaceholders"); } catch { /* privater Modus */ }
setPh(md.matches && sv !== "false");
pg.addEventListener("click", () => setPh(pane.dataset.open !== "true", true));
$("ph-backdrop").addEventListener("click", shut);
cl.addEventListener("click", () => { if (md.matches) setPh(pane.dataset.open !== "true", true); else shut(); });
$("ph-col").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } });

function side(n: string) {
  const t = n === "tech";
  $("side-ph").classList.toggle("hidden", t);
  $("side-tech").classList.toggle("hidden", !t);
  document.querySelectorAll<HTMLElement>("[data-side]").forEach((o) => o.classList.toggle("tab-active", o.dataset.side === n));
}
document.querySelectorAll<HTMLElement>("[data-side]").forEach((b) => b.addEventListener("click", () => side(b.dataset.side!)));

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
  pg.disabled = cl.disabled = p;
  if (en) { en.classList.toggle("hidden", p); cs.forEach((o) => o.classList.toggle("hidden", !p)); }
}));

// Breite der Platzhalter-Spalte per Ziehgriff (Desktop), gemerkt in localStorage.
const rz = $("ph-resize");
const setW = (w: number) => pane.style.setProperty("--ph-w", `${Math.min(Math.max(w, 256), pane.clientWidth * 0.6)}px`);
try { const w = localStorage.getItem("mailPlaceholdersWidth"); if (w) setW(+w); } catch { /* privater Modus */ }
rz.addEventListener("pointerdown", (e) => {
  rz.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => setW(pane.getBoundingClientRect().right - m.clientX);
  const up = () => {
    rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up);
    try { localStorage.setItem("mailPlaceholdersWidth", String(parseFloat(pane.style.getPropertyValue("--ph-w")))); } catch { /* privater Modus */ }
  };
  rz.addEventListener("pointermove", move); rz.addEventListener("pointerup", up);
});

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
