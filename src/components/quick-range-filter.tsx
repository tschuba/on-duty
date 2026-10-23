import { t } from "../i18n/index.js";
import { Icon } from "./icon.js";
import { REL_DIRS, REL_UNITS, type ParsedRange, type RangePreset } from "../lib/quick-range.js";

const UNIT_KEY = { D: "filter.quick.unit.D", W: "filter.quick.unit.W", M: "filter.quick.unit.M", Y: "filter.quick.unit.Y" } as const;
const DIR_KEY = { past: "filter.quick.dir.past", future: "filter.quick.dir.future", both: "filter.quick.dir.both" } as const;

// Gemeinsamer "Anzeigen"-Button: unter sm nur Icon.
export function ApplyButton() {
  return (
    <button type="submit" class="btn" aria-label={t("common.show")} title={t("common.show")}>
      <Icon name="check" class="w-5 h-5 sm:hidden" />
      <span class="hidden sm:inline">{t("common.show")}</span>
    </button>
  );
}

// Zeitraum-Filter: Presets (Links, wenden sofort an), "Relativ" und "Benutzerdefiniert" (Felder + Anzeigen).
// Die Komponente rendert das GET-Formular; `hidden` trägt Sortierung/Filter der Seite. `href(params)` baut Preset-Links
// (ohne Datums-/Range-Parameter der Seite). `names` = Datumsparameter (start/end bzw. from/to).
export function QuickRangeFilter({ presets, range, dir, action, hidden = [], names = { start: "start", end: "end" }, bare = false, href }: {
  presets: RangePreset[];
  range: ParsedRange;
  dir: "future" | "past";
  action: string;
  hidden?: [string, string][];
  names?: { start: string; end: string };
  bare?: boolean; // true: kein eigenes <form>, Felder landen im umgebenden Formular der Seite
  href: (params: Record<string, string>) => string;
}) {
  const id = "qrf-popover";
  const rel = range.rel ?? { n: 3, unit: "M" as const, dir };
  const label = range.mode === "preset" ? t(presets.find((p) => p.id === range.id)!.key)
    : range.mode === "rel" ? t("filter.quick.relative")
    : range.mode === "custom" ? t("filter.quick.custom")
    : t("filter.quick.label");
  const showRel = range.mode === "rel", showCustom = range.mode === "custom";
  const item = "flex w-full items-center gap-2 px-2 py-1 min-h-11 rounded hover:bg-base-200 text-left";
  const mark = (on: boolean) => <span class="w-4">{on ? "✓" : ""}</span>;
  const on = (b: boolean) => (b ? " font-semibold text-primary" : "");
  const Wrap = bare ? "div" : "form";
  return (
    <Wrap {...(bare ? {} : { method: "get", action })} id="qrf-form" class={bare ? "contents" : "filter-bar flex flex-wrap gap-2 items-center"}>
      {hidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
      <input type="hidden" name="range" value={range.mode === "custom" ? "custom" : "rel"} disabled={!showRel && !showCustom} />
      <input type="hidden" name="rel" value={`P${rel.n}${rel.unit}`} disabled={!showRel} />
      <div class="inline-block">
        <button type="button" class="btn btn-ghost m-0" popovertarget={id}>{label} ▾</button>
        <div id={id} popover="auto" class="bg-base-100 border border-base-300 rounded-box shadow-lg w-56 p-2 m-0">
          <ul class="space-y-0.5">
            {presets.map((p) => (
              <li key={p.id}>
                <a href={href({ range: p.id })} class={`${item}${on(range.mode === "preset" && p.id === range.id)}`}>
                  {mark(range.mode === "preset" && p.id === range.id)}{t(p.key)}
                </a>
              </li>
            ))}
            <li><button type="button" data-qrf-mode="rel" class={`${item}${on(showRel)}`}>{mark(showRel)}{t("filter.quick.relative")}</button></li>
            <li><button type="button" data-qrf-mode="custom" class={`${item}${on(showCustom)}`}>{mark(showCustom)}{t("filter.quick.custom")}</button></li>
          </ul>
        </div>
      </div>
      <div data-qrf-fields="rel" class={`flex flex-wrap gap-2 items-center${showRel ? "" : " hidden"}`}>
        <input type="number" data-qrf-n min="1" max="999" value={rel.n} class="input input-bordered w-20" aria-label={t("filter.quick.amount")} disabled={!showRel} />
        <select data-qrf-unit class="select select-bordered" aria-label={t("filter.quick.unit")} disabled={!showRel}>
          {REL_UNITS.map((u) => <option value={u} selected={u === rel.unit}>{t(UNIT_KEY[u])}</option>)}
        </select>
        <select name="dir" class="select select-bordered" aria-label={t("filter.quick.direction")} disabled={!showRel}>
          {REL_DIRS.map((d) => <option value={d} selected={d === rel.dir}>{t(DIR_KEY[d])}</option>)}
        </select>
      </div>
      <div data-qrf-fields="custom" class={`flex flex-wrap gap-2 items-center${showCustom ? "" : " hidden"}`}>
        <input type="date" name={names.start} value={range.start} class="input input-bordered w-36" disabled={!showCustom} />
        <span class="text-base-content/50">–</span>
        <input type="date" name={names.end} value={range.end} class="input input-bordered w-36" disabled={!showCustom} />
      </div>
      <div data-qrf-apply class={showRel || showCustom ? "" : "hidden"}><ApplyButton /></div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var f=document.getElementById('qrf-form'), pop=document.getElementById('${id}');
          pop.addEventListener('toggle', function(e) {
            if (e.newState !== 'open') return;
            var r = pop.previousElementSibling.getBoundingClientRect();
            pop.style.position = 'fixed'; pop.style.inset = 'auto';
            pop.style.top = (r.bottom + 4) + 'px';
            pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4)) + 'px';
          });
          function setMode(m){
            ['rel','custom'].forEach(function(k){
              var g=f.querySelector('[data-qrf-fields='+k+']'); g.classList.toggle('hidden',k!==m);
              g.querySelectorAll('input,select').forEach(function(i){i.disabled=k!==m;});
            });
            f.querySelector('[data-qrf-apply]').classList.remove('hidden');
            var r=f.querySelector('input[name=range]'); r.disabled=false; r.value=m;
            f.querySelector('input[name=rel]').disabled=m!=='rel';
            sync(); pop.hidePopover();
          }
          function sync(){
            f.querySelector('input[name=rel]').value='P'+(parseInt(f.querySelector('[data-qrf-n]').value,10)||1)+f.querySelector('[data-qrf-unit]').value;
          }
          f.querySelectorAll('[data-qrf-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.qrfMode);});});
          f.addEventListener('input',sync);
        })();
      ` }} />
    </Wrap>
  );
}
