import { Icon } from "./icon.js";
import { t } from "../i18n/index.js";

export type TitleSwitchItem = { active: boolean; href: string; label: string; count?: number };

// Ansichten-Umschalter im Seitentitel (PageHeader `title`). Ab Header-Breite `@2xl` (Container-Query): feste Reihenfolge, aktiv groß mit Gold-Linie,
// inaktiv kleiner/blass; darunter: Dropdown-Button mit Haken am aktiven Eintrag. Doku: docs/style-guide.md → „Ansichten-Umschalter".
export function TitleSwitch({ items }: { items: TitleSwitchItem[] }) {
  const current = items.find((v) => v.active) ?? items[0];
  if (items.length < 2) return <>{current.label}</>; // nichts zum Umschalten
  return (
    <>
      <span class="hidden @2xl:inline-flex items-baseline gap-3">
        {items.map((v, i) => (<>
          {i > 0 && <span class="w-px h-5 bg-base-content/20 self-center" aria-hidden="true" />}
          <a href={v.href} aria-current={v.active ? "page" : undefined}
            class={v.active ? "border-b-2 border-gold/60 pb-0.5" : "text-xl !font-normal text-base-content/50 hover:text-base-content hover:underline underline-offset-4 decoration-1 decoration-base-content/30"}>{v.label}{!v.active && v.count ? <span class="badge badge-sm badge-warning ml-1 align-middle">{v.count}</span> : null}</a>
        </>))}
      </span>
      <details id="title-switch" class="relative @2xl:hidden">
        <summary class="btn btn-ghost border border-base-300 text-2xl font-bold h-auto min-h-11 px-3 py-1 list-none inline-flex items-center gap-2" aria-label={t("common.switchView")}>{current.label}<Icon name="icon-[tabler--chevron-down]" class="w-5 h-5" /></summary>
        <ul class="menu absolute left-0 top-full mt-1 bg-base-100 rounded-box shadow-lg border border-base-300 z-30 w-56 p-2 text-base font-normal">
          {items.map((v) => <li><a href={v.href} class={v.active ? "!bg-gold/60 !text-base-content" : ""}>{v.label}{!v.active && v.count ? <span class="badge badge-sm badge-warning">{v.count}</span> : null}{v.active && <Icon name="icon-[tabler--check]" class="w-4 h-4 ml-auto" />}</a></li>)}
        </ul>
      </details>
      <script dangerouslySetInnerHTML={{ __html: "document.addEventListener('click',function(e){var d=document.getElementById('title-switch');if(d&&d.open&&!d.contains(e.target))d.open=false;});" }} />
    </>
  );
}
