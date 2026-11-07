import { Icon } from "./icon.js";
import { t } from "../i18n/index.js";
import { env } from "../env.js";
import { capEnabled } from "../lib/cap.js";
import { loadOrgConfig, privacyMode, isImpressumComplete } from "../lib/org-config.js";

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

// Cap-Captcha-Widget (Token landet im Feld `cap-token`); entfällt ohne Konfiguration.
// Jedes Absenden lädt die Seite neu, daher liefert das Widget automatisch ein frisches Token.
export function CapWidget({ error }: { error?: string }) {
  if (!capEnabled()) return <></>;
  return (
    <div>
      <script dangerouslySetInnerHTML={{ __html: `window.CAP_CUSTOM_WASM_URL="/js/cap/cap_wasm_bg.wasm";window.CAP_CUSTOM_HASHWX_URL="/js/cap/hashwx.wasm";` }} />
      <script src="/js/cap/cap.min.js" />
      <cap-widget data-cap-api-endpoint={env.CAP_API_ENDPOINT} data-cap-lang={t("cap.lang")} />
      <noscript><p class="text-sm text-error">{t("cap.noscript")}</p></noscript>
      {error && <p class="text-sm text-error mt-1" role="alert">{error}</p>}
    </div>
  );
}

// Hinweistext im Formular; der Link zur Datenschutzerklärung steht im PublicFooter.
export function PrivacyNotice() {
  return <p class="text-xs opacity-60 mt-2">{t("apply.form.privacyNoticeText")}</p>;
}

// "Kontakt zum Verein": leere Felder entfallen, ohne jede Angabe entfällt der Baustein.
// `hint` erklärt den Anlass (z. B. Stornierung) über den Kontaktdaten, `subject`/`body` füllen Betreff und Text der Mail vor.
export async function ContactFooter({ hint, subject, body }: { hint?: string; subject?: string; body?: string } = {}) {
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
      {c.orgContactEmail && row("envelope", <a class="link" href={`mailto:${c.orgContactEmail}${[subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).map((p, i) => (i ? "&" : "?") + p).join("")}`}>{c.orgContactEmail}</a>)}
    </div>
  );
}

export function capError(result: "invalid" | "unavailable"): string {
  return t(result === "invalid" ? "cap.error.invalid" : "cap.error.unavailable");
}

export function clientIp(c: any): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
}

// Linkzeile für alle öffentlichen Seiten; Impressum-Link nur bei vollständigen Angaben, Datenschutz-Link wie in PrivacyNotice.
export async function PublicFooter() {
  const c = await loadOrgConfig();
  const mode = privacyMode(c);
  const privacyHref = mode === "text" && c.orgPrivacyText?.trim() ? "/datenschutz" : mode === "url" ? c.orgPrivacyUrl?.trim() : undefined;
  const impressum = isImpressumComplete(c);
  if (!impressum && !privacyHref) return <></>;
  return (
    <footer class="mt-8 flex justify-center gap-4 text-xs opacity-60">
      {impressum && <a href="/impressum" target="_blank" rel="noopener" class="link">{t("public.footer.impressum")}</a>}
      {privacyHref && <a href={privacyHref} class="link" target="_blank" rel="noopener">{t("public.footer.privacy")}</a>}
    </footer>
  );
}
