import { Icon, type IconName } from "./icon.js";
export type FilterOption = { value: string; label: string; dim?: boolean; hint?: string; group?: string; icon?: IconName };

// Semantikneutral: rendert nur Auswahl und sendet wiederholte Parameter (?p=a&p=b).
// autoApply: Schließen navigiert (page=1). Sonst gehören die Checkboxen (name=param)
// zu einem umgebenden <form method="get">, das beim Schließen mit geänderter Auswahl abgeschickt wird. UND/ODER entscheidet die Route.
export function MultiSelectFilter({ param, options, selected, allLabel, countLabel, applyLabel, resetLabel, searchPlaceholder, emptyLabel, searchable = false, autoApply = false, labelOverride }: {
  param: string;
  options: FilterOption[];
  selected: string[];
  allLabel: string;
  countLabel: (count: number) => string;
  applyLabel: string;
  resetLabel: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  searchable?: boolean;
  autoApply?: boolean;
  labelOverride?: string;
}) {
  const id = `msf-${param}`;
  const label = labelOverride ?? (selected.length === 0
    ? allLabel
    : selected.length === 1
    ? (options.find((o) => o.value === selected[0])?.label ?? countLabel(1))
    : countLabel(selected.length));

  return (
    <div class="msf inline-block" data-msf-param={param} data-msf-auto={autoApply ? "1" : undefined}>
      <button type="button" class="btn btn-ghost m-0" popovertarget={id}>{label} ▾</button>
      <div id={id} popover="auto" class="msf-panel bg-base-100 border border-base-300 rounded-box shadow-lg w-64 p-2 m-0">
        {searchable && (
          <label class="input input-bordered flex items-center gap-2 w-full mb-2"><Icon name="magnifying-glass" class="w-4 h-4 opacity-60" /><input type="text" placeholder={searchPlaceholder} class="grow min-w-0" data-msf-search /></label>
        )}
        <ul class="space-y-0.5 max-h-64 overflow-y-auto">
          {options.length === 0 && emptyLabel && <li class="text-sm opacity-50 px-2 py-1">{emptyLabel}</li>}
          {options.map((o, i) => (
            <>
            {o.group && o.group !== options[i - 1]?.group && (
              <li class="text-xs font-semibold opacity-60 px-2 pt-2" data-msf-group>{o.group}</li>
            )}
            <li key={o.value} data-title={o.label.toLowerCase()}>
              <label class={`flex items-center gap-2 px-2 py-1 min-h-11 rounded cursor-pointer hover:bg-base-200${o.dim ? " opacity-50" : ""}`}>
                <input type="checkbox" class="checkbox checkbox-xs" name={param} value={o.value} checked={selected.includes(o.value)} />
                {o.icon && <Icon name={o.icon} class="w-4 h-4" />}
                <span class="text-sm flex-1">{o.label}</span>
                {o.hint && <span class="text-xs opacity-60">{o.hint}</span>}
              </label>
            </li>
            </>
          ))}
        </ul>
        <div class="flex gap-1 mt-2">
          <button type="button" class="btn btn-sm btn-primary flex-1" popovertarget={id} popovertargetaction="hide">{applyLabel}</button>
          {selected.length > 0 && (
            <button type="button" class="btn btn-sm btn-ghost" data-msf-reset popovertarget={id} popovertargetaction="hide">{resetLabel}</button>
          )}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__msf) {
          window.__msf = true;
          var q = function(el, s) { return Array.from(el.querySelectorAll(s)); };
          document.addEventListener('toggle', function(e) {
            var p = e.target, root = p.closest && p.closest('.msf');
            if (!root) return;
            if (e.newState === 'open') {
              var r = root.querySelector('button').getBoundingClientRect();
              p.style.position = 'fixed';
              p.style.inset = 'auto';
              p.style.top = (r.bottom + 4) + 'px';
              p.style.left = Math.max(4, Math.min(r.left, window.innerWidth - p.offsetWidth - 4)) + 'px';
              return;
            }
            if (!root.dataset.msfAuto) {
              var form = root.closest('form');
              if (form && q(p, 'input[type=checkbox]').some(function(c) { return c.checked !== c.defaultChecked; })) form.requestSubmit();
              return;
            }
            var param = root.dataset.msfParam;
            var next = q(p, 'input[type=checkbox]:checked').map(function(c) { return c.value; });
            var params = new URLSearchParams(window.location.search);
            var cur = params.getAll(param);
            if (cur.slice().sort().join('\\n') === next.slice().sort().join('\\n')) return;
            params.delete(param);
            next.forEach(function(v) { params.append(param, v); });
            if (params.has('page')) params.set('page', '1');
            window.location.search = params.toString();
          }, true);
          document.addEventListener('click', function(e) {
            var b = e.target.closest('[data-msf-reset]');
            if (b) q(b.closest('.msf-panel'), 'input[type=checkbox]').forEach(function(c) { c.checked = false; });
          });
          document.addEventListener('input', function(e) {
            if (!e.target.matches('[data-msf-search]')) return;
            var v = e.target.value.toLowerCase();
            q(e.target.closest('.msf-panel'), 'li[data-title]').forEach(function(li) { li.hidden = !li.dataset.title.includes(v); });
          });
          document.addEventListener('keydown', function(e) {
            var cb = e.target.closest && e.target.closest('.msf-panel input[type=checkbox]');
            if (!cb) return;
            var panel = cb.closest('.msf-panel');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              var vis = q(panel, 'li:not([hidden]) input[type=checkbox]');
              var n = vis.indexOf(cb) + (e.key === 'ArrowDown' ? 1 : -1);
              if (n >= 0 && n < vis.length) vis[n].focus();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              panel.hidePopover();
            }
          });
        }
      ` }} />
    </div>
  );
}
