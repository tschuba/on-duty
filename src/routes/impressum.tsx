import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { t } from "../i18n/index.js";
import { loadOrgConfig, isImpressumComplete } from "../lib/org-config.js";

export const impressumRoutes = new Hono();

// 404 until the required org data is complete (§ 5 DDG).
impressumRoutes.get("/", async (c) => {
  const cfg = await loadOrgConfig();
  if (!isImpressumComplete(cfg)) return c.notFound();
  const line = (...p: (string | undefined)[]) => p.map((x) => x?.trim()).filter(Boolean).join(" ");
  const address = [cfg.orgName, line(cfg.orgStreet, cfg.orgHouseNumber), line(cfg.orgZip, cfg.orgCity)].map((x) => x?.trim()).filter(Boolean).join("\n");
  const contact = [cfg.orgContactEmail, cfg.orgContactPhone].map((x) => x?.trim()).filter(Boolean).join("\n");
  c.header("Cache-Control", "public, max-age=60");
  return c.html(<Layout title={t("impressum.title")}><div class="max-w-2xl mx-auto"><PageHeader title={t("impressum.title")} />
    <section class="mb-6"><address class="not-italic whitespace-pre-line">{address}</address></section>
    <section class="mb-6"><h2 class="font-semibold">{t("impressum.represented")}</h2><p>{cfg.orgRepresentative.trim()}</p></section>
    {cfg.orgRegisterNumber?.trim() && <section class="mb-6"><h2 class="font-semibold">{t("impressum.register")}</h2><p>{line(cfg.orgRegisterCourt, cfg.orgRegisterNumber)}</p></section>}
    <section class="mb-6"><h2 class="font-semibold">{t("impressum.contact")}</h2><p class="whitespace-pre-line">{contact}</p></section>
  </div></Layout>);
});
