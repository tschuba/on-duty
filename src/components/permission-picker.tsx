import { t } from "../i18n/index.js";
import { PERMISSION_LABELS, RESOURCE_LABELS } from "./permission-badges.js";
import type { Permission } from "../lib/roles.js";

// Durchsuchbare, nach Ressource gruppierte Rechte-Auswahl als Chips (Hidden-Input je Chip).
// Panel öffnet beim Fokus; Tippen filtert, Enter übernimmt den ersten Treffer. Skript einmal je Seite.
export function PermissionPicker({ name, options, values }: { name: string; options: Permission[]; values: string[] }) {
  const groups = new Map<string, Permission[]>();
  for (const p of options) groups.set(p.split(":")[0], [...(groups.get(p.split(":")[0]) ?? []), p]);
  const chip = (p: string) => (
    <span class="badge badge-outline gap-1 pr-1" data-chip={p}>
      {PERMISSION_LABELS[p as Permission] ?? p}
      <button type="button" class="pp-remove inline-flex items-center justify-center rounded-full h-4 w-4 ml-0.5 bg-base-300 text-xs leading-none cursor-pointer hover:bg-error hover:text-error-content" aria-label={t("common.remove")}>×</button>
      <input type="hidden" name={name} value={p} />
    </span>
  );
  return (
    <div class="relative w-full" data-perm-picker data-name={name} data-remove={t("common.remove")}>
      <div class="pp-box input w-full h-auto min-h-10 py-1.5 flex flex-wrap items-center gap-1 cursor-text">
        {values.filter((p) => options.includes(p as Permission)).map(chip)}
        <input type="text" class="pp-text grow min-w-32 outline-none bg-transparent font-[inherit] text-base" placeholder={t("mailTemplates.custom.permissions.search")} aria-label={t("mailTemplates.custom.permissions")} autocomplete="off" />
      </div>
      <div hidden class="pp-panel absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow p-2 space-y-2">
        {[...groups].map(([res, perms]) => (
          <section data-g>
            <h4 class="px-1 text-xs font-bold uppercase tracking-wide text-base-content/60">{RESOURCE_LABELS[res] ?? res}</h4>
            <ul class="menu menu-sm p-0">
              {perms.map((p) => <li data-p={p} data-s={`${p} ${PERMISSION_LABELS[p]} ${RESOURCE_LABELS[res] ?? ""}`.toLowerCase()} hidden={values.includes(p)}><a role="option">{PERMISSION_LABELS[p]}</a></li>)}
            </ul>
          </section>
        ))}
        <p class="pp-empty hidden px-1 text-sm opacity-60" role="status">{t("mailTemplates.custom.permissions.empty")}</p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__permPickerBound) {
          window.__permPickerBound = true;
          var ppRoot = function(e){ return e.target.closest && e.target.closest('[data-perm-picker]'); };
          function ppFilter(r) {
            var q = r.querySelector('.pp-text').value.trim().toLowerCase(), any = false;
            r.querySelectorAll('.pp-panel li').forEach(function(li){
              var used = r.querySelector('[data-chip="' + li.dataset.p + '"]');
              li.hidden = !!used || li.dataset.s.indexOf(q) < 0;
            });
            r.querySelectorAll('.pp-panel [data-g]').forEach(function(g){
              var v = g.querySelector('li:not([hidden])'); g.hidden = !v; if (v) any = true;
            });
            r.querySelector('.pp-empty').classList.toggle('hidden', any);
          }
          function ppAdd(r, p, label) {
            if (r.querySelector('[data-chip="' + p + '"]')) return;
            var c = document.createElement('span'); c.className = 'badge badge-outline gap-1 pr-1'; c.dataset.chip = p;
            c.appendChild(document.createTextNode(label));
            var b = document.createElement('button'); b.type = 'button'; b.textContent = '×'; b.setAttribute('aria-label', r.dataset.remove);
            b.className = 'pp-remove inline-flex items-center justify-center rounded-full h-4 w-4 ml-0.5 bg-base-300 text-xs leading-none cursor-pointer hover:bg-error hover:text-error-content';
            var h = document.createElement('input'); h.type = 'hidden'; h.name = r.dataset.name; h.value = p;
            c.appendChild(b); c.appendChild(h);
            var box = r.querySelector('.pp-box'); box.insertBefore(c, r.querySelector('.pp-text'));
            box.dispatchEvent(new Event('input', { bubbles: true }));
          }
          function ppPick(r, li) { var i = r.querySelector('.pp-text'); i.value = ''; ppAdd(r, li.dataset.p, li.textContent); ppFilter(r); i.focus(); }
          document.body.addEventListener('focusin', function(e){
            var r = ppRoot(e); if (r && e.target.classList.contains('pp-text')) { ppFilter(r); r.querySelector('.pp-panel').hidden = false; }
          });
          document.body.addEventListener('focusout', function(e){
            var r = ppRoot(e); if (r && !r.contains(e.relatedTarget)) r.querySelector('.pp-panel').hidden = true;
          });
          document.body.addEventListener('mousedown', function(e){ if (e.target.closest && e.target.closest('.pp-panel')) e.preventDefault(); });
          document.body.addEventListener('input', function(e){ var r = ppRoot(e); if (r && e.target.classList.contains('pp-text')) ppFilter(r); });
          document.body.addEventListener('keydown', function(e){
            var r = ppRoot(e); if (!r || !e.target.classList.contains('pp-text')) return;
            if (e.key === 'Escape') { r.querySelector('.pp-panel').hidden = true; return; }
            if (e.key === 'Enter') { e.preventDefault(); var li = r.querySelector('.pp-panel li:not([hidden])'); if (li) ppPick(r, li); }
            if (e.key === 'Backspace' && !e.target.value) { var cs = r.querySelectorAll('[data-chip]'); if (cs.length) { cs[cs.length - 1].remove(); ppFilter(r); } }
          });
          document.body.addEventListener('click', function(e){
            var r = ppRoot(e); if (!r) return;
            var li = e.target.closest('.pp-panel li'); if (li) { ppPick(r, li); return; }
            var rm = e.target.closest('.pp-remove'); if (rm) { rm.closest('[data-chip]').remove(); ppFilter(r); return; }
            r.querySelector('.pp-text').focus();
          });
        }
      ` }} />
    </div>
  );
}
