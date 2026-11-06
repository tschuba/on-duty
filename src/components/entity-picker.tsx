import { Icon } from "./icon.js";
import { t } from "../i18n/index.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";

// Combobox-Autocomplete für Personenauswahlen (ein <input> bleibt durchgehend im DOM). Die Suchroute
// bleibt pro Stelle (eigene Query + requireAuth) und liefert <PickerOptions> als Ergebnis-Markup.
// Das Script wird einmal pro Seite gebunden (wie ChipInput). Ereignisse auf dem Wurzelelement:
// `picker:select` (detail = data-* der Trefferzeile), `picker:create`, `picker:clear`.
let instanceCount = 0;
export function EntityPicker({ id, name, searchUrl, selectedId, selectedName, placeholder, required, suggest, include, extraParams, error }: {
  /** id des Hidden-Felds; steht auch als data-picker-id am Wurzelelement (Filter für `picker:*`-Ereignisse). */
  id?: string;
  /** Feldname des Hidden-Felds; ohne Namen wird nichts abgeschickt (z. B. Mehrfachauswahl). */
  name?: string;
  searchUrl: string;
  selectedId?: string;
  selectedName?: string;
  placeholder?: string;
  required?: boolean;
  /** Beim Fokus auf das leere Feld ebenfalls `searchUrl` abfragen (die Route liefert dann Vorschläge). */
  suggest?: boolean;
  /** CSS-Selektor weiterer Formularfelder, die an die Suche angehängt werden. */
  include?: string;
  extraParams?: Record<string, string>;
  error?: boolean;
}) {
  const listId = `picker-list-${++instanceCount}`;
  const sel = Boolean(selectedId);
  return (
    <div class="relative" data-picker data-picker-id={id ?? ""} data-required-msg={required ? t("picker.selectPerson") : ""} data-suggest={suggest ? "1" : ""}>
      <label class={`input flex items-center gap-2 w-full${error ? " input-error" : ""}`}>
        <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
        <input
          type="text"
          name="q"
          class="picker-input grow min-w-0"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls={listId}
          autocomplete="off"
          placeholder={placeholder}
          value={selectedName ?? ""}
          readonly={sel}
          hx-get={searchUrl}
          hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms${suggest ? ", picker-suggest" : ""}`}
          hx-target={`#${listId}`}
          hx-include={include}
          hx-vals={extraParams ? JSON.stringify(extraParams) : undefined}
        />
        <button type="button" class="picker-clear btn btn-ghost btn-xs btn-circle" aria-label={t("common.remove")} hidden={!sel}>
          <Icon name="x-mark" class="w-4 h-4" />
        </button>
      </label>
      <input type="hidden" id={id} name={name} value={selectedId ?? ""} />
      <ul id={listId} role="listbox" hidden class="picker-list menu menu-sm absolute left-0 right-0 top-full z-50 mt-1 max-h-60 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow" />
      <script dangerouslySetInnerHTML={{ __html: PICKER_SCRIPT }} />
    </div>
  );
}

export type PickerOption = {
  id: string;
  name: string;
  /** Zweitzeile zur Unterscheidung gleichnamiger Personen. */
  sub?: string;
  /** Weitere Felder (camelCase) für `picker:select`, landen als data-*. */
  data?: Record<string, string | null | undefined>;
};

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

// Ergebnis-Markup der Suchrouten. `createLabel` nur setzen, wenn der Benutzer hier Personen anlegen darf.
export function PickerOptions({ options, empty, createLabel, heading }: { options: PickerOption[]; empty?: string; createLabel?: string; heading?: string }) {
  return (
    <>
      {heading && options.length > 0 && <li class="menu-title">{heading}</li>}
      {options.map((o) => {
        const data = Object.fromEntries(Object.entries(o.data ?? {}).map(([k, v]) => [`data-${kebab(k)}`, v ?? ""]));
        return (
          <li role="option" data-id={o.id} data-name={o.name} {...data}>
            <a class="flex flex-col items-start gap-0 pointer-coarse:min-h-11">
              <span>{o.name}</span>
              {o.sub && <span class="block text-xs opacity-60">{o.sub}</span>}
            </a>
          </li>
        );
      })}
      {options.length === 0 && empty && <li class="px-3 py-2 text-sm opacity-60">{empty}</li>}
      {createLabel && (
        <li role="option" data-create class={options.length > 0 ? "border-t border-base-300 pt-1 mt-1" : ""}>
          <a class="text-primary pointer-coarse:min-h-11">
            <Icon name="plus" class="w-4 h-4" />
            {createLabel}
          </a>
        </li>
      )}
    </>
  );
}

const PICKER_SCRIPT = `
  if (!window.__pickerBound) {
    window.__pickerBound = true;
    function pickerParts(root) {
      return { input: root.querySelector('.picker-input'), hidden: root.querySelector('input[type=hidden]'), ul: root.querySelector('.picker-list'), clear: root.querySelector('.picker-clear') };
    }
    function pickerSync(root) {
      var p = pickerParts(root);
      p.input.setCustomValidity(root.dataset.requiredMsg && !p.hidden.value ? root.dataset.requiredMsg : '');
    }
    window.pickerSync = pickerSync;
    function pickerOptions(ul) { return Array.from(ul.querySelectorAll('[role=option]')); }
    function pickerClose(root) {
      var p = pickerParts(root);
      p.ul.hidden = true;
      p.input.setAttribute('aria-expanded', 'false'); p.input.removeAttribute('aria-activedescendant');
      pickerOptions(p.ul).forEach(function(o) { o.setAttribute('aria-selected', 'false'); o.firstChild.classList.remove('menu-active'); });
    }
    function pickerOpen(root) {
      var p = pickerParts(root);
      p.ul.hidden = !p.ul.children.length;
      p.input.setAttribute('aria-expanded', p.ul.hidden ? 'false' : 'true');
    }
    function pickerMove(root, dir) {
      var p = pickerParts(root);
      if (p.ul.hidden) pickerOpen(root);
      var opts = pickerOptions(p.ul);
      if (p.ul.hidden || !opts.length) return;
      var cur = opts.findIndex(function(o) { return o.getAttribute('aria-selected') === 'true'; });
      var next = cur < 0 ? (dir > 0 ? 0 : opts.length - 1) : (cur + dir + opts.length) % opts.length;
      opts.forEach(function(o, n) { o.setAttribute('aria-selected', n === next ? 'true' : 'false'); o.firstChild.classList.toggle('menu-active', n === next); });
      p.input.setAttribute('aria-activedescendant', opts[next].id);
      opts[next].scrollIntoView({ block: 'nearest' });
    }
    function pickerEmit(root, type, detail) { root.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: detail || {} })); }
    function pickerSelect(root, li) {
      var p = pickerParts(root);
      pickerClose(root);
      if (li.hasAttribute('data-create')) { p.ul.textContent = ''; pickerEmit(root, 'picker:create'); return; }
      p.hidden.value = li.dataset.id; p.input.value = li.dataset.name; p.input.readOnly = true; p.clear.hidden = false;
      p.ul.textContent = '';
      pickerSync(root);
      pickerEmit(root, 'picker:select', Object.assign({}, li.dataset));
    }
    function pickerReset(root) {
      var p = pickerParts(root);
      p.hidden.value = ''; p.input.value = ''; p.input.readOnly = false; p.clear.hidden = true;
      p.ul.textContent = ''; pickerClose(root); pickerSync(root);
      p.input.focus();
      pickerEmit(root, 'picker:clear');
    }
    document.body.addEventListener('htmx:afterSwap', function(e) {
      var ul = e.target.closest && e.target.closest('.picker-list'); if (!ul) return;
      pickerOptions(ul).forEach(function(o, n) { o.id = ul.id + '-' + n; o.setAttribute('aria-selected', 'false'); });
      pickerOpen(ul.closest('[data-picker]'));
    });
    document.body.addEventListener('keydown', function(e) {
      var input = e.target.closest && e.target.closest('.picker-input'); if (!input) return;
      var root = input.closest('[data-picker]'), ul = pickerParts(root).ul;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pickerMove(root, e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Escape' && !ul.hidden) { e.preventDefault(); e.stopPropagation(); pickerClose(root); return; }
      var act = !ul.hidden && ul.querySelector('[aria-selected=true]');
      if (e.key === 'Enter' && act) { e.preventDefault(); pickerSelect(root, act); }
      else if (e.key === 'Tab') pickerClose(root);
    });
    // mousedown darf den Fokus nicht aus dem Feld nehmen, sonst schließt focusout die Liste vor dem Klick.
    document.body.addEventListener('mousedown', function(e) {
      if (e.target.closest && e.target.closest('.picker-list')) e.preventDefault();
    });
    document.body.addEventListener('click', function(e) {
      var li = e.target.closest && e.target.closest('.picker-list [role=option]');
      if (li) { pickerSelect(li.closest('[data-picker]'), li); return; }
      var cl = e.target.closest && e.target.closest('.picker-clear');
      if (cl) pickerReset(cl.closest('[data-picker]'));
    });
    document.body.addEventListener('focusin', function(e) {
      var input = e.target.closest && e.target.closest('.picker-input'); if (!input) return;
      var root = input.closest('[data-picker]');
      if (root.dataset.suggest && !input.readOnly && !input.value) htmx.trigger(input, 'picker-suggest');
    });
    document.body.addEventListener('focusout', function(e) {
      var root = e.target.closest && e.target.closest('[data-picker]');
      if (root && !root.contains(e.relatedTarget)) pickerClose(root);
    });
  }
  document.querySelectorAll('[data-picker]').forEach(function(r) { window.pickerSync(r); });
`;
