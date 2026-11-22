import { ViewField } from "./field.js";
import { t } from "../i18n/index.js";

type Addr = { street?: string | null; houseNumber?: string | null; zip?: string | null; city?: string | null };

// „Straße Nr., PLZ Ort“: bricht nur zwischen den beiden Teilen um, nie mitten in einem.
export function Address({ p }: { p: Addr }) {
  const line1 = [p.street, p.houseNumber].filter(Boolean).join(" ");
  const line2 = [p.zip, p.city].filter(Boolean).join(" ");
  if (!line1 && !line2) return <>—</>;
  return (
    <>
      {line1 && <span class="inline-block">{line1}{line2 && ","}</span>}
      {line1 && line2 && " "}
      {line2 && <span class="inline-block">{line2}</span>}
    </>
  );
}

// Einheitliches Adress-Gitter für Formular (AddressFields) und Ansicht (AddressView):
// Straße (3) | Nr. (1) / PLZ (1) | Ort (3); mobil einspaltig.
const grid = "grid grid-cols-1 sm:grid-cols-4 gap-4";

export function AddressFields({ street, houseNumber, zip, city }: { street: unknown; houseNumber: unknown; zip: unknown; city: unknown }) {
  return (
    <div class={grid}>
      <div class="sm:col-span-3">{street as never}</div>
      <div class="sm:col-span-1">{houseNumber as never}</div>
      <div class="sm:col-span-1">{zip as never}</div>
      <div class="sm:col-span-3">{city as never}</div>
    </div>
  );
}

export function AddressView({ p }: { p: Addr }) {
  return (
    <div class={grid.replace("gap-4", "gap-6")}>
      <div class="sm:col-span-3"><ViewField label={t("common.address.street")} value={p.street} /></div>
      <div class="sm:col-span-1"><ViewField label={t("common.address.houseNumber")} value={p.houseNumber} /></div>
      <div class="sm:col-span-1"><ViewField label={t("common.address.zip")} value={p.zip} /></div>
      <div class="sm:col-span-3"><ViewField label={t("common.address.city")} value={p.city} /></div>
    </div>
  );
}
