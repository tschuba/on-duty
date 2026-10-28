import { Hono } from "hono";
import { raw } from "hono/html";
import { LegalPage, LegalSection, OrgAddress, OrgContact } from "../components/legal-page.js";
import { t } from "../i18n/index.js";
import { loadOrgConfig, privacyMode } from "../lib/org-config.js";

export const datenschutzRoutes = new Hono();

// Inline privacy policy (only if the org stored a text instead of an external link)
datenschutzRoutes.get("/", async (c) => {
  const cfg = await loadOrgConfig();
  const text = privacyMode(cfg) === "text" ? cfg.orgPrivacyText?.trim() : undefined;
  if (!text) return c.notFound();
  // orgPrivacyText ist bereits sanitizetes Trix-HTML (siehe organisation.tsx); ältere Bestände sind Klartext ohne Tags.
  const isHtml = /<[a-z][\s\S]*>/i.test(text);
  return c.html(<LegalPage title={t("privacy.title")} current="privacy">
    <LegalSection label={t("privacy.controller")}><OrgAddress cfg={cfg} /><OrgContact cfg={cfg} /></LegalSection>
    <div class={isHtml ? "richtext-content" : "whitespace-pre-wrap"}>{isHtml ? raw(text) : text}</div>
  </LegalPage>);
});
