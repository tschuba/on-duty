import { t } from "../i18n/index.js";
import { Icon } from "./icon.js";
import { formatDate } from "../lib/format.js";
import { REL_DIRS, REL_UNITS, type ParsedRange, type RangePreset } from "../lib/quick-range.js";

const UNIT_KEY = { D: "filter.quick.unit.D", W: "filter.quick.unit.W", M: "filter.quick.unit.M", Y: "filter.quick.unit.Y" } as const;
const DIR_KEY = { past: "filter.quick.dir.past", future: "filter.quick.dir.future", both: "filter.quick.dir.both" } as const;

// Gemeinsamer "Anzeigen"-Button: unter sm nur Icon (full: immer mit Label, z. B. im Popup).
export function ApplyButton({ full = false }: { full?: boolean }) {
  return (
    <button type="submit" class={`btn ${full ? "btn-primary" : ""}`} aria-label={t("common.show")} title={t("common.show")}>
      {!full && <Icon name="check" class="w-5 h-5 sm:hidden" />}
      <span class={full ? "" : "hidden sm:inline"}>{t("common.show")}</span>
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
  // IDs aus der Ziel-URL ableiten, damit mehrere Filter auf einer Seite nicht kollidieren.
  const uid = "qrf-" + action.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const id = `${uid}-popover`;
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
  const eid = `${uid}-editor`;
  const initialLabel = label;
  const dirIcon = (d: (typeof REL_DIRS)[number]) => (
    <label class="btn join-item flex-1 min-h-11 has-[:checked]:btn-primary has-[:focus-visible]:outline">
      <input type="radio" name="dir" value={d} checked={d === rel.dir} disabled={!showRel} class="sr-only" />
      {t(DIR_KEY[d])}
    </label>
  );
  return (
    <Wrap {...(bare ? {} : { method: "get", action })} id={uid} class={bare ? "contents" : "filter-bar flex flex-wrap gap-2 items-center"}>
      {hidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
      <input type="hidden" name="range" value={range.mode === "custom" ? "custom" : "rel"} disabled={!showRel && !showCustom} />
      <input type="hidden" name="rel" value={`P${rel.n}${rel.unit}`} disabled={!showRel} />
      <div class="inline-block">
        <button type="button" class="btn btn-ghost m-0" popovertarget={id}><span data-qrf-label>{label}</span> ▾</button>
        <div id={id} popover="auto" class="qrf-popup bg-base-100 border border-base-300 rounded-box shadow-lg w-56 p-2 m-0">
          <ul class="space-y-0.5">
            {presets.map((p) => (
              <li key={p.id}>
                <a href={href({ range: p.id, rel: "", dir: "", start: "", end: "", from: "", to: "" })} class={`${item}${on(range.mode === "preset" && p.id === range.id)}`}>
                  {mark(range.mode === "preset" && p.id === range.id)}{t(p.key)}
                </a>
              </li>
            ))}
            <li><button type="button" data-qrf-mode="rel" data-qrf-text={t("filter.quick.relative")} class={`${item}${on(showRel)}`}>{mark(showRel)}{t("filter.quick.relative")}</button></li>
            <li><button type="button" data-qrf-mode="custom" data-qrf-text={t("filter.quick.custom")} class={`${item}${on(showCustom)}`}>{mark(showCustom)}{t("filter.quick.custom")}</button></li>
          </ul>
        </div>
      </div>
      {range.mode !== "default" && (
        <span class="text-sm opacity-70 whitespace-nowrap" data-qrf-readonly>{formatDate(range.start)} – {formatDate(range.end)}</span>
      )}
      {/* Editor: Popup am Button (Desktop), Bottom-Sheet (< sm) */}
      <div id={eid} popover="auto" class="qrf-popup qrf-editor bg-base-100 border border-base-300 rounded-box shadow-lg p-4 m-0 w-80 max-w-full">
        <h3 class="font-bold mb-3" data-qrf-title>{showCustom ? t("filter.quick.custom") : t("filter.quick.relative")}</h3>
        <div data-qrf-fields="rel" class={`space-y-3${showRel ? "" : " hidden"}`}>
          <div class="join w-full" role="radiogroup" aria-label={t("filter.quick.direction")}>
            {REL_DIRS.map(dirIcon)}
          </div>
          <div class="flex gap-2">
            <input type="number" inputmode="numeric" data-qrf-n min="1" max="999" value={rel.n} class="input input-bordered w-24 min-h-11 text-base" aria-label={t("filter.quick.amount")} disabled={!showRel} />
            <select data-qrf-unit class="select select-bordered flex-1 min-h-11 text-base" aria-label={t("filter.quick.unit")} disabled={!showRel}>
              {REL_UNITS.map((u) => <option value={u} selected={u === rel.unit}>{t(UNIT_KEY[u])}</option>)}
            </select>
          </div>
        </div>
        <div data-qrf-fields="custom" class={`space-y-3${showCustom ? "" : " hidden"}`}>
          <label class="form-control block">
            <span class="label-text text-xs">{t("filter.quick.from")}</span>
            <input type="date" name={names.start} value={range.start} class="input input-bordered w-full min-h-11 text-base" disabled={!showCustom} />
          </label>
          <label class="form-control block">
            <span class="label-text text-xs">{t("filter.quick.to")}</span>
            <input type="date" name={names.end} value={range.end} class="input input-bordered w-full min-h-11 text-base" disabled={!showCustom} />
          </label>
        </div>
        <div class="flex gap-2 justify-end mt-4 max-sm:flex-col-reverse [&>*]:max-sm:w-full [&>*]:max-sm:min-h-11">
          <button type="button" class="btn btn-ghost" popovertarget={eid} popovertargetaction="hide">{t("common.cancel")}</button>
          <ApplyButton full />
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var f=document.getElementById('${uid}'), pop=document.getElementById('${id}'), ed=document.getElementById('${eid}');
          var init=${JSON.stringify({ mode: range.mode, label: initialLabel })};
          function place(p){
            if (window.innerWidth < 640) return; // Bottom-Sheet per CSS
            var r = p.parentElement.querySelector('button[popovertarget]').getBoundingClientRect();
            p.style.position = 'fixed'; p.style.inset = 'auto';
            p.style.top = (r.bottom + 4) + 'px';
            p.style.left = Math.max(4, Math.min(r.left, window.innerWidth - p.offsetWidth - 4)) + 'px';
          }
          var btn=f.querySelector('button[popovertarget="${id}"]');
          pop.addEventListener('toggle', function(e){ if (e.newState==='open') place(pop); });
          ed.addEventListener('toggle', function(e){
            if (e.newState==='open') { place(ed); return; }
            if (!ed.dataset.applied) apply(init.mode, init.label); // Abbrechen: Ausgangszustand
          });
          function qs(s){return f.querySelector(s);}
          function apply(m,label){
            ['rel','custom'].forEach(function(k){
              var g=qs('[data-qrf-fields='+k+']'); g.classList.toggle('hidden',k!==m);
              g.querySelectorAll('input,select').forEach(function(i){i.disabled=k!==m;});
            });
            var r=qs('input[name=range]'); r.disabled=m!=='rel'&&m!=='custom'; r.value=m;
            qs('input[name=rel]').disabled=m!=='rel';
            qs('[data-qrf-label]').textContent=label;
            var ro=qs('[data-qrf-readonly]'); if(ro) ro.classList.toggle('hidden',m==='rel'||m==='custom'?m!==init.mode:false);
            sync();
          }
          function sync(){
            qs('input[name=rel]').value='P'+(parseInt(qs('[data-qrf-n]').value,10)||1)+qs('[data-qrf-unit]').value;
          }
          f.querySelectorAll('[data-qrf-mode]').forEach(function(b){b.addEventListener('click',function(){
            var m=b.dataset.qrfMode; apply(m,b.dataset.qrfText);
            qs('[data-qrf-title]').textContent=b.dataset.qrfText;
            var ro=qs('[data-qrf-readonly]'); if(ro) ro.classList.add('hidden');
            pop.hidePopover(); ed.showPopover();
          });});
          f.addEventListener('input',sync);
          f.addEventListener('submit',function(){ed.dataset.applied='1';});
        })();
      ` }} />
    </Wrap>
  );
}
