import type { Child } from "hono/jsx";
import { Icon } from "./icon.js";
import type { IconName } from "./icons.generated.js";
import { t } from "../i18n/index.js";

// Icon + Label einer Aktion; das Label verschwindet per Container-Query (der nächste @container-Vorfahr zählt).
export function ActionContent({ icon, label, variant = "secondary" }: { icon: IconName; label: string; variant?: "primary" | "secondary" }) {
  const hide = variant === "primary" ? "@max-md:hidden" : "@max-xl:hidden";
  return (<>
    <Icon name={icon} class="h-5 w-5 shrink-0" />
    <span class={hide}>{label}</span>
  </>);
}

// Aktions-Button für den Seitenkopf. Label wird per Container-Query ausgeblendet:
// Stufe 1 (schmal) Sekundär, Stufe 2 (sehr schmal) auch Primär. aria-label/title bleiben immer.
export function HeaderAction({ variant = "secondary", icon, label, href, form, type, onclick, class: cls = "btn-neutral", name, value, attrs }: {
  variant?: "primary" | "secondary";
  icon: IconName;
  label: string;
  href?: string;
  form?: string; // id des Formulars im Inhalt (kein JS nötig)
  type?: "submit" | "button" | "reset";
  onclick?: string;
  class?: string; // daisyUI-Farbklasse, z. B. "btn-primary", "btn-outline btn-error"
  name?: string;
  value?: string;
  attrs?: Record<string, string>; // z. B. hx-get für Modal-Auslöser
}) {
  const inner = <ActionContent icon={icon} label={label} variant={variant} />;
  const cls2 = `btn ${cls}`;
  return href ? (
    <a href={href} class={cls2} aria-label={label} title={label}>{inner}</a>
  ) : (
    <button type={type ?? (form ? "submit" : "button")} form={form} name={name} value={value} onclick={onclick} class={cls2} {...attrs} aria-label={label} title={label}>{inner}</button>
  );
}

// Einheitlicher Seitenkopf: Titel links, Aktionen rechtsbündig (Primär zuletzt), sticky unter Hauptnav/Untermenü.
export function PageHeader({ title, backHref, backLabel, subtitle, actions }: {
  title: Child;
  backHref?: string;
  backLabel?: string;
  subtitle?: Child;
  actions?: Child;
}) {
  return (
    <header class="page-header @container sticky z-20 bg-base-100 py-2 mb-4 flex items-center justify-between gap-4">
      <div class="min-w-0">
        {backHref && <a href={backHref} class="link link-hover text-sm opacity-70">{backLabel ?? t("common.backToList")}</a>}
        <h1 class={`text-2xl font-bold truncate${backHref ? " mt-1" : ""}`} style="font-family: var(--font-heading)">{title}</h1>
        {subtitle && <p class="text-sm opacity-60 mt-1">{subtitle}</p>}
      </div>
      {actions && <div class="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

// Standard-Aktionen für Formularseiten: Verwerfen (sekundär, nur bei ungespeicherten Änderungen), optional Speichern & Neu, Speichern (primär, zuletzt).
export function FormActions({ formId, saveAndNew }: { formId: string; saveAndNew?: boolean }) {
  return (<>
    <HeaderAction icon="x-mark" label={t("common.discard")} type="reset" form={formId} class="btn-outline hidden" attrs={{ "data-discard": formId }} />
    {saveAndNew && <HeaderAction icon="plus" label={t("common.saveAndNew")} form={formId} name="_action" value="save_and_new" class="btn-outline btn-primary" />}
    <HeaderAction variant="primary" icon="check" label={t("common.save")} form={formId} class="btn-primary" />
  </>);
}
