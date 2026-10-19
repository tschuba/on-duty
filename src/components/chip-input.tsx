import { t } from "../i18n/index.js";

// Generic chip input: every chip is its own <input type="hidden" name={name}>, so
// values may contain commas. Script is bound once per page and works per instance
// via [data-chip-input] (no fixed ids → several instances per page are fine).
export function ChipInput({ name, label, placeholder, values, max, maxFrom, labelSingle, placeholderSingle, splitOnComma = false, caseSensitive = true, hint }: {
  name: string;
  label: string;
  placeholder?: string;
  values?: string[];
  max?: number;
  /** CSS selector of a number field that provides the live maximum (e.g. `[name=quantity]`). */
  maxFrom?: string;
  /** Label used while the maximum is 1; the counter is hidden then. */
  labelSingle?: string;
  placeholderSingle?: string;
  splitOnComma?: boolean;
  caseSensitive?: boolean;
  /** Counter text template, "{n}" and "{max}" are replaced. */
  hint?: string;
}) {
  const list = values ?? [];
  return (
    <div class="form-control" data-chip-input data-name={name} data-split={splitOnComma ? "1" : ""} data-case={caseSensitive ? "1" : ""}
      data-max={max ?? ""} data-max-from={maxFrom ?? ""} data-hint={hint ?? ""} data-label={label} data-label-single={labelSingle ?? ""} data-placeholder={placeholder ?? ""} data-placeholder-single={placeholderSingle ?? ""} data-remove-label={t("common.remove")}>
      <label class="label"><span class="label-text chip-label">{label}</span></label>
      <div class="chip-box input input-bordered w-full h-auto min-h-10 py-1.5 flex flex-wrap items-center gap-1">
        {list.map((v) => (
          <span class="badge badge-outline gap-1" data-chip={v}>
            {v}
            <button type="button" class="chip-remove" aria-label={t("common.remove")}>×</button>
            <input type="hidden" name={name} value={v} />
          </span>
        ))}
        <input type="text" class="chip-text grow min-w-24 outline-none bg-transparent" placeholder={placeholder} />
      </div>
      <span class="label-text-alt opacity-60 mt-1 chip-counter" />
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__chipInputBound) {
          window.__chipInputBound = true;
          function chipMax(root) {
            if (root.dataset.maxFrom) {
              var f = document.querySelector(root.dataset.maxFrom);
              var n = f ? parseInt(f.value, 10) : NaN;
              if (n > 0) return n;
            }
            return root.dataset.max ? parseInt(root.dataset.max, 10) : Infinity;
          }
          function chipRefresh(root) {
            var count = root.querySelectorAll('[data-chip]').length, max = chipMax(root);
            var input = root.querySelector('.chip-text');
            input.disabled = count >= max;
            var c = root.querySelector('.chip-counter');
            root.querySelector('.chip-label').textContent = (max === 1 && root.dataset.labelSingle) || root.dataset.label;
            input.placeholder = (max === 1 && root.dataset.placeholderSingle) || root.dataset.placeholder;
            c.textContent = (root.dataset.hint && max !== Infinity && max > 1) ? root.dataset.hint.replace('{n}', count).replace('{max}', max) : '';
          }
          function chipAdd(root, value) {
            value = value.trim();
            if (!value) return;
            var ci = !root.dataset.case, key = ci ? value.toLowerCase() : value;
            var exists = Array.from(root.querySelectorAll('[data-chip]')).some(function(s){
              return (ci ? s.dataset.chip.toLowerCase() : s.dataset.chip) === key;
            });
            if (exists || root.querySelectorAll('[data-chip]').length >= chipMax(root)) return;
            var chip = document.createElement('span');
            chip.className = 'badge badge-outline gap-1';
            chip.dataset.chip = value;
            chip.appendChild(document.createTextNode(value));
            var rm = document.createElement('button');
            rm.type = 'button'; rm.className = 'chip-remove'; rm.textContent = '×';
            rm.setAttribute('aria-label', root.dataset.removeLabel);
            chip.appendChild(rm);
            var h = document.createElement('input');
            h.type = 'hidden'; h.name = root.dataset.name; h.value = value;
            chip.appendChild(h);
            root.querySelector('.chip-box').insertBefore(chip, root.querySelector('.chip-text'));
          }
          function chipCommit(input) {
            var root = input.closest('[data-chip-input]');
            var parts = root.dataset.split ? input.value.split(',') : [input.value];
            parts.forEach(function(p){ chipAdd(root, p); });
            input.value = '';
            chipRefresh(root);
          }
          document.body.addEventListener('keydown', function(e) {
            var input = e.target.closest && e.target.closest('[data-chip-input] .chip-text');
            if (!input) return;
            var root = input.closest('[data-chip-input]');
            if (e.key === 'Enter' || (e.key === ',' && root.dataset.split)) { e.preventDefault(); chipCommit(input); }
          });
          document.body.addEventListener('click', function(e) {
            var rm = e.target.closest('.chip-remove');
            if (!rm) return;
            var root = rm.closest('[data-chip-input]');
            rm.closest('[data-chip]').remove();
            chipRefresh(root);
          });
          document.body.addEventListener('submit', function(e) {
            e.target.querySelectorAll('[data-chip-input] .chip-text').forEach(function(i){ if (i.value.trim()) chipCommit(i); });
          }, true);
          document.body.addEventListener('input', function(e) {
            document.querySelectorAll('[data-chip-input][data-max-from]').forEach(chipRefresh);
          });
          document.addEventListener('DOMContentLoaded', function(){ document.querySelectorAll('[data-chip-input]').forEach(chipRefresh); });
        }
        document.querySelectorAll('[data-chip-input]').forEach(function(r){ if (typeof chipRefresh === 'function') chipRefresh(r); });
      ` }} />
    </div>
  );
}
