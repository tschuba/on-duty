import { Field } from "./field.js";
import { Icon } from "./icon.js";

// Koordinatenfeld mit Karten-Picker; das Skript blendet Karte und Buttons ein, ohne JS bleibt nur das Textfeld.
// Pro Seite genau einmal verwendbar (feste IDs). Texte kommen als Props, damit der Picker nicht an einen i18n-Namensraum gebunden ist.
export function LocationPicker({ value, error, labels }: {
  value: string; error?: string;
  labels: { coordinates: string; hint: string; geoError: string; useLocation: string; attribution: string; mapAria: string; apply: string };
}) {
  return (
    <>
      <Field label={labels.coordinates} hint={labels.hint}>
        <input type="text" id="coordinates" name="coordinates" value={value} class={`input w-full${error ? " input-error" : ""}`} placeholder="48.137154, 11.576124" autocomplete="off" />
      </Field>
      {error && <span class="text-error text-sm">{error}</span>}
      <link rel="stylesheet" href="/css/leaflet.css" />
      <div id="location-picker" class="hidden flex-col gap-2" data-geo-error={labels.geoError} data-locate-label={labels.useLocation} data-attribution={labels.attribution}>
        <template><Icon name="current-location" class="size-5" /></template>
        <p data-role="status" class="text-sm text-error" role="status" />
        <div id="location-map" role="region" aria-label={labels.mapAria} class="h-72 rounded-box border border-base-300 z-0" />
        <button type="button" data-act="apply" class="btn btn-sm btn-primary self-start" disabled>{labels.apply}</button>
      </div>
      <script src="/js/location-picker.min.js" defer></script>
    </>
  );
}
