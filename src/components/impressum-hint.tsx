import { t } from "../i18n/index.js";
import { loadOrgConfig, isImpressumComplete } from "../lib/org-config.js";

// Warnzeile für die Einstellungen der öffentlichen Seiten (Anträge, Verleih-Opt-in, Kalender),
// solange die Pflichtangaben für /impressum fehlen. Keine Blockade, nur ein Hinweis mit Link.
export async function ImpressumHint() {
  const c = await loadOrgConfig();
  if (isImpressumComplete(c)) return <></>;
  return (
    <div role="alert" class="alert alert-warning alert-soft text-sm text-base-content">
      <span>{t("impressum.adminHint")} <a href="/organisation#master" class="link font-medium whitespace-nowrap">{t("impressum.adminHintLink")}</a></span>
    </div>
  );
}
