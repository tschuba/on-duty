import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { PublicFooter, clientIp } from "../components/public-form.js";
import { EmailField } from "../components/field.js";
import { t } from "../i18n/index.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { checkRateLimit, recordFailedAttempt, takeAddressSlot } from "../lib/ratelimit.js";
import { isSmtpConfigured } from "../lib/mail.js";
import { sendSettingsLink } from "../lib/member-settings.js";
import { logger } from "../lib/logger.js";

// Öffentliche Anfrage des Einstellungslinks (Backlog 151). Die Einstellungsseite selbst liegt unter /link/:token.
export const meRoutes = new Hono();

function Page({ children }: { children?: unknown }) {
  return (
    <Layout title={t("me.title")}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={t("me.title")} />
        {children}
        <PublicFooter />
      </div>
    </Layout>
  );
}

const Form = () => (
  <form method="post" action="/me" class="space-y-4">
    <p>{t("me.intro")}</p>
    <EmailField label={t("me.email")} name="email" required />
    <button type="submit" class="btn btn-primary">{t("me.submit")}</button>
  </form>
);

meRoutes.get("/", (c) => c.html(<Page>{isSmtpConfigured() ? <Form /> : <p>{t("me.noSmtp")}</p>}</Page>));

meRoutes.post("/", async (c) => {
  if (!isSmtpConfigured()) return c.html(<Page><p>{t("me.noSmtp")}</p></Page>);
  const ip = `me:${clientIp(c)}`; // eigener Zähler, sperrt nicht /apply o. Ä.
  if (!checkRateLimit(ip).allowed) return c.html(<Page><p>{t("link.rateLimited")}</p></Page>, HTTP_STATUS.TOO_MANY_REQUESTS);
  recordFailedAttempt(ip); // jede Anfrage zählt; nach 5 Anfragen sperrt die IP für 15 Minuten
  const email = String((await c.req.parseBody()).email ?? "").trim();
  // Versand erst nach der Antwort, gleiche Antwort für bekannte und unbekannte Adressen.
  if (email && email.length <= 254 && takeAddressSlot(email.toLowerCase())) void sendSettingsLink(email).catch((err) => logger.error({ err }, "[me] settings link failed"));
  return c.html(<Page><p>{t("me.sent")}</p></Page>);
});
