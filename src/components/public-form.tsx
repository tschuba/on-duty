import { Icon } from "./icon.js";
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
// `hint` erklärt den Anlass (z. B. Stornierung) über den Kontaktdaten.
export async function ContactFooter({ hint }: { hint?: string } = {}) {
  const c = await loadOrgConfig();
  const address = [
    [c.orgStreet, c.orgHouseNumber].filter(Boolean).join(" "),
    [c.orgZip, c.orgCity].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  if (!c.orgContactEmail && !c.orgContactPhone && !address) return <></>;
  const row = (icon: "map-pin" | "phone" | "envelope", content: unknown) => (
    <p class="flex items-center gap-2 pl-4"><Icon name={icon} class="size-4 shrink-0" /><span>{content}</span></p>
  );
  return (
    <div class="mt-8 text-sm opacity-70 space-y-1">
      <p class="font-semibold">{t("contact.title")}</p>
      {hint && <p>{hint}</p>}
      {c.orgName && <p class="pl-4">{c.orgName}</p>}
      {address && row("map-pin", address)}
      {c.orgContactPhone && row("phone", <a class="link" href={`tel:${c.orgContactPhone}`}>{c.orgContactPhone}</a>)}
      {c.orgContactEmail && row("envelope", <a class="link" href={`mailto:${c.orgContactEmail}`}>{c.orgContactEmail}</a>)}
    </div>
  );
}

export function clientIp(c: any): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
}
