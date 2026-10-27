import { t } from "../i18n/index.js";

// Generic chip input: every chip is its own <input type="hidden" name={name}>, so
// values may contain commas. Script is bound once per page and works per instance
// via [data-chip-input] (no fixed ids → several instances per page are fine).
let instanceCount = 0;
export function ChipInput({ name, label, placeholder, values, max, maxFrom, splitOnComma = false, caseSensitive = true, hint, suggestionsFrom }: {
  name: string;
  label: string;
  placeholder?: string;
  values?: string[];
  max?: number;
  /** CSS selector of a number field that provides the live maximum (e.g. `[name=quantity]`). */
  maxFrom?: string;
  splitOnComma?: boolean;
  caseSensitive?: boolean;
  /** Counter text template, "{n}" and "{max}" are replaced. */
  hint?: string;
  /** CSS selector of a `<script type="application/json">` holding a string[] of suggestions (once per page). */
  suggestionsFrom?: string;
}) {
  const list = values ?? [];
  const listId = `chip-list-${++instanceCount}`;
  return (
    <div class="flex flex-col relative" data-chip-input data-suggestions-from={suggestionsFrom ?? ""} data-name={name} data-split={splitOnComma ? "1" : ""} data-case={caseSensitive ? "1" : ""}
      data-max={max ?? ""} data-max-from={maxFrom ?? ""} data-hint={hint ?? ""} data-label={label} data-placeholder={placeholder ?? ""} data-remove-label={t("common.remove")}>
      <label class="label"><span class="text-sm chip-label">{label}</span></label>
      <div class="chip-box cursor-text input w-full h-auto min-h-10 py-1.5 flex flex-wrap items-center gap-1">
        {list.map((v) => (
          <span class="badge badge-outline gap-1 pr-1" data-chip={v}>
            {v}
            <button type="button" class="chip-remove btn btn-circle min-h-0 h-4 w-4 p-0 ml-0.5 border-0 bg-base-300 text-xs leading-none hover:bg-error hover:text-error-content" aria-label={t("common.remove")}>×</button>
            <input type="hidden" name={name} value={v} />
          </span>
        ))}
        <input type="text" class="chip-text grow min-w-24 outline-none bg-transparent" placeholder={placeholder}
          {...(suggestionsFrom ? { role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId, autocomplete: "off" } : {})} />
      </div>
      {suggestionsFrom && <ul id={listId} role="listbox" hidden class="chip-list menu menu-sm absolute left-0 right-0 top-full z-10 mt-1 max-h-48 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow" />}
      <span class="text-xs opacity-60 mt-1 chip-counter" />
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
            // readonly statt disabled: bleibt fokussierbar, nimmt aber nichts mehr an
            input.readOnly = count >= max;
            var c = root.querySelector('.chip-counter');
            c.textContent = (root.dataset.hint && max !== Infinity) ? root.dataset.hint.replace('{n}', count).replace('{max}', max) : '';
          }
          // Vokabular: Serverliste + Chips aller Instanzen mit gleichem suggestionsFrom (Serverschreibweise gewinnt, sonst erste im DOM).
          function chipVocab(root) {
            var sel = root.dataset.suggestionsFrom;
            if (!sel) return [];
            var out = [], seen = {};
            function add(v) { var k = String(v).toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(String(v)); } }
            var el = document.querySelector(sel);
            try { (el ? JSON.parse(el.textContent) : []).forEach(add); } catch (e) {}
            document.querySelectorAll('[data-chip-input]').forEach(function(r){
              if (r.dataset.suggestionsFrom === sel) r.querySelectorAll('[data-chip]').forEach(function(c){ add(c.dataset.chip); });
            });
            return out;
          }
          function chipClose(root) {
            var ul = root.querySelector('.chip-list'); if (!ul) return;
            ul.hidden = true; ul.textContent = '';
            var i = root.querySelector('.chip-text');
            i.setAttribute('aria-expanded', 'false'); i.removeAttribute('aria-activedescendant');
          }
          function chipOpen(root) {
            var ul = root.querySelector('.chip-list'); if (!ul) return;
            var input = root.querySelector('.chip-text'), q = input.value.trim().toLowerCase();
            var own = Array.from(root.querySelectorAll('[data-chip]')).map(function(s){ return s.dataset.chip.toLowerCase(); });
            var hits = chipVocab(root).filter(function(v){ var l = v.toLowerCase(); return own.indexOf(l) < 0 && l.indexOf(q) >= 0; }).slice(0, 8);
            ul.textContent = '';
            if (!hits.length || input.readOnly) { chipClose(root); return; }
            hits.forEach(function(v, n){
              var li = document.createElement('li');
              li.id = ul.id + '-' + n; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
              var a = document.createElement('a'); a.textContent = v; li.appendChild(a);
              ul.appendChild(li);
            });
            ul.hidden = false; input.setAttribute('aria-expanded', 'true'); input.removeAttribute('aria-activedescendant');
          }
          function chipMove(root, dir) {
            var ul = root.querySelector('.chip-list'), input = root.querySelector('.chip-text');
            if (ul.hidden) { chipOpen(root); if (ul.hidden) return; }
            var opts = Array.from(ul.children), cur = opts.findIndex(function(o){ return o.getAttribute('aria-selected') === 'true'; });
            var next = cur < 0 ? (dir > 0 ? 0 : opts.length - 1) : (cur + dir + opts.length) % opts.length;
            opts.forEach(function(o, n){ o.setAttribute('aria-selected', n === next ? 'true' : 'false'); o.firstChild.classList.toggle('menu-active', n === next); });
            input.setAttribute('aria-activedescendant', opts[next].id);
          }
          function chipAdd(root, value) {
            value = value.trim();
            if (!value) return;
            if (root.dataset.suggestionsFrom && !root.dataset.case) {
              var known = chipVocab(root).find(function(v){ return v.toLowerCase() === value.toLowerCase(); });
              if (known) value = known;
            }
            var ci = !root.dataset.case, key = ci ? value.toLowerCase() : value;
            var exists = Array.from(root.querySelectorAll('[data-chip]')).some(function(s){
              return (ci ? s.dataset.chip.toLowerCase() : s.dataset.chip) === key;
            });
            if (exists || root.querySelectorAll('[data-chip]').length >= chipMax(root)) return;
            var chip = document.createElement('span');
            chip.className = 'badge badge-outline gap-1 pr-1';
            chip.dataset.chip = value;
            chip.appendChild(document.createTextNode(value));
            var rm = document.createElement('button');
            rm.type = 'button'; rm.className = 'chip-remove btn btn-circle min-h-0 h-4 w-4 p-0 ml-0.5 border-0 bg-base-300 text-xs leading-none hover:bg-error hover:text-error-content'; rm.textContent = '×';
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
            chipClose(root);
          }
          document.body.addEventListener('keydown', function(e) {
            var input = e.target.closest && e.target.closest('[data-chip-input] .chip-text');
            if (!input) return;
            var root = input.closest('[data-chip-input]');
            var ul = root.querySelector('.chip-list');
            if (ul) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); chipMove(root, e.key === 'ArrowDown' ? 1 : -1); return; }
              if (e.key === 'Escape' && !ul.hidden) { e.preventDefault(); chipClose(root); return; }
              var act = !ul.hidden && ul.querySelector('[aria-selected=true]');
              if (e.key === 'Enter' && act) { e.preventDefault(); input.value = ''; chipAdd(root, act.textContent); chipRefresh(root); chipClose(root); return; }
            }
            if (input.readOnly && e.key === 'Enter') { e.preventDefault(); return; }
            if (e.key === 'Enter' || (e.key === ',' && root.dataset.split)) { e.preventDefault(); chipCommit(input); }
          });
          document.body.addEventListener('mousedown', function(e) {
            if (e.target.closest && e.target.closest('.chip-list')) e.preventDefault();
          });
          document.body.addEventListener('focusin', function(e) {
            var i = e.target.closest && e.target.closest('[data-chip-input] .chip-text');
            if (i) chipOpen(i.closest('[data-chip-input]'));
          });
          document.body.addEventListener('focusout', function(e) {
            var r = e.target.closest && e.target.closest('[data-chip-input]');
            if (r) chipClose(r);
          });
          document.body.addEventListener('click', function(e) {
            var opt = e.target.closest && e.target.closest('.chip-list li');
            if (opt) {
              var r = opt.closest('[data-chip-input]'), ti = r.querySelector('.chip-text');
              ti.value = ''; chipAdd(r, opt.textContent); chipRefresh(r); chipClose(r); ti.focus();
              return;
            }
            var box = e.target.closest && e.target.closest('.chip-box');
            if (box && !e.target.closest('.chip-remove')) box.querySelector('.chip-text').focus();
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
            var ti = e.target.closest && e.target.closest('[data-chip-input] .chip-text');
            if (ti) chipOpen(ti.closest('[data-chip-input]'));
            document.querySelectorAll('[data-chip-input][data-max-from]').forEach(chipRefresh);
          });
          document.addEventListener('DOMContentLoaded', function(){ document.querySelectorAll('[data-chip-input]').forEach(chipRefresh); });
        }
        document.querySelectorAll('[data-chip-input]').forEach(function(r){ if (typeof chipRefresh === 'function') chipRefresh(r); });
      ` }} />
    </div>
  );
}
