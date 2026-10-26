import { t } from "../i18n/index.js";
import { loadOrgConfig } from "../lib/org-config.js";

export function Honeypot() {
  return (
    <div style="position:absolute;left:-9999px" aria-hidden="true">
      <label>
        Website
        <input type="text" name="website" tabindex={-1} autocomplete="off" />
      </label>
    </div>
  );
}

export function PrivacyNotice() {
  return (
    <p class="text-xs opacity-60 mt-2">
      {t("apply.form.privacyNoticeText")} <a href="/datenschutz" class="link">{t("apply.form.privacyNoticeLink")}</a>
    </p>
  );
}

// "Kontakt zum Verein": leere Felder entfallen, ohne jede Angabe entfällt der Baustein.
export function contactLines(config: Record<string, string>): string[] {
  const address = [
    [config.orgStreet, config.orgHouseNumber].filter(Boolean).join(" "),
    [config.orgZip, config.orgCity].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return [config.orgName, address, config.orgContactEmail, config.orgContactPhone].filter(Boolean);
}

export async function ContactFooter() {
  const lines = contactLines(await loadOrgConfig());
  if (lines.length <= 1) return <></>;
  return (
    <div class="mt-8 text-sm opacity-70">
      <p class="font-semibold">{t("contact.title")}</p>
      {lines.map((l) => <p>{l}</p>)}
    </div>
  );
}

export function clientIp(c: any): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
}
