import { t } from "../i18n/index.js";
import { loadOrgConfig, isImpressumComplete } from "../lib/org-config.js";

// Warnzeile für die Einstellungen der öffentlichen Seiten (Anträge, Verleih-Opt-in, Kalender),
// solange die Pflichtangaben für /impressum fehlen. Keine Blockade, nur ein Hinweis mit Link.
export async function ImpressumHint() {
  const c = await loadOrgConfig();
  if (isImpressumComplete(c)) return <></>;
  return (
    <p class="text-xs text-warning flex items-center gap-1">
      {t("impressum.adminHint")} <a href="/organisation#master" class="link">{t("common.nav.organisation")}</a>
    </p>
  );
}
