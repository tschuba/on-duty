import { t } from "../i18n/index.js";
import { Icon } from "./icon.js";
import { formatDate } from "../lib/format.js";
import { REL_UNITS, formatRange, relLabel, refLabel, todayStr, type ParsedRange, type RangePreset } from "../lib/quick-range.js";

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
export function QuickRangeFilter({ presets, range, dir, action, hidden = [], names = { start: "start", end: "end" }, bare = false, href, cutoff = false }: {
  presets: RangePreset[];
  range: ParsedRange;
  dir: "future" | "past";
  action: string;
  hidden?: [string, string][];
  names?: { start: string; end: string };
  cutoff?: boolean; // page has an anniversary cutoff: offer ceremony years
  bare?: boolean; // true: kein eigenes <form>, Felder landen im umgebenden Formular der Seite
  href: (params: Record<string, string>) => string;
}) {
  // IDs aus der Ziel-URL ableiten, damit mehrere Filter auf einer Seite nicht kollidieren.
  const uid = "qrf-" + action.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const id = `${uid}-popover`;
  const rel = range.rel ?? { n: 3, unit: "M" as const, dir };
  const label = range.mode === "preset" ? t(presets.find((p) => p.id === range.id)!.key)
    : range.mode === "rel" ? relLabel(rel.n, rel.unit, rel.dir, rel.ceremony) + (rel.ref ? ` ${t("filter.quick.ref").toLowerCase()} ${refLabel(rel.ref, todayStr())}` : "")
    : range.mode === "custom" ? t("filter.quick.custom")
    : t("filter.quick.label");
  const dateText = range.mode === "default" ? "" : formatRange(range.start, range.end, todayStr());
  const showRel = range.mode === "rel", showCustom = range.mode === "custom";
  const item = "flex w-full items-center gap-2 px-2 py-1 min-h-11 rounded hover:bg-base-200 text-left";
  const mark = (on: boolean) => <span class="w-4 shrink-0">{on ? "✓" : ""}</span>;
  const on = (b: boolean) => (b ? " font-semibold text-primary" : "");
  const Wrap = bare ? "div" : "form";
  const eid = `${uid}-editor`;
  const initialLabel = label;
  const toggle = (d: "past" | "future") => (
    <label class="flex items-center gap-2 min-h-11 cursor-pointer">
      <input type="checkbox" class="toggle toggle-primary" data-qrf-dir={d} checked={rel.dir === d || rel.dir === "both"} disabled={!showRel} />
      <span>{t(DIR_KEY[d])}</span>
    </label>
  );
  return (
    <Wrap {...(bare ? {} : { method: "get", action })} id={uid} class={bare ? "contents" : "flex flex-wrap gap-2 items-center"}>
      {hidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
      <input type="hidden" name="range" value={range.mode === "custom" ? "custom" : "rel"} disabled={!showRel && !showCustom} />
      <input type="hidden" name="rel" value={`P${rel.n}${rel.unit}`} disabled={!showRel} />
      <input type="hidden" name="dir" value={rel.dir} disabled={!showRel} />
      {cutoff && <input type="hidden" name="yr" value="ceremony" disabled={!showRel || !rel.ceremony} />}
      <div class="inline-block">
        <button type="button" class="btn btn-ghost m-0 h-10 py-0 flex-col items-start justify-center gap-0 font-normal leading-tight" popovertarget={id}>
          <span class="font-semibold text-sm"><span data-qrf-label>{label}</span> ▾</span>
          <span data-qrf-date class={`text-[11px] leading-none opacity-70${dateText ? "" : " hidden"}`}>{dateText}</span>
        </button>
        <div id={id} popover="auto" class={`qrf-popup bg-base-100 border border-base-300 rounded-box shadow-lg ${presets.some((p) => p.group) ? "w-80" : "w-56"} p-2 m-0`}>
          <span data-arrow class="absolute -top-[7px] size-3 rotate-45 border-t border-l border-base-300 bg-base-100" aria-hidden="true" />
          <ul class="space-y-0.5">
            {presets.flatMap((p, i) => {
              const link = (q: RangePreset, cls: string) => (
                <a href={href({ range: q.id, rel: "", dir: "", ref: "", start: "", end: "", from: "", to: "" })} title={formatRange(q.start, q.end, todayStr())} class={cls}>
                  {q.short ? t(q.short) : <>{mark(range.mode === "preset" && q.id === range.id)}{t(q.key)}</>}
                </a>
              );
              if (!p.group) return [<li key={p.id}>{link(p, `${item}${on(range.mode === "preset" && p.id === range.id)}`)}</li>];
              if (presets[i - 1]?.group === p.group) return [];
              const row = presets.filter((q) => q.group === p.group);
              return [
                <li key={p.group} class="flex items-center gap-2 px-2 py-1 min-h-11">
                  {mark(false)}<span class="flex-1 whitespace-nowrap">{t(p.group === "this" ? "filter.quick.this" : "filter.quick.next")}</span>
                  <span class="join shrink-0">
                    {row.map((q) => link(q, `btn btn-sm join-item ${range.mode === "preset" && q.id === range.id ? "btn-outline btn-primary" : "btn-outline btn-neutral"}`))}
                  </span>
                </li>,
              ];
            })}
            <li><button type="button" data-qrf-mode="rel" data-qrf-text={t("filter.quick.relative")} class={`${item}${on(showRel)}`}>{mark(showRel)}{t("filter.quick.relative")}<span class="ml-auto opacity-60" aria-hidden="true">›</span></button></li>
            <li><button type="button" data-qrf-mode="custom" data-qrf-text={t("filter.quick.custom")} class={`${item}${on(showCustom)}`}>{mark(showCustom)}{t("filter.quick.custom")}<span class="ml-auto opacity-60" aria-hidden="true">›</span></button></li>
          </ul>
        </div>
      </div>
      {/* Editor: Popup am Button (Desktop), Bottom-Sheet (< sm) */}
      <div id={eid} popover="auto" class="qrf-popup qrf-editor bg-base-100 border border-base-300 rounded-box shadow-lg p-4 m-0 w-80 max-w-full">
        <span data-arrow class="absolute -top-[7px] size-3 rotate-45 border-t border-l border-base-300 bg-base-100 max-sm:hidden" aria-hidden="true" />
        <h3 class="font-bold mb-3" data-qrf-title>{showCustom ? t("filter.quick.custom") : t("filter.quick.relative")}</h3>
        <div data-qrf-fields="rel" class={`space-y-3${showRel ? "" : " hidden"}`}>
          <div role="group" class="flex flex-wrap gap-x-4" aria-label={t("filter.quick.direction")}>
            {toggle("past")}{toggle("future")}
          </div>
          <div class="flex gap-2">
            <input type="number" inputmode="numeric" data-qrf-n min="1" max="999" value={rel.n} class="input input-bordered w-24 min-h-11 text-base" aria-label={t("filter.quick.amount")} disabled={!showRel} />
            <select data-qrf-unit class="select select-bordered flex-1 min-h-11 text-base" aria-label={t("filter.quick.unit")} disabled={!showRel}>
              {REL_UNITS.flatMap((u) => u === "Y" && cutoff
                ? [<option value="Y" selected={u === rel.unit && !rel.ceremony}>{t("filter.quick.unit.Ycal")}</option>,
                   <option value="YC" selected={u === rel.unit && !!rel.ceremony}>{t("filter.quick.unit.YC")}</option>]
                : [<option value={u} selected={u === rel.unit}>{t(UNIT_KEY[u])}</option>])}
            </select>
          </div>
          <p class="text-xs opacity-70">{t("filter.quick.relHint")}</p>
          <label class="form-control block">
            <span class="label-text text-xs">{t("filter.quick.ref")}</span>
            <div class="join w-full">
              <input type="date" name="ref" data-qrf-ref={todayStr()} value={rel.ref ?? todayStr()} required class="input input-bordered join-item w-full min-h-11 text-base" disabled={!showRel} />
              <button type="button" data-qrf-today class="btn join-item min-h-11" aria-label={t("filter.quick.todayBtn")} title={t("filter.quick.todayBtn")} disabled={!rel.ref}>
                <Icon name="arrow-uturn-left" class="w-5 h-5 sm:hidden" />
                <span class="hidden sm:inline">{t("filter.quick.todayBtn")}</span>
              </button>
            </div>
          </label>
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
          var init=${JSON.stringify({ mode: range.mode, label, date: dateText })};
          // Positioniert das Popup unter dem Button; der Zeiger zeigt auf die Button-Mitte.
          // sheet=true: unter sm als Bottom-Sheet per CSS, keine Positionierung.
          function place(p, sheet){
            if (sheet && window.innerWidth < 640) return;
            var r = f.querySelector('button[popovertarget="${id}"]').getBoundingClientRect(), m = 4;
            p.style.position = 'fixed'; p.style.inset = 'auto';
            p.style.top = (r.bottom + 8) + 'px';
            var left = Math.max(m, Math.min(r.left, window.innerWidth - p.offsetWidth - m));
            p.style.left = left + 'px';
            var a = p.querySelector('[data-arrow]');
            if (a) a.style.left = Math.max(8, Math.min(p.offsetWidth - 20, r.left + r.width / 2 - left - 6)) + 'px';
          }
          var btn=f.querySelector('button[popovertarget="${id}"]');
          pop.addEventListener('toggle', function(e){ if (e.newState==='open') place(pop, false); });
          ed.addEventListener('toggle', function(e){
            if (e.newState==='open') { place(ed, true); return; }
            if (!ed.dataset.applied) apply(init.mode, init.label, init.date); // Abbrechen: Ausgangszustand
          });
          function qs(s){return f.querySelector(s);}
          function apply(m,label,date){
            ['rel','custom'].forEach(function(k){
              var g=qs('[data-qrf-fields='+k+']'); g.classList.toggle('hidden',k!==m);
              g.querySelectorAll('input,select').forEach(function(i){i.disabled=k!==m;});
            });
            var r=qs('input[name=range]'); r.disabled=m!=='rel'&&m!=='custom'; r.value=m;
            qs('input[name=rel]').disabled=m!=='rel'; qs('input[name=dir]').disabled=m!=='rel';
            qs('[data-qrf-label]').textContent=label;
            var d=qs('[data-qrf-date]'); d.textContent=date||''; d.classList.toggle('hidden',!date);
            sync();
          }
          function sync(){
            var p=qs('[data-qrf-dir=past]'), n=qs('[data-qrf-dir=future]');
            qs('input[name=dir]').value=p.checked&&n.checked?'both':p.checked?'past':'future';
            var rf=qs('[data-qrf-ref]'); qs('[data-qrf-today]').disabled=rf.value===rf.dataset.qrfRef;
            var u=qs('[data-qrf-unit]').value;
            qs('input[name=rel]').value='P'+(parseInt(qs('[data-qrf-n]').value,10)||1)+u.charAt(0);
            var yr=qs('input[name=yr]'); if(yr) yr.disabled=u!=='YC'||qs('input[name=rel]').disabled;
          }
          f.querySelectorAll('[data-qrf-mode]').forEach(function(b){b.addEventListener('click',function(){
            var m=b.dataset.qrfMode; apply(m,b.dataset.qrfText,'');
            qs('[data-qrf-title]').textContent=b.dataset.qrfText;
            pop.hidePopover(); ed.showPopover();
          });});
          // Mind. ein Schalter aktiv: den letzten abzuschalten aktiviert den anderen.
          f.querySelectorAll('[data-qrf-dir]').forEach(function(c){c.addEventListener('change',function(){
            if(!c.checked){ var o=qs('[data-qrf-dir='+(c.dataset.qrfDir==='past'?'future':'past')+']'); if(!o.checked) o.checked=true; }
            sync();
          });});
          qs('[data-qrf-today]').addEventListener('click',function(){var r=qs('[data-qrf-ref]'); r.value=r.dataset.qrfRef; sync();});
          f.addEventListener('input',sync);
          f.addEventListener('submit',function(){
            ed.dataset.applied='1';
            var r=qs('[data-qrf-ref]'); if(r.value===r.dataset.qrfRef) r.disabled=true; // heute = Standard, nicht in die URL
          });
        })();
      ` }} />
    </Wrap>
  );
}
