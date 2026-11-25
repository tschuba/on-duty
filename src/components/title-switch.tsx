import { Icon } from "./icon.js";
import type { IconName } from "./icon.js";
import { t } from "../i18n/index.js";

export type TitleSwitchItem = { active: boolean; href: string; label: string; count?: number; icon?: IconName }; // icon: zwischen 672 und 890 px zeigen inaktive Ansichten nur das Icon

// Ansichten-Umschalter im Seitentitel (PageHeader `title`). Stufe per Container-Query auf dem .page-header, für alle Seiten gleich:
// < 672 px (@2xl) Dropdown mit Haken, bis 890 px nur Icons der inaktiven Ansichten (nur mit `icon`), darüber Text (aktiv groß mit Gold-Linie, inaktiv blass).
// 890 px = Bedarf der breitesten Seite (/cash?view=report mit Icon-only-Nebenfunktionen); wird eine Seite breiter, Wert hier und in den Hilfe-Links anheben. Doku: docs/style-guide.md → „Ansichten-Umschalter".
const CLOSE = "document.addEventListener('click',function(e){var d=document.getElementById('title-switch');if(d&&d.open&&!d.contains(e.target))d.open=false;});";

export function TitleSwitch({ items }: { items: TitleSwitchItem[] }) {
  const current = items.find((v) => v.active) ?? items[0];
  if (items.length < 2) return <>{current.label}</>; // nichts zum Umschalten
  return (
    <span class="contents">
      <span class="hidden @2xl:inline-flex items-baseline gap-3 whitespace-nowrap">
        {items.map((v, i) => (<>
          {i > 0 && <span class="w-px h-5 bg-base-content/20 self-center" aria-hidden="true" />}
          <a href={v.href} title={v.label} aria-current={v.active ? "page" : undefined}
            class={v.active ? "border-b-2 border-gold/60 pb-0.5" : "text-xl !font-normal text-base-content/50 hover:text-base-content hover:underline underline-offset-4 decoration-1 decoration-base-content/30"}>{!v.active && v.icon && <Icon name={v.icon} class="hidden @2xl:@max-[890px]:inline-block h-6 w-6 align-middle" />}<span class={!v.active && v.icon ? "@2xl:@max-[890px]:sr-only" : undefined}>{v.label}</span>{!v.active && v.count ? <span class="badge badge-sm badge-warning ml-1 align-middle">{v.count}</span> : null}</a>
        </>))}
      </span>
      <details id="title-switch" class="relative @2xl:hidden">
        <summary class="btn btn-ghost border border-base-300 text-xl @md:text-2xl font-bold h-auto min-h-11 max-w-full px-3 py-1 list-none inline-flex items-center gap-2" aria-label={t("common.switchView")} title={current.label}><span class="truncate">{current.label}</span><Icon name="icon-[tabler--chevron-down]" class="w-5 h-5 shrink-0" /></summary>
        <ul class="menu absolute left-0 top-full mt-1 bg-base-100 rounded-box shadow-lg border border-base-300 z-30 w-56 p-2 text-base font-normal">
          {items.map((v) => <li><a href={v.href} class={v.active ? "!bg-gold/60 !text-base-content" : ""}>{v.label}{!v.active && v.count ? <span class="badge badge-sm badge-warning">{v.count}</span> : null}{v.active && <Icon name="icon-[tabler--check]" class="w-4 h-4 ml-auto" />}</a></li>)}
        </ul>
      </details>
      <script dangerouslySetInnerHTML={{ __html: CLOSE }} />
    </span>
  );
}
