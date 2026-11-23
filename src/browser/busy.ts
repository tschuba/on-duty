// Busy-Overlay (Warten auf Aktion) und Balken (nicht blockierende Anfragen), siehe Ticket 184.
export {};
const SHOW_MS = 300, MIN_MS = 400, CANCEL_MS = 15000;

const $ = (id: string) => document.getElementById(id);
const txt = (k: string) => $("busy-overlay")?.dataset[k] ?? "";
const toast = (m: string) => (window as unknown as { showToast?: (m: string, t: string) => void }).showToast?.(m, "error");

let cancels: Array<() => void> = [];
let showT: ReturnType<typeof setTimeout> | undefined, cancelT: typeof showT, hideT: typeof showT;
let shownAt = 0, focusId = "", bars = 0;
const locked = new Set<HTMLButtonElement>();
const forms = new Set<HTMLFormElement>();

const visible = () => $("busy-overlay")?.hidden === false;

function show() {
  const o = $("busy-overlay");
  if (!o) return;
  shownAt = Date.now();
  focusId = document.activeElement?.id ?? "";
  $("busy-main")?.toggleAttribute("inert", true);
  $("busy-main")?.setAttribute("aria-busy", "true");
  o.hidden = false;
}

function hide() {
  clearTimeout(showT); clearTimeout(cancelT); clearTimeout(hideT);
  // Reihenfolge: entsperren → inert weg → Fokus (ein gesperrter Button nimmt keinen Fokus an)
  locked.forEach((b) => (b.disabled = false)); locked.clear();
  forms.forEach((f) => delete f.dataset.busy); forms.clear();
  $("busy-main")?.toggleAttribute("inert", false);
  $("busy-main")?.removeAttribute("aria-busy");
  const o = $("busy-overlay"), c = $("busy-cancel");
  if (o) o.hidden = true;
  if (c) c.hidden = true;
  if (focusId) $(focusId)?.focus();
  focusId = "";
}

function reset() { cancels = []; hide(); }

function begin(cancel: () => void) {
  cancels.push(cancel);
  clearTimeout(hideT);
  if (cancels.length !== 1) return;
  clearTimeout(cancelT);
  cancelT = setTimeout(() => { const c = $("busy-cancel"); if (c) c.hidden = false; }, CANCEL_MS);
  if (!visible()) showT = setTimeout(show, SHOW_MS);
}

function end(cancel: () => void) {
  const i = cancels.indexOf(cancel);
  if (i >= 0) cancels.splice(i, 1);
  if (cancels.length) return;
  clearTimeout(showT); clearTimeout(cancelT);
  if (visible()) hideT = setTimeout(hide, Math.max(0, MIN_MS - (Date.now() - shownAt)));
  else hide();
}

const skip = (el: Element) => !!el.closest("[data-no-busy]");

// Formulare: Overlay + Doppelsubmit-Sperre (nur POST, nicht von htmx/confirm/Captcha abgebrochene)
document.addEventListener("submit", (e) => {
  const f = e.target as HTMLFormElement;
  if (f.dataset.busy) { e.preventDefault(); return; }
  if (e.defaultPrevented || skip(f)) return;
  const s = (e as SubmitEvent).submitter;
  const method = (s?.getAttribute("formmethod") ?? f.getAttribute("method") ?? "get").toLowerCase();
  const target = s?.getAttribute("formtarget") ?? f.target;
  if (method !== "post" || (target && target !== "_self")) return;
  f.dataset.busy = "1"; forms.add(f);
  // Erst nach dem Submit sperren: ein disabled-Button liefert name/value nicht mit
  setTimeout(() => {
    const btns = [...f.querySelectorAll<HTMLButtonElement>("button"), ...(f.id ? document.querySelectorAll<HTMLButtonElement>(`button[form="${f.id}"]`) : [])];
    btns.filter((b) => b.type === "submit" && !b.disabled).forEach((b) => { b.disabled = true; locked.add(b); });
  }, 0);
  begin(() => window.stop());
});

// Links: nur normale Klicks auf gleiche Origin
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || skip(a)) return;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download") || a.origin !== location.origin) return;
  if (a.hash && a.pathname + a.search === location.pathname + location.search) return;
  begin(() => window.stop());
});

// htmx: Overlay; Anfragen mit debounce (delay:) nur Balken
type Hx = CustomEvent<{ elt: Element; xhr: XMLHttpRequest }>;
const ends = new WeakMap<XMLHttpRequest, () => void>();
document.body.addEventListener("htmx:beforeRequest", (e) => {
  const { elt, xhr } = (e as Hx).detail;
  if (skip(elt)) return;
  if (elt.getAttribute("hx-trigger")?.includes("delay:")) { // Live-Suche/Preview: nur Balken
    bars++; const b = $("busy-bar"); if (b) b.hidden = false;
    ends.set(xhr, () => { if (--bars <= 0) { bars = 0; const x = $("busy-bar"); if (x) x.hidden = true; } });
  } else {
    const cancel = () => elt.dispatchEvent(new CustomEvent("htmx:abort"));
    begin(cancel);
    ends.set(xhr, () => end(cancel));
  }
});
document.body.addEventListener("htmx:afterRequest", (e) => {
  const xhr = (e as Hx).detail.xhr;
  ends.get(xhr)?.(); ends.delete(xhr);
});
["htmx:sendError", "htmx:timeout"].forEach((n) => document.body.addEventListener(n, () => toast(txt("error"))));

$("busy-cancel")?.addEventListener("click", () => {
  const c = cancels; reset();
  c.forEach((f) => f());
  toast(txt("aborted"));
});

// Zurück-Navigation (bfcache): Zustand zurücksetzen
window.addEventListener("pageshow", (e) => { if (e.persisted) reset(); });
