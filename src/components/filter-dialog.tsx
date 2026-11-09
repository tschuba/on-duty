import { Icon } from "./icon.js";
import type { FilterOption } from "./multi-select-filter.js";

type Base = { param: string; title: string; selected: string[]; defaults?: string[] };
// chips: Checkbox-Buttons (daisyUI `filter`); list: durchsuchbare Mehrfachliste; toggle: einzelnes Flag (Wert `value`, Standard "1");
// mehrere toggles mit gleichem `param` bilden zusammen eine Gruppe (je mit der vollen `selected`-Liste).
export type FilterSection =
  | (Base & { type: "chips"; options: FilterOption[] })
  | (Base & { type: "list"; options: FilterOption[]; compact?: boolean; unused?: { label: string; storageKey: string } })
  | (Base & { type: "toggle"; value?: string });
export type QuickFilter = { label: string; values: Record<string, string[]> };

type Props = {
  id: string;
  hidden: [string, string][];
  labels: { button: string; title: string; quick?: string; apply: string; close: string; reset: string; searchPlaceholder: string };
  sections: FilterSection[];
  quick?: QuickFilter[];
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

// Ein Dialog statt mehrerer Dropdowns: ein GET-Formular, "Anwenden" sendet alles auf einmal; Schnellfilter setzen Werte und senden sofort.
// Die Komponente kennt keine Fachbegriffe, Parameternamen kommen aus den Abschnitten.
export function FilterDialog({ id, hidden, labels, sections, quick = [] }: Props) {
  const active = new Set(sections.filter((s) => !sameSet(s.selected, s.defaults ?? [])).map((s) => s.param)).size;
  const formId = `${id}-form`;
  const def = Object.fromEntries(sections.map((s) => [s.param, s.defaults ?? []]));
  const lists = sections.filter((s) => s.type === "list");
  const unusedKeys = Object.fromEntries(lists.flatMap((s) => (s.type === "list" && s.unused ? [[s.param, s.unused.storageKey]] : [])));

  const chips = (s: FilterSection & { type: "chips" }) => (
    <fieldset>
      <legend class="sr-only">{s.title}</legend>
      <div class="filter gap-y-1">
        {s.options.map((o) => <input class="btn btn-sm" type="checkbox" name={s.param} value={o.value} aria-label={o.label} checked={s.selected.includes(o.value)} />)}
      </div>
    </fieldset>
  );
  const list = (s: FilterSection & { type: "list" }) => (
    <section data-fd-list={s.param}>
      <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">
        {s.title}
        <span class="badge badge-primary badge-sm" data-fd-count hidden={s.selected.length === 0}>{s.selected.length}</span>
      </h4>
      <label class="input flex items-center gap-2 w-full mb-2"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="text" placeholder={labels.searchPlaceholder} class="grow min-w-0" data-fd-search /></label>
      {s.unused && <label class="flex items-center gap-2 px-2 py-1 cursor-pointer text-xs opacity-60"><input type="checkbox" class="toggle toggle-xs" data-fd-unused />{s.unused.label}</label>}
      <ul class={`space-y-0.5 min-h-24 overflow-y-auto ${s.compact ? "max-h-40" : "max-h-[40dvh]"}`}>
        {s.options.map((o, i) => (
          <>
            {o.group && o.group !== s.options[i - 1]?.group && <li class="text-xs font-semibold opacity-60 px-2 pt-2" data-fd-group>{o.group}</li>}
            <li data-title={o.label.toLowerCase()} data-unused={o.unused && !s.selected.includes(o.value) ? "1" : undefined}>
              <label class={`flex items-center gap-2 px-2 py-1 pointer-coarse:min-h-11 rounded cursor-pointer hover:bg-base-200${o.dim ? " opacity-50" : ""}`}>
                <input type="checkbox" class="checkbox checkbox-sm" name={s.param} value={o.value} checked={s.selected.includes(o.value)} />
                <span class="text-sm flex-1">{o.label}</span>
                {o.hint && <span class="text-xs opacity-60">{o.hint}</span>}
              </label>
            </li>
          </>
        ))}
      </ul>
    </section>
  );
  const toggle = (s: FilterSection & { type: "toggle" }) => (
    <label class="flex items-center gap-2 cursor-pointer text-sm pointer-coarse:min-h-11">
      <input type="checkbox" class="toggle toggle-sm" name={s.param} value={s.value ?? "1"} checked={s.selected.includes(s.value ?? "1")} />{s.title}
    </label>
  );

  // Aufeinanderfolgende `chips` bilden eine Gruppe mit Trennlinie; direkt folgende `toggle` stehen in der Zeile der letzten Chips.
  const blocks: (FilterSection | FilterSection[])[] = [];
  for (const s of sections) {
    const last = blocks[blocks.length - 1];
    if (s.type === "list") blocks.push(s);
    else if (Array.isArray(last)) last.push(s);
    else blocks.push([s]);
  }
  const group = (b: FilterSection[]) => {
    const rows: FilterSection[][] = [];
    for (const s of b) {
      if (s.type === "chips") rows.push([s]);
      else if (rows.length) rows[rows.length - 1].push(s);
      else rows.push([s]);
    }
    return (
      <div class="flex flex-col">
        {rows.map((r, i) => (
          <>
            {i > 0 && <hr class="my-2 mx-auto w-1/2 border-base-content/30" />}
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2">{r.map((s) => (s.type === "chips" ? chips(s) : s.type === "toggle" ? toggle(s) : null))}</div>
          </>
        ))}
      </div>
    );
  };

  return (
    <>
      <button type="button" class={`btn ${active ? "btn-primary" : ""}`} aria-label={labels.button} title={labels.button} onclick={`document.getElementById('${id}').showModal()`}>
        <Icon name="funnel" class="h-5 w-5 shrink-0" />
        <span class="max-md:hidden">{labels.button}</span>
        {active > 0 && <span class="badge badge-sm">{active}</span>}
      </button>
      <dialog id={id} class="modal">
        <form id={formId} method="get" class="modal-box max-w-2xl flex flex-col max-h-[90dvh]">
          {hidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
          <h3 class="font-bold text-lg mb-4">{labels.title}</h3>
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-6">
          {quick.length > 0 && (
            <section class="bg-base-200 rounded-box p-3">
              <h4 class="font-semibold text-sm mb-2">{labels.quick}</h4>
              <div class="flex flex-wrap gap-1">
                {quick.map((f) => <button type="button" class="btn btn-sm btn-outline" data-fd-quick data-values={JSON.stringify(f.values)}>{f.label}</button>)}
              </div>
            </section>
          )}
          {blocks.map((b) => Array.isArray(b) ? group(b) : b.type === "list" ? list(b) : null)}
          </div>
          <div class="modal-action">
            <button type="button" class={`btn btn-ghost mr-auto${active ? "" : " invisible"}`} data-fd-reset aria-label={labels.reset} title={labels.reset}>
              <Icon name="arrow-uturn-left" class="h-5 w-5 shrink-0" /><span class="max-md:hidden">{labels.reset}</span>
            </button>
            <button type="button" class="btn" onclick="this.closest('dialog').close()">{labels.close}</button>
            <button type="submit" class="btn btn-primary">{labels.apply}</button>
          </div>
        </form>
        <form method="dialog" class="modal-backdrop"><button>{labels.close}</button></form>
      </dialog>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var dlg = document.getElementById(${JSON.stringify(id)}), f = document.getElementById(${JSON.stringify(formId)});
          var def = ${JSON.stringify(def)}, keys = ${JSON.stringify(unusedKeys)};
          var q = function(s, r) { return Array.from((r || f).querySelectorAll(s)); };
          var vals = function(n) { return q('input[name=' + n + ']').filter(function(c) { return c.checked; }).map(function(c) { return c.value; }); };
          var same = function(a, b) { return a.slice().sort().join() === b.slice().sort().join(); };
          var secs = q('[data-fd-list]');
          var unusedOf = function(s) { return s.querySelector('[data-fd-unused]'); };
          function loadUnused() { secs.forEach(function(s) { var u = unusedOf(s); if (u) try { u.checked = localStorage.getItem(keys[s.dataset.fdList]) === '1'; } catch (e) {} }); }
          function view(s) {
            var u = unusedOf(s), term = s.querySelector('[data-fd-search]').value.toLowerCase(), lis = q('li', s);
            lis.forEach(function(li) {
              if (!li.dataset.title) return;
              li.hidden = (!!li.dataset.unused && !(u && u.checked)) || li.dataset.title.indexOf(term) < 0;
            });
            lis.forEach(function(li, i) {
              if (!('fdGroup' in li.dataset)) return;
              var any = false;
              for (var j = i + 1; j < lis.length && !('fdGroup' in lis[j].dataset); j++) if (!lis[j].hidden) any = true;
              li.hidden = !any;
            });
          }
          function sync() {
            var dirty = Object.keys(def).some(function(n) { return !same(vals(n), def[n]); });
            f.querySelector('[data-fd-reset]').classList.toggle('invisible', !dirty);
            secs.forEach(function(s) {
              var n = vals(s.dataset.fdList).length, c = s.querySelector('[data-fd-count]');
              c.textContent = n; c.hidden = n === 0;
            });
            q('[data-fd-quick]').forEach(function(b) {
              var v = JSON.parse(b.dataset.values);
              b.classList.toggle('btn-primary', Object.keys(v).every(function(n) { return same(vals(n), v[n]); }));
            });
          }
          function set(n, v) { q('input[name=' + n + ']').forEach(function(c) { c.checked = v.indexOf(c.value) >= 0; }); }
          f.addEventListener('click', function(e) {
            var r = e.target.closest('[data-fd-reset]'), b = e.target.closest('[data-fd-quick]');
            if (r) { Object.keys(def).forEach(function(n) { set(n, def[n]); }); sync(); }
            if (b) { var v = JSON.parse(b.dataset.values); Object.keys(v).forEach(function(n) { set(n, v[n]); }); f.requestSubmit(); }
          });
          f.addEventListener('change', function(e) {
            var s = e.target.closest('[data-fd-list]');
            if (s && e.target === unusedOf(s)) { try { localStorage.setItem(keys[s.dataset.fdList], e.target.checked ? '1' : '0'); } catch (x) {} view(s); }
            sync();
          });
          secs.forEach(function(s) { s.querySelector('[data-fd-search]').addEventListener('input', function() { view(s); }); });
          // Schließen (Esc, Abbrechen, Backdrop) verwirft nicht angewendete Änderungen.
          dlg.addEventListener('close', function() { f.reset(); secs.forEach(function(s) { s.querySelector('[data-fd-search]').value = ''; }); loadUnused(); secs.forEach(view); sync(); });
          loadUnused(); secs.forEach(view); sync();
        })();
      ` }} />
    </>
  );
}
