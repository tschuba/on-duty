import { Icon } from "./icon.js";
import type { IconName } from "./icon.js";
import { t } from "../i18n/index.js";

export type TitleSwitchItem = { active: boolean; href: string; label: string; count?: number; icon?: IconName }; // icon: zwischen @2xl und @4xl zeigen inaktive Ansichten nur das Icon

// Ansichten-Umschalter im Seitentitel (PageHeader `title`). Die Stufe richtet sich nach dem tatsächlich freien Platz der Kopfzeile (Script unten
// prüft, ob das <h1> überläuft): Text (aktiv groß mit Gold-Linie, inaktiv blass) → nur Icons der inaktiven Ansichten (nur mit `icon`) → Dropdown mit Haken.
// Ohne Script bleibt das Dropdown. Doku: docs/style-guide.md → „Ansichten-Umschalter".
const FIT = "(function(){if(window.__tsFit)return;function fit(){document.querySelectorAll('[data-title-switch]').forEach(function(s){var h=s.closest('h1');if(!h)return;var m=s.hasAttribute('data-icons')?['text','icons','menu']:['text','menu'];for(var i=0;i<m.length;i++){s.dataset.mode=m[i];if(h.scrollWidth<=h.clientWidth+1)break;}});}window.__tsFit=fit;var ro=new ResizeObserver(fit);function obs(){document.querySelectorAll('.page-header').forEach(function(e){ro.observe(e);});fit();}obs();document.addEventListener('htmx:afterSettle',obs);if(document.fonts)document.fonts.ready.then(fit);document.addEventListener('click',function(e){var d=document.getElementById('title-switch');if(d&&d.open&&!d.contains(e.target))d.open=false;});})();";

export function TitleSwitch({ items }: { items: TitleSwitchItem[] }) {
  const current = items.find((v) => v.active) ?? items[0];
  if (items.length < 2) return <>{current.label}</>; // nichts zum Umschalten
  return (
    <span class="group/ts contents" data-title-switch data-icons={items.some((v) => v.icon) ? "" : undefined}>
      <span class="hidden group-data-[mode=text]/ts:inline-flex group-data-[mode=icons]/ts:inline-flex items-baseline gap-3 whitespace-nowrap">
        {items.map((v, i) => (<>
          {i > 0 && <span class="w-px h-5 bg-base-content/20 self-center" aria-hidden="true" />}
          <a href={v.href} title={v.label} aria-current={v.active ? "page" : undefined}
            class={v.active ? "border-b-2 border-gold/60 pb-0.5" : "text-xl !font-normal text-base-content/50 hover:text-base-content hover:underline underline-offset-4 decoration-1 decoration-base-content/30"}>{!v.active && v.icon && <Icon name={v.icon} class="hidden group-data-[mode=icons]/ts:inline-block h-6 w-6 align-middle" />}<span class={!v.active && v.icon ? "group-data-[mode=icons]/ts:sr-only" : undefined}>{v.label}</span>{!v.active && v.count ? <span class="badge badge-sm badge-warning ml-1 align-middle">{v.count}</span> : null}</a>
        </>))}
      </span>
      <details id="title-switch" class="relative group-data-[mode=text]/ts:hidden group-data-[mode=icons]/ts:hidden">
        <summary class="btn btn-ghost border border-base-300 text-xl @md:text-2xl font-bold h-auto min-h-11 max-w-full px-3 py-1 list-none inline-flex items-center gap-2" aria-label={t("common.switchView")} title={current.label}><span class="truncate">{current.label}</span><Icon name="icon-[tabler--chevron-down]" class="w-5 h-5 shrink-0" /></summary>
        <ul class="menu absolute left-0 top-full mt-1 bg-base-100 rounded-box shadow-lg border border-base-300 z-30 w-56 p-2 text-base font-normal">
          {items.map((v) => <li><a href={v.href} class={v.active ? "!bg-gold/60 !text-base-content" : ""}>{v.label}{!v.active && v.count ? <span class="badge badge-sm badge-warning">{v.count}</span> : null}{v.active && <Icon name="icon-[tabler--check]" class="w-4 h-4 ml-auto" />}</a></li>)}
        </ul>
      </details>
      <script dangerouslySetInnerHTML={{ __html: FIT }} />
    </span>
  );
}
