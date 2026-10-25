import { t } from "../i18n/index.js";
import { anniversaryFilterLabel } from "../lib/anniversaries.js";
import { Icon } from "./icon.js";
import { ApplyButton } from "./quick-range-filter.js";

const KINDS = [["service", "anniversaries.filter.service"], ["membership", "anniversaries.filter.membership"], ["birthdays", "anniversaries.filter.birthdays"]] as const;
const MODS = [["5", "anniversaries.filter.halfRoundYears"], ["10", "anniversaries.filter.roundYears"]] as const;

// Art, Halbrund/Rund und Mindestjahre in einem Popup (Optik und Platzierung wie QuickRangeFilter).
// Wirkt erst nach "Anzeigen"; `hidden` trägt die Range-Parameter der Seite.
export function AnniversaryFilter({ kinds, mods, gte, action, hidden = [] }: {
  kinds: string[]; // aktive Arten (alle drei = keine Einschränkung)
  mods: string[];
  gte: number;
  action: string;
  hidden?: [string, string][];
}) {
  const id = "af-popover";
  const label = anniversaryFilterLabel(kinds, mods, gte);
  const active = kinds.length < KINDS.length || mods.length > 0 || gte > 0;
  const toggle = (name: string, value: string, text: string, checked: boolean) => (
    <label class="flex items-center gap-2 min-h-11 cursor-pointer">
      <input type="checkbox" class="toggle toggle-primary" name={name} value={value} checked={checked} />
      <span>{text}</span>
    </label>
  );
  return (
    <form method="get" action={action} id="af" class="flex flex-wrap gap-2 items-center">
      {hidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
      <div class="inline-block">
        <button type="button" class="btn btn-ghost m-0 h-10 py-0 max-w-full font-normal" popovertarget={id} title={label.long}>
          <span class="font-semibold text-sm truncate">{label.short} ▾</span>
        </button>
        <div id={id} popover="auto" class="qrf-popup bg-base-100 border border-base-300 rounded-box shadow-lg p-4 m-0 w-80 max-w-full">
          <span data-arrow class="absolute -top-[7px] size-3 rotate-45 border-t border-l border-base-300 bg-base-100 max-sm:hidden" aria-hidden="true" />
          <h3 class="font-bold mb-3">{label.long}</h3>
          <div class="space-y-3">
            <fieldset>
              <legend class="text-sm text-xs">{t("anniversaries.filter.kind")}</legend>
              {KINDS.map(([v, k]) => toggle("filter", v, t(k), kinds.includes(v)))}
            </fieldset>
            <fieldset>
              <legend class="text-sm text-xs">{t("anniversaries.filter.roundness")}</legend>
              {MODS.map(([v, k]) => toggle("mod", v, t(k), mods.includes(v)))}
            </fieldset>
            <label class="block">
              <span class="text-sm text-xs">{t("anniversaries.minYears.label")}</span>
              <input type="number" inputmode="numeric" name="gte" min="1" value={gte > 0 ? String(gte) : ""} class="input input w-24 min-h-11 text-base" placeholder="–" />
            </label>
          </div>
          <div class="flex gap-2 justify-end mt-4 [&>*]:min-h-11">
            <button type="button" data-reset class="btn btn-ghost mr-auto" aria-label={t("common.reset")} title={t("common.reset")} disabled={!active}>
              <Icon name="arrow-uturn-left" class="w-5 h-5" />
            </button>
            <button type="button" class="btn btn-ghost" popovertarget={id} popovertargetaction="hide" aria-label={t("common.cancel")} title={t("common.cancel")}>
              <Icon name="x-mark" class="w-5 h-5" />
            </button>
            <ApplyButton full />
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var f=document.getElementById('af'), pop=document.getElementById('${id}'), applied=false;
          // Popup unter dem Button; der Zeiger zeigt auf die Button-Mitte (unter sm: Bottom-Sheet per CSS).
          function place(p){
            if (window.innerWidth < 640) return;
            var r=f.querySelector('button[popovertarget="${id}"]').getBoundingClientRect(), m=4;
            p.style.position='fixed'; p.style.inset='auto';
            p.style.top=(r.bottom+8)+'px';
            var left=Math.max(m,Math.min(r.left,window.innerWidth-p.offsetWidth-m));
            p.style.left=left+'px';
            var a=p.querySelector('[data-arrow]');
            if(a) a.style.left=Math.max(8,Math.min(p.offsetWidth-20,r.left+r.width/2-left-6))+'px';
          }
          var rb=f.querySelector('[data-reset]'), kinds=f.querySelectorAll('input[name=filter]'), mods=f.querySelectorAll('input[name=mod]'), gte=f.querySelector('input[name=gte]');
          function isDefault(){
            return Array.prototype.every.call(kinds,function(i){return i.checked;}) &&
              Array.prototype.every.call(mods,function(i){return !i.checked;}) && !gte.value;
          }
          function sync(){ rb.disabled=isDefault(); }
          rb.addEventListener('click',function(){
            kinds.forEach(function(i){i.checked=true;}); mods.forEach(function(i){i.checked=false;}); gte.value=''; sync();
          });
          f.addEventListener('input',sync);
          pop.addEventListener('toggle',function(e){
            if(e.newState==='open') place(pop);
            else if(!applied) { f.reset(); sync(); } // Abbrechen: Ausgangszustand
          });
          f.addEventListener('submit',function(){
            applied=true;
            var k=f.querySelectorAll('input[name=filter]');
            // alle Arten an = keine Einschränkung, nicht in die URL
            if(Array.prototype.every.call(k,function(i){return i.checked;})) k.forEach(function(i){i.disabled=true;});
            var g=f.querySelector('input[name=gte]'); if(!g.value) g.disabled=true;
          });
        })();
      ` }} />
    </form>
  );
}
