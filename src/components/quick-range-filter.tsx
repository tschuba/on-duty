import { t } from "../i18n/index.js";
import type { RangePreset } from "../lib/quick-range.js";

// Popup mit Zeitraum-Presets; jeder Eintrag ist ein Link (wendet sofort an). Die Route liefert die URL.
export function QuickRangeFilter({ presets, start, end, href }: {
  presets: RangePreset[];
  start: string;
  end: string;
  href: (p: RangePreset) => string;
}) {
  const active = presets.find((p) => p.start === start && p.end === end);
  const id = "qrf-popover";
  return (
    <div class="inline-block">
      <button type="button" class="btn btn-ghost m-0" popovertarget={id}>
        {active ? t(active.key) : t("filter.quick.label")} ▾
      </button>
      <div id={id} popover="auto" class="bg-base-100 border border-base-300 rounded-box shadow-lg w-56 p-2 m-0">
        <ul class="space-y-0.5">
          {presets.map((p) => (
            <li key={p.key}>
              <a href={href(p)} class={`flex items-center gap-2 px-2 py-1 min-h-11 rounded hover:bg-base-200${p === active ? " font-semibold text-primary" : ""}`}>
                <span class="w-4">{p === active ? "✓" : ""}</span>{t(p.key)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
