import { t } from "../i18n/index.js";
import { Field } from "./field.js";
import { formatDate } from "../lib/format.js";
import type { CashSettings } from "../lib/cash.js";

type Year = { label: string; startDate: string; endDate: string; basis: string };

// Nur die Felder (ohne <form>), damit auch das Eröffnungsformular sie mitschicken kann.
export function CashSettingsFields({ settings, year, id, editable = true, next }: {
  settings: CashSettings; year?: Year; id: string; editable?: boolean; next?: string;
}) {
  const modes = ["calendar", "anniversary", "custom"] as const;
  return (
    <div class="group flex flex-col gap-4 max-w-xl">
      <fieldset class="fieldset p-0 gap-2">
        <legend class="fieldset-legend">{t("cash.settings.mode")}</legend>
        {modes.map((m) => (
          <label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">
            <input type="radio" name="mode" value={m} id={`${id}-mode-${m}`} class="radio radio-sm" checked={settings.mode === m} disabled={!editable} />
            {t(`cash.settings.mode.${m}`)}
          </label>
        ))}
      </fieldset>
      <div class={`hidden group-has-[#${id}-mode-custom:checked]:block`}>
        <Field label={t("cash.settings.cutoff")} hint={t("cash.settings.cutoffHint")}>
          <input type="text" name="cutoff" value={settings.cutoff} pattern="\d{2}-\d{2}" placeholder={t("cash.settings.cutoff")} class="input w-full" disabled={!editable} />
        </Field>
      </div>
      <fieldset class="fieldset p-0 gap-2">
        <legend class="fieldset-legend">{t("cash.settings.basis")}</legend>
        {(["paid", "booked"] as const).map((b) => (
          <label class="label cursor-pointer items-start justify-start gap-2 pointer-coarse:min-h-11 whitespace-normal">
            <input type="radio" name="basis" value={b} class="radio radio-sm mt-0.5" checked={settings.basis === b} disabled={!editable} />
            <span class="flex flex-col">
              <span class="font-medium">{t(`cash.settings.basis.${b}`)}</span>
              <span class="text-sm opacity-70">{t(`cash.settings.basis.${b}.hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {year && (
        <p class="text-sm opacity-70">
          {t("cash.settings.current", { label: year.label, from: formatDate(year.startDate), to: formatDate(year.endDate) })}
          {next && <> {t("cash.settings.applies", { label: next })}</>}
        </p>
      )}
    </div>
  );
}

// Eine Quelle (org_config), zwei Einstiege (/organisation, Dialog auf /cash); beide posten nach /cash/settings.
export function CashSettingsForm({ id = "cash-settings", back, ...rest }: { settings: CashSettings; year?: Year; back: string; id?: string; editable?: boolean; next?: string }) {
  return (
    <form id={id} method="post" action="/cash/settings" class="flex flex-col gap-4">
      <input type="hidden" name="back" value={back} />
      <CashSettingsFields id={id} {...rest} />
      {rest.editable !== false && <div><button type="submit" class="btn btn-primary">{t("common.save")}</button></div>}
    </form>
  );
}
