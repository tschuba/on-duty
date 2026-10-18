// After the very first Zitadel setup, creates the project + OIDC application for on-duty and writes
// client id/secret to /zitadel/bootstrap/oidc.env (read by the app service on start).
// Runs as a one-shot init container using the on-duty image (Node, no extra image needed).
// Zitadel does not allow a preset client id/secret (zitadel/zitadel#4349), hence the API.
//
// Two phases (argument), both idempotent and run on every deploy: "oidc" runs BEFORE the app service (project,
// application, SMTP, login URL); "hooks" runs AFTER app has started (Zitadel resolves the webhook host when creating the
// target, so app must already exist). On later runs they re-sync everything that embeds a domain (redirect URIs, login
// UI base URL, webhook endpoint), so changing a domain in Coolify only needs a redeploy.
// The bootstrap machine user (IAM_OWNER) and its PAT stay; the PAT lives in its own volume (/zitadel/admin) that only
// zitadel and the init containers mount.
import http from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "/zitadel/bootstrap";
const ADMIN_DIR = "/zitadel/admin";
const OUT = `${DIR}/oidc.env`;
const WEBHOOK_SECRET_FILE = `${DIR}/webhook.secret`;
const PHASE = process.argv[2] ?? "oidc";
const PAT_FILE = `${ADMIN_DIR}/admin.pat`;
const { ZITADEL_DOMAIN, APP_DOMAIN, LOGIN_DOMAIN, WEBHOOK_URL, OIDC_CLIENT_ID, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

if (!ZITADEL_DOMAIN || !APP_DOMAIN) {
  console.error("[zitadel-init] ZITADEL_DOMAIN/APP_DOMAIN missing — set the domains of the zitadel and app services in Coolify.");
  process.exit(1);
}

if (PHASE === "oidc" && OIDC_CLIENT_ID) {
  console.log("[zitadel-init] OIDC_CLIENT_ID is set explicitly — nothing to do.");
  process.exit(0);
}
if (!existsSync(PAT_FILE)) {
  // Installations from before the persistent admin PAT: nothing can be synced, so only detect domain changes.
  const domains = `ZITADEL_DOMAIN=${ZITADEL_DOMAIN}\nAPP_DOMAIN=${APP_DOMAIN}\n`;
  const DOMAINS_FILE = `${DIR}/domains`;
  if (PHASE === "oidc" && existsSync(OUT)) {
    if (!existsSync(DOMAINS_FILE)) {
      writeFileSync(DOMAINS_FILE, domains);
    } else if (readFileSync(DOMAINS_FILE, "utf8") !== domains) {
      console.warn(
        "[zitadel-init] WARNING: domain changed and no admin token is available for an automatic sync.\n" +
          "  Update redirect URI, login UI URL and webhook endpoint manually, see docs/standalone-deployment.md.",
      );
    }
    console.log("[zitadel-init] oidc.env exists, no admin token — nothing to do.");
    process.exit(0);
  }
  if (PHASE === "hooks") {
    console.log("[zitadel-init] No admin token — webhook setup skipped.");
    process.exit(0);
  }
  console.error(
    "[zitadel-init] Neither OIDC_CLIENT_ID nor an admin token is available (Zitadel was not freshly set up).\n" +
      "  Create the application manually and set OIDC_CLIENT_ID/OIDC_CLIENT_SECRET, see docs/standalone-deployment.md.",
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

await retry(() => api("GET", "/auth/v1/users/me"));

if (PHASE === "oidc") {
  const found = await api("POST", "/management/v1/projects/_search", {
    queries: [{ nameQuery: { name: "on-duty", method: "TEXT_QUERY_METHOD_EQUALS" } }],
  });
  const projectId = found.result?.[0]?.id ?? (await api("POST", "/management/v1/projects", { name: "on-duty" })).id;

  const redirectUris = [`https://${APP_DOMAIN}/auth/callback/oidc`];
  const postLogoutRedirectUris = [`https://${APP_DOMAIN}`];
  const apps = await api("POST", `/management/v1/projects/${projectId}/apps/_search`, {
    queries: [{ nameQuery: { name: "on-duty", method: "TEXT_QUERY_METHOD_EQUALS" } }],
  });
  const existing = apps.result?.[0];

  if (!existing) {
    const app = await api("POST", `/management/v1/projects/${projectId}/apps/oidc`, {
      name: "on-duty",
      redirectUris,
      postLogoutRedirectUris,
      responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
      appType: "OIDC_APP_TYPE_WEB",
      authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC", // entspricht "Code" in der Console
    });
    if (!app.clientId || !app.clientSecret) throw new Error("Zitadel lieferte keine Client-ID/Secret");
    writeFileSync(OUT, `OIDC_CLIENT_ID='${app.clientId}'\nOIDC_CLIENT_SECRET='${app.clientSecret}'\n`, { mode: 0o600 });
    console.log(`[zitadel-init] Application angelegt (Client-ID ${app.clientId}).`);

    // Optional convenience: register the same SMTP_* values in Zitadel (confirmation mails). First setup only.
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
  } else {
    // Re-sync the domain-dependent parts. The update replaces the whole OIDC config, so resend the current one.
    const { app } = await api("GET", `/management/v1/projects/${projectId}/apps/${existing.id}`);
    const cfg = app.oidcConfig;
    const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (!same(cfg.redirectUris ?? [], redirectUris) || !same(cfg.postLogoutRedirectUris ?? [], postLogoutRedirectUris)) {
      for (const k of ["version", "clientId", "complianceProblems", "allowedOrigins"]) delete cfg[k];
      await api("PUT", `/management/v1/projects/${projectId}/apps/${existing.id}/oidc_config`, {
        ...cfg,
        redirectUris,
        postLogoutRedirectUris,
      });
      console.log("[zitadel-init] Redirect-URIs der Application aktualisiert.");
    }
    // oidc.env lost (e.g. volume reset) but the app is still there: the secret is not readable, so rotate it.
    if (!existsSync(OUT)) {
      const sec = await api("POST", `/management/v1/projects/${projectId}/apps/${existing.id}/oidc_config/_generate_client_secret`, {});
      writeFileSync(OUT, `OIDC_CLIENT_ID='${app.oidcConfig.clientId}'\nOIDC_CLIENT_SECRET='${sec.clientSecret}'\n`, { mode: 0o600 });
      console.log("[zitadel-init] oidc.env fehlte — Client-Secret neu erzeugt.");
    }
  }

  // The login UI v2 base URL is an instance default seeded on first start; it does not follow the env afterwards.
  await api("PUT", "/v2/features/instance", {
    loginV2: { required: true, baseUri: `https://${LOGIN_DOMAIN || ZITADEL_DOMAIN}/ui/v2/login/` },
  });

  // Zitadel appends the org domain to the username, so the console login name is not obvious. Print it (comfort only).
  try {
    const r = await api("POST", "/v2/users", {
      queries: [{ userNameQuery: { userName: "zitadel-admin@", method: "TEXT_QUERY_METHOD_STARTS_WITH" } }],
    });
    const name = r.result?.[0]?.preferredLoginName;
    if (!name) throw new Error("user zitadel-admin not found");
    console.log(`[zitadel-init] Console login: https://${ZITADEL_DOMAIN} — login name: ${name}`);
    console.log("[zitadel-init] Initial password: value of SERVICE_PASSWORDWITHSYMBOLS_ZITADELADMIN in Coolify + \"Aa1!\" (changed on first login).");
  } catch (e) {
    console.warn("[zitadel-init] Could not determine the admin login name:", e.message);
  }
} else {
  // Optional convenience: webhook for registration/email verification (on-duty: POST /hooks/zitadel). If this fails,
  // on-duty still works — the user is then created at first login. on-duty reads the signing secret from the volume
  // at runtime (app was already running when the target was created and does not know it yet).
  try {
    const endpoint = WEBHOOK_URL || `https://${APP_DOMAIN}/hooks/zitadel`;
    const list = await api("POST", "/v2/actions/targets/search", {});
    let target = (list.targets ?? []).find((t) => t.name === "on-duty");
    if (target) {
      // Keeps the signing key (webhook.secret stays valid); only the endpoint follows the domain.
      if (target.endpoint !== endpoint) {
        await api("POST", `/v2/actions/targets/${target.id}`, { endpoint });
        console.log("[zitadel-init] Webhook-Endpoint aktualisiert.");
      }
    } else {
      target = await api("POST", "/v2/actions/targets", { name: "on-duty", restAsync: {}, endpoint, timeout: "10s" });
      if (target.signingKey) writeFileSync(WEBHOOK_SECRET_FILE, target.signingKey, { mode: 0o644 });
    }
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
}
