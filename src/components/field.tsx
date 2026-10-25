import { Icon } from "./icon.js";
import { t } from "../i18n/index.js";

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

// E-Mail-Eingabe mit Icon und daisyUI-Validator (Hinweis erscheint über `EmailHint`).
export function EmailInput({ id, name, value, placeholder, required, disabled, error, class: cls = "" }: {
  id?: string; name?: string; value?: string; placeholder: string; required?: boolean; disabled?: boolean; error?: boolean; class?: string;
}) {
  return (
    <label class={`input validator flex items-center gap-2 w-full${error ? " input-error" : ""} ${cls}`}>
      <Icon name="envelope" class="w-4 h-4 opacity-60" />
      <input type="email" id={id} name={name} value={value ?? ""} placeholder={placeholder} required={required} disabled={disabled} class="grow min-w-0" />
    </label>
  );
}

export const EmailHint = () => <div class="validator-hint hidden">{t("common.emailInvalid")}</div>;

// Floating-Label-Feld um EmailInput.
export function EmailField({ label, hint, class: cls, ...input }: {
  label: string; hint?: string; class?: string;
  id?: string; name?: string; value?: string; required?: boolean; disabled?: boolean; error?: boolean;
}) {
  return (
    <Field label={label} required={input.required} hint={hint} class={cls} after={<EmailHint />}>
      <EmailInput {...input} placeholder={label} />
    </Field>
  );
}

// Telefon-Eingabe mit Icon und daisyUI-Validator (Hinweis über `PhoneHint`).
// shortcut: nur Zeichen-Whitelist, keine Nummernprüfung; bei Bedarf libphonenumber.
export function PhoneInput({ id, name, value, placeholder, required, disabled, error, mobile, class: cls = "" }: {
  id?: string; name?: string; value?: string; placeholder: string; required?: boolean; disabled?: boolean; error?: boolean; mobile?: boolean; class?: string;
}) {
  return (
    <label class={`input validator flex items-center gap-2 w-full${error ? " input-error" : ""} ${cls}`}>
      <Icon name={mobile ? "device-phone-mobile" : "phone"} class="w-4 h-4 opacity-60" />
      <input type="tel" id={id} name={name} value={value ?? ""} placeholder={placeholder} required={required} disabled={disabled} pattern="[0-9+()\/ \-]*" title={t("common.phoneInvalid")} class="grow min-w-0" />
    </label>
  );
}

export const PhoneHint = () => <div class="validator-hint hidden">{t("common.phoneInvalid")}</div>;

// Floating-Label-Feld um PhoneInput.
export function PhoneField({ label, hint, class: cls, ...input }: {
  label: string; hint?: string; class?: string;
  id?: string; name?: string; value?: string; required?: boolean; disabled?: boolean; error?: boolean; mobile?: boolean;
}) {
  return (
    <Field label={label} required={input.required} hint={hint} class={cls} after={<PhoneHint />}>
      <PhoneInput {...input} placeholder={label} />
    </Field>
  );
}
