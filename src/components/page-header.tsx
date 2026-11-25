import type { Child } from "hono/jsx";
import { Icon } from "./icon.js";
import type { IconName } from "./icon.js";
import { t } from "../i18n/index.js";

// Icon + Label einer Aktion; das Label verschwindet per Container-Query (der nächste @container-Vorfahr zählt).
export function ActionContent({ icon, label, variant = "secondary", hide: hideOverride }: { icon: IconName; label: string; variant?: "primary" | "secondary"; hide?: string }) {
  // Hauptaktion behält ihr Label eine Stufe länger (bis @xl), Nebenfunktionen verlieren es unter @2xl.
  const hide = hideOverride ?? (variant === "primary" ? "@max-xl:hidden" : "@max-2xl:hidden");
  return (<>
    <Icon name={icon} class="h-5 w-5 shrink-0" />
    <span class={hide}>{label}</span>
  </>);
}

// Aktions-Button für den Seitenkopf. Label wird per Container-Query ausgeblendet:
// Alle Labels erst ab @2xl (672 px Header-Breite), darunter nur Icon. aria-label/title bleiben immer.
export function HeaderAction({ variant = "secondary", icon, label, href, form, type, onclick, class: cls = "btn-neutral", name, value, attrs, disabled, hideLabel }: {
  hideLabel?: string; // überschreibt die Container-Query-Klasse, die das Label ausblendet (z. B. "hidden" = immer nur Icon)
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
  disabled?: string; // Grund: gesetzt → Button deaktiviert, Grund als Tooltip (am Wrapper, da disabled-Buttons keinen zeigen)
}) {
  const inner = <ActionContent icon={icon} label={label} variant={variant} hide={hideLabel} />;
  const cls2 = `btn ${cls}`;
  if (disabled) return (
    <span class="inline-flex" title={disabled}>
      <button type="button" disabled class={cls2} {...attrs} aria-label={label}>{inner}</button>
    </span>
  );
  return href ? (
    <a href={href} class={cls2} aria-label={label} title={label} {...attrs}>{inner}</a>
  ) : (
    <button type={type ?? (form ? "submit" : "button")} form={form} name={name} value={value} onclick={onclick} class={cls2} {...attrs} aria-label={label} title={label}>{inner}</button>
  );
}

type HeaderActionProps = Parameters<typeof HeaderAction>[0];

// Sekundäraktionen: ab Header-Breite `@md` inline als Buttons, darunter gebündelt in einem „⋯“-Menü (Label immer sichtbar).
export function ActionMenu({ items, hideLabel = "@max-2xl:hidden" }: { items: (HeaderActionProps | false | null | undefined)[]; hideLabel?: string }) {
  const list = items.filter((i): i is HeaderActionProps => !!i);
  if (!list.length) return <></>;
  return (<>
    <span class="hidden @md:contents">
      {list.map((i) => <HeaderAction {...i} hideLabel={hideLabel} />)}
    </span>
    <details class="dropdown dropdown-end @md:hidden">
      <summary class="btn btn-outline" aria-label={t("common.moreActions")} title={t("common.moreActions")}><Icon name="icon-[tabler--dots]" class="h-5 w-5" /></summary>
      <ul class="menu dropdown-content bg-base-100 rounded-box shadow-lg border border-base-300 z-30 w-56 p-2 mt-1 text-base">
        {list.map((i) => <li>{i.href
          ? <a href={i.href} {...i.attrs}><Icon name={i.icon} class="h-5 w-5" />{i.label}</a>
          : <button type="button" onclick={i.onclick} {...i.attrs} disabled={!!i.disabled} title={i.disabled}><Icon name={i.icon} class="h-5 w-5" />{i.label}</button>}</li>)}
      </ul>
    </details>
  </>);
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
    <header class="page-header @container sticky z-20 bg-base-100 pt-2 pb-4 min-h-16 flex items-center justify-between gap-4">
      <div class="min-w-0">
        {backHref && <a href={backHref} data-keep-filter class="link link-hover text-sm opacity-70">{backLabel ?? t("common.backToList")}</a>}
        <h1 class={`text-2xl font-bold truncate [&:has(details)]:overflow-visible ${backHref ? "mt-1" : ""}`} style="font-family: var(--font-heading)">{title}</h1>
        {subtitle && <p class="text-sm opacity-60 mt-1">{subtitle}</p>}
      </div>
      {actions && <div class="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

// Standard-Aktionen für Formularseiten: Verwerfen (sekundär, nur bei ungespeicherten Änderungen), Abbrechen (optional, Link mit Rückfrage bei Änderungen),
// optional Speichern & Neu, Speichern (primär, zuletzt).
export function FormActions({ formId, saveAndNew, cancelHref }: { formId: string; saveAndNew?: boolean; cancelHref?: string }) {
  // Verwerfen-Button ist nur bei Änderungen sichtbar → dient als Dirty-Flag
  const confirmJs = `var d=document.querySelector('[data-discard="${formId}"]');return !d||d.classList.contains('hidden')||confirm(${JSON.stringify(t("common.cancelConfirm"))})`;
  return (<>
    <HeaderAction icon="icon-[tabler--arrow-back-up]" label={t("common.discard")} type="reset" form={formId} class="btn-outline hidden" attrs={{ "data-discard": formId }} />
    {cancelHref && <HeaderAction icon="icon-[tabler--x]" label={t("common.cancel")} href={cancelHref} class="btn-outline" attrs={{ onclick: confirmJs }} />}
    {saveAndNew && <HeaderAction icon="icon-[tabler--plus]" label={t("common.saveAndNew")} form={formId} name="_action" value="save_and_new" class="btn-outline btn-primary" />}
    <HeaderAction variant="primary" icon="icon-[tabler--check]" label={t("common.save")} form={formId} class="btn-primary" />
  </>);
}

// Standard-Aktionen für Read-only-Detailseiten: Löschen (Slot, z. B. Dialog-Trigger) und Bearbeiten (Link auf /:id/edit, nur mit Schreibrecht).
export function DetailActions({ editHref, copyHref, remove }: { editHref?: string; copyHref?: string; remove?: unknown }) {
  return (<>
    {remove as never}
    {copyHref && <HeaderAction icon="icon-[tabler--copy]" label={t("common.copy")} href={copyHref} class="btn-outline btn-primary" />}
    {editHref && <HeaderAction variant="primary" icon="icon-[tabler--pencil]" label={t("common.edit")} href={editHref} class="btn-primary" />}
  </>);
}
