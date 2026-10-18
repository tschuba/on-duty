// After the very first Zitadel setup, creates the project + OIDC application for on-duty and writes
// client id/secret to /zitadel/bootstrap/oidc.env (read by the app service on start).
// Runs as a one-shot init container using the on-duty image (Node, no extra image needed).
// Zitadel does not allow a preset client id/secret (zitadel/zitadel#4349), hence the API.
//
// Two phases (argument): "oidc" runs BEFORE the app service (project, application, SMTP); "hooks" runs AFTER app has
// started (Zitadel resolves the webhook host when creating the target, so app must already exist) and finally removes
// the bootstrap machine user (IAM_OWNER) and its PAT so no powerful token stays in the volume.
import http from "node:http";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const DIR = "/zitadel/bootstrap";
const OUT = `${DIR}/oidc.env`;
const WEBHOOK_SECRET_FILE = `${DIR}/webhook.secret`;
const PHASE = process.argv[2] ?? "oidc";
const PAT_FILE = `${DIR}/admin.pat`;
const { ZITADEL_DOMAIN, APP_DOMAIN, WEBHOOK_URL, OIDC_CLIENT_ID, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

if (!ZITADEL_DOMAIN || !APP_DOMAIN) {
  console.error("[zitadel-init] ZITADEL_DOMAIN/APP_DOMAIN missing — set the domains of the zitadel and app services in Coolify.");
  process.exit(1);
}

// Domains are baked into Zitadel (issuer, redirect URI, webhook) on first setup and the bootstrap PAT is deleted
// afterwards, so a later domain change cannot be synced automatically. Detect it and say what to do (warn only: the
// local admin login must keep working).
const DOMAINS_FILE = `${DIR}/domains`;
const domains = `ZITADEL_DOMAIN=${ZITADEL_DOMAIN}\nAPP_DOMAIN=${APP_DOMAIN}\n`;
if (PHASE === "oidc") {
  if (!existsSync(DOMAINS_FILE)) {
    writeFileSync(DOMAINS_FILE, domains);
  } else if (readFileSync(DOMAINS_FILE, "utf8") !== domains) {
    console.warn(
      `[zitadel-init] WARNING: domain changed (stored: ${readFileSync(DOMAINS_FILE, "utf8").trim().replace(/\n/g, ", ")}).\n` +
        "  Zitadel issuer, OIDC app redirect URI and webhook target still point to the old domain —\n" +
        "  OIDC login fails until they are updated. See docs/standalone-deployment.md.",
    );
  }
}

if (PHASE === "oidc") {
  if (OIDC_CLIENT_ID) {
    console.log("[zitadel-init] OIDC_CLIENT_ID ist explizit gesetzt — nichts zu tun.");
    process.exit(0);
  }
  if (existsSync(OUT)) {
    console.log("[zitadel-init] oidc.env existiert bereits — nichts zu tun.");
    process.exit(0);
  }
}
if (!existsSync(PAT_FILE)) {
  if (PHASE === "hooks") {
    console.log("[zitadel-init] Kein Bootstrap-Token — Webhook-Einrichtung übersprungen.");
    process.exit(0);
  }
  console.error(
    "[zitadel-init] Weder OIDC_CLIENT_ID noch ein Bootstrap-Token vorhanden (Zitadel wurde nicht frisch aufgesetzt).\n" +
      "  Application manuell anlegen und OIDC_CLIENT_ID/OIDC_CLIENT_SECRET setzen, siehe docs/standalone-deployment.md.",
  );
  process.exit(1);
}

const pat = readFileSync(PAT_FILE, "utf8").trim();

// Talks to the container directly (no TLS/Caddy); the Host header selects the Zitadel instance.
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

// Zitadel reports healthy, but the projections for the machine user may lag behind briefly.
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

if (PHASE === "oidc") {
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

  // Optional convenience: register the same SMTP_* values in Zitadel (confirmation mails).
  if (SMTP_HOST && SMTP_FROM) {
    try {
      const host = `${SMTP_HOST}:${SMTP_PORT || "587"}`;
      const created = await api("POST", "/admin/v1/email/smtp", {
        senderAddress: SMTP_FROM.replace(/^.*<(.+)>$/, "$1"),
        senderName: SMTP_FROM.includes("<") ? SMTP_FROM.replace(/\s*<.*$/, "").replace(/"/g, "") : "on-duty",
        host,
        user: SMTP_USER || "",
        password: SMTP_PASS || "",
        tls: (SMTP_PORT || "587") !== "25",
      });
      await api("POST", `/admin/v1/email/${created.id}/_activate`, {});
      console.log("[zitadel-init] SMTP in Zitadel eingetragen.");
    } catch (e) {
      console.warn("[zitadel-init] SMTP konnte nicht eingetragen werden (optional):", e.message);
    }
  }

  writeFileSync(OUT, `OIDC_CLIENT_ID='${app.clientId}'\nOIDC_CLIENT_SECRET='${app.clientSecret}'\n`, { mode: 0o600 });
  console.log(`[zitadel-init] Application angelegt (Client-ID ${app.clientId}).`);

} else {
  // Optional convenience: webhook for registration/email verification (on-duty: POST /hooks/zitadel). If this fails,
  // on-duty still works — the user is then created at first login. on-duty reads the signing secret from the volume
  // at runtime (app was already running when the target was created and does not know it yet).
  try {
    const target = await api("POST", "/v2/actions/targets", {
      name: "on-duty",
      restAsync: {},
      endpoint: WEBHOOK_URL || `https://${APP_DOMAIN}/hooks/zitadel`,
      timeout: "10s",
    });
    if (target.signingKey) writeFileSync(WEBHOOK_SECRET_FILE, target.signingKey, { mode: 0o644 });
    // Login UI v2 emits "user.human.added" for self-registration too (only the legacy UI emits "selfregistered").
    // "added" also fires for admin-created users — on-duty gates on registrationEnabled.
    await api("PUT", "/v2/actions/executions", {
      condition: { event: { event: "user.human.added" } },
      targets: [target.id],
    });
    await api("PUT", "/v2/actions/executions", {
      condition: { event: { event: "user.human.email.verified" } },
      targets: [target.id],
    });
    console.log("[zitadel-init] Webhook-Target + Executions angelegt.");
  } catch (e) {
    console.warn("[zitadel-init] Webhook konnte nicht eingerichtet werden (optional):", e.message);
    if (e.message.includes("DeniedURL")) {
      console.warn(
        "  Zitadel sperrt dieses Ziel (HTTPClient.DenyList: private Netze/Loopback). WEBHOOK_URL muss auf eine öffentlich\n" +
          "  auflösbare Adresse zeigen (Default: https://<APP_DOMAIN>/hooks/zitadel). Ohne Webhook entsteht der Benutzer\n" +
          "  beim ersten Login — siehe docs/standalone-deployment.md.",
      );
    }
  }

  // Cleanup (only after the last phase): remove the bootstrap user and its PAT.
  try {
    await api("DELETE", `/management/v1/users/${me.user.id}`);
    unlinkSync(PAT_FILE);
  } catch (e) {
    console.warn("[zitadel-init] Bootstrap-User konnte nicht entfernt werden:", e.message);
  }

}
