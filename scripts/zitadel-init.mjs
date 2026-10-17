// Legt nach dem allerersten Zitadel-Setup Projekt + OIDC-Application für on-duty an und schreibt
// Client-ID/Secret nach /zitadel/bootstrap/oidc.env (vom app-Service beim Start eingelesen).
// Läuft als einmaliger Init-Container mit dem on-duty-Image (Node, kein zusätzliches Image nötig).
// Zitadel erlaubt keine vorab gesetzte Client-ID/Secret (zitadel/zitadel#4349), daher per API.
//
// Der Bootstrap-Machine-User (IAM_OWNER) wird am Ende gelöscht, damit kein mächtiges Token im Volume bleibt.
import http from "node:http";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const DIR = "/zitadel/bootstrap";
const OUT = `${DIR}/oidc.env`;
const PAT_FILE = `${DIR}/admin.pat`;
const { ZITADEL_DOMAIN, APP_DOMAIN, OIDC_CLIENT_ID } = process.env;

if (OIDC_CLIENT_ID) {
  console.log("[zitadel-init] OIDC_CLIENT_ID ist explizit gesetzt — nichts zu tun.");
  process.exit(0);
}
if (existsSync(OUT)) {
  console.log("[zitadel-init] oidc.env existiert bereits — nichts zu tun.");
  process.exit(0);
}
if (!existsSync(PAT_FILE)) {
  console.error(
    "[zitadel-init] Weder OIDC_CLIENT_ID noch ein Bootstrap-Token vorhanden (Zitadel wurde nicht frisch aufgesetzt).\n" +
      "  Application manuell anlegen und OIDC_CLIENT_ID/OIDC_CLIENT_SECRET setzen, siehe docs/standalone-deployment.md.",
  );
  process.exit(1);
}

const pat = readFileSync(PAT_FILE, "utf8").trim();

// Direkt gegen den Container (kein TLS/Caddy); Host-Header wählt die Zitadel-Instanz.
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: "zitadel",
        port: 8080,
        method,
        path,
        headers: {
          host: ZITADEL_DOMAIN,
          "x-forwarded-proto": "https",
          authorization: `Bearer ${pat}`,
          "content-type": "application/json",
          ...(data && { "content-length": Buffer.byteLength(data) }),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (res.statusCode >= 300) return reject(new Error(`${method} ${path} -> ${res.statusCode}: ${buf}`));
          resolve(buf ? JSON.parse(buf) : {});
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Zitadel ist laut Healthcheck bereit, die Projections für den Machine-User können aber kurz nachlaufen.
async function retry(fn, tries = 30) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const me = await retry(() => api("GET", "/auth/v1/users/me"));

const found = await api("POST", "/management/v1/projects/_search", {
  queries: [{ nameQuery: { name: "on-duty", method: "TEXT_QUERY_METHOD_EQUALS" } }],
});
const projectId = found.result?.[0]?.id ?? (await api("POST", "/management/v1/projects", { name: "on-duty" })).id;

const app = await api("POST", `/management/v1/projects/${projectId}/apps/oidc`, {
  name: "on-duty",
  redirectUris: [`https://${APP_DOMAIN}/auth/callback/oidc`],
  postLogoutRedirectUris: [`https://${APP_DOMAIN}`],
  responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
  grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
  appType: "OIDC_APP_TYPE_WEB",
  authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC", // entspricht "Code" in der Console
});
if (!app.clientId || !app.clientSecret) throw new Error("Zitadel lieferte keine Client-ID/Secret");

writeFileSync(OUT, `OIDC_CLIENT_ID='${app.clientId}'\nOIDC_CLIENT_SECRET='${app.clientSecret}'\n`, { mode: 0o600 });
console.log(`[zitadel-init] Application angelegt (Client-ID ${app.clientId}).`);

// Aufräumen: Bootstrap-User samt PAT entfernen.
try {
  await api("DELETE", `/management/v1/users/${me.user.id}`);
  unlinkSync(PAT_FILE);
} catch (e) {
  console.warn("[zitadel-init] Bootstrap-User konnte nicht entfernt werden:", e.message);
}
