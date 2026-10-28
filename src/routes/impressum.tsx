import { Hono } from "hono";
import { LegalPage, LegalSection, OrgAddress, OrgContact } from "../components/legal-page.js";
import { t } from "../i18n/index.js";
import { loadOrgConfig, isImpressumComplete } from "../lib/org-config.js";

export const impressumRoutes = new Hono();

// 404 until the required org data is complete (§ 5 DDG).
impressumRoutes.get("/", async (c) => {
  const cfg = await loadOrgConfig();
  if (!isImpressumComplete(cfg)) return c.notFound();
  c.header("Cache-Control", "public, max-age=60");
  return c.html(<LegalPage title={t("impressum.title")} current="impressum">
    <OrgAddress cfg={cfg} />
    <LegalSection label={t("impressum.represented")}><p>{cfg.orgRepresentative.trim()}</p></LegalSection>
    {cfg.orgRegisterNumber?.trim() && <LegalSection label={t("impressum.register")}><p>{[cfg.orgRegisterCourt, cfg.orgRegisterNumber].map((x) => x?.trim()).filter(Boolean).join(" ")}</p></LegalSection>}
    <LegalSection label={t("impressum.contact")}><OrgContact cfg={cfg} /></LegalSection>
  </LegalPage>);
});
