import { Icon } from "./icon.js";
import { CATALOG } from "../lib/mail-templates.js";
import { t } from "../i18n/index.js";

// Abschnitt "Mail-Vorlagen" für Zahnrad-Dropdowns: je Vorlage ein Stift-Link in den Editor, Rückweg per ?from.
export function MailTemplateLinks({ keys, from }: { keys: string[]; from: string }) {
  return (
    <>
      <div class="divider my-1" />
      <h3 class="text-xs font-semibold uppercase opacity-60">{t("mailTemplates.settings")}</h3>
      <ul class="space-y-1">
        {keys.filter((k) => CATALOG[k]).map((k) => (
          <li class="flex items-center justify-between gap-2 text-sm">
            <span>{CATALOG[k].name}</span>
            <a href={`/mail/templates/${k}?from=${encodeURIComponent(from)}`} class="btn btn-xs btn-ghost btn-square" title={t("common.edit")} aria-label={`${CATALOG[k].name}: ${t("common.edit")}`}>
              <Icon name="pencil" class="h-4 w-4" />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
