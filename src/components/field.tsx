// Einheitliches Formularfeld (daisyUI v5): Floating Label für Text/Select/Textarea,
// feste Label-Zeile für Datumsfelder (floating=false). Der Pflichtstern sitzt hier.
export function Field({ label, required, hint, floating = true, after, class: cls = "", children }: {
  label: string; required?: boolean; hint?: string; floating?: boolean; after?: unknown; class?: string; children: unknown;
}) {
  const text = <>{label}{required && <span class="text-error ml-1">*</span>}</>;
  return (
    <div class={cls}>
      {floating ? (
        <label class="floating-label w-full">
          <span>{text}</span>
          {children as never}
        </label>
      ) : (
        <fieldset class="fieldset p-0">
          <legend class="fieldset-legend">{text}</legend>
          {children as never}
        </fieldset>
      )}
      {after as never}
      {hint && <p class="label text-xs opacity-70">{hint}</p>}
    </div>
  );
}

// Gruppe zusammengehöriger Felder (Radio-Liste, Von/Bis).
export function FieldGroup({ legend, children }: { legend: string; children: unknown }) {
  return (
    <fieldset class="fieldset p-0">
      <legend class="fieldset-legend">{legend}</legend>
      {children as never}
    </fieldset>
  );
}
