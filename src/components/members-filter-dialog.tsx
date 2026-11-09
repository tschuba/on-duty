import { Icon } from "./icon.js";
import type { FilterOption } from "./multi-select-filter.js";

export type QuickFilter = { label: string; status: string[]; age: string[] };

type Props = {
  id: string;
  hidden: [string, string][];
  labels: { button: string; title: string; quick: string; apply: string; close: string; reset: string; searchPlaceholder: string; unusedRoles: string; status: string; age: string; role: string };
  quick: QuickFilter[];
  status: { options: FilterOption[]; selected: string[]; defaults: string[] };
  age: { options: FilterOption[]; selected: string[] };
  role: { options: FilterOption[]; selected: string[]; storageKey: string };
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

// Ein Dialog statt drei Dropdowns: Status/Alter als daisyUI-`filter` (Checkbox-Buttons), Funktion als durchsuchbare Liste.
// Ein GET-Formular, "Anwenden" sendet alles auf einmal; Schnellfilter setzen Status + Alter und senden sofort.
export function MembersFilterDialog({ id, hidden, labels, quick, status, age, role }: Props) {
  const active = [!sameSet(status.selected, status.defaults), age.selected.length > 0, role.selected.length > 0].filter(Boolean).length;
  const formId = `${id}-form`;
  const section = (param: "status" | "age", title: string, options: FilterOption[], selected: string[]) => (
    <fieldset>
      <legend class="sr-only">{title}</legend>
      <div class="filter gap-y-1">
        {options.map((o) => <input class="btn btn-sm" type="checkbox" name={param} value={o.value} aria-label={o.label} checked={selected.includes(o.value)} />)}
      </div>
    </fieldset>
  );

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
          <section class="bg-base-200 rounded-box p-3">
            <h4 class="font-semibold text-sm mb-2">{labels.quick}</h4>
            <div class="flex flex-wrap gap-1">
              {quick.map((f) => <button type="button" class="btn btn-sm btn-outline" data-fd-quick data-status={JSON.stringify(f.status)} data-age={JSON.stringify(f.age)}>{f.label}</button>)}
            </div>
          </section>
          <div class="flex flex-col">
            {section("status", labels.status, status.options, status.selected)}
            <hr class="my-2 mx-auto w-1/2 border-base-content/30" />
            {section("age", labels.age, age.options, age.selected)}
          </div>
          <section>
            <h4 class="font-semibold text-sm mb-2 flex items-center gap-2">
              {labels.role}
              <span class="badge badge-primary badge-sm" data-fd-count hidden={role.selected.length === 0}>{role.selected.length}</span>
            </h4>
            <label class="input flex items-center gap-2 w-full mb-2"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="text" placeholder={labels.searchPlaceholder} class="grow min-w-0" data-fd-search /></label>
            <label class="flex items-center gap-2 px-2 py-1 cursor-pointer text-xs opacity-60"><input type="checkbox" class="toggle toggle-xs" data-fd-unused />{labels.unusedRoles}</label>
            <ul class="space-y-0.5 min-h-24 max-h-[40dvh] overflow-y-auto">
              {role.options.map((o, i) => (
                <>
                  {o.group && o.group !== role.options[i - 1]?.group && <li class="text-xs font-semibold opacity-60 px-2 pt-2" data-fd-group>{o.group}</li>}
                  <li data-title={o.label.toLowerCase()} data-unused={o.unused && !role.selected.includes(o.value) ? "1" : undefined}>
                    <label class={`flex items-center gap-2 px-2 py-1 pointer-coarse:min-h-11 rounded cursor-pointer hover:bg-base-200${o.dim ? " opacity-50" : ""}`}>
                      <input type="checkbox" class="checkbox checkbox-sm" name="role" value={o.value} checked={role.selected.includes(o.value)} />
                      <span class="text-sm flex-1">{o.label}</span>
                      {o.hint && <span class="text-xs opacity-60">{o.hint}</span>}
                    </label>
                  </li>
                </>
              ))}
            </ul>
          </section>
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
          var def = { status: ${JSON.stringify(status.defaults)}, age: [], role: [] };
          var key = ${JSON.stringify(role.storageKey)};
          var q = function(s) { return Array.from(f.querySelectorAll(s)); };
          var vals = function(n) { return q('input[name=' + n + ']').filter(function(c) { return c.checked; }).map(function(c) { return c.value; }); };
          var same = function(a, b) { return a.slice().sort().join() === b.slice().sort().join(); };
          var unused = f.querySelector('[data-fd-unused]'), search = f.querySelector('[data-fd-search]');
          var loadUnused = function() { try { unused.checked = localStorage.getItem(key) === '1'; } catch (e) {} };
          function view() {
            var term = search.value.toLowerCase(), lis = q('li');
            lis.forEach(function(li) {
              if (!li.dataset.title) return;
              li.hidden = (!!li.dataset.unused && !unused.checked) || li.dataset.title.indexOf(term) < 0;
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
            var n = vals('role').length, c = f.querySelector('[data-fd-count]');
            c.textContent = n; c.hidden = n === 0;
            q('[data-fd-quick]').forEach(function(b) {
              b.classList.toggle('btn-primary', same(vals('status'), JSON.parse(b.dataset.status)) && same(vals('age'), JSON.parse(b.dataset.age)));
            });
          }
          function set(n, v) { q('input[name=' + n + ']').forEach(function(c) { c.checked = v.indexOf(c.value) >= 0; }); }
          f.addEventListener('click', function(e) {
            var r = e.target.closest('[data-fd-reset]'), b = e.target.closest('[data-fd-quick]');
            if (r) { Object.keys(def).forEach(function(n) { set(n, def[n]); }); sync(); }
            if (b) { set('status', JSON.parse(b.dataset.status)); set('age', JSON.parse(b.dataset.age)); f.requestSubmit(); }
          });
          f.addEventListener('change', function(e) {
            if (e.target === unused) { try { localStorage.setItem(key, unused.checked ? '1' : '0'); } catch (x) {} view(); }
            sync();
          });
          search.addEventListener('input', view);
          // Schließen (Esc, Abbrechen, Backdrop) verwirft nicht angewendete Änderungen.
          dlg.addEventListener('close', function() { f.reset(); search.value = ''; loadUnused(); view(); sync(); });
          loadUnused(); view(); sync();
        })();
      ` }} />
    </>
  );
}
