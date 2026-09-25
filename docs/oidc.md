# OIDC-Provider konfigurieren

on-duty nutzt OpenID Connect (OIDC) für die Anmeldung regulärer Benutzer. Der lokale Admin-Account (`admin`) ist davon unabhängig und wird über ein eigenes Formular unter `/admin/login` verwaltet.

## Voraussetzungen

- Ein laufender OIDC-Provider (z. B. Authentik, Keycloak, Zitadel)
- Eine öffentlich erreichbare App-URL mit HTTPS (`OIDC_APP_URL`)
- Benutzer müssen **vorab in on-duty angelegt werden** — es gibt keine automatische Kontoerstellung beim ersten Login (kein JIT). Die E-Mail-Adresse im on-duty-Benutzerkonto muss exakt mit der E-Mail aus dem OIDC-Token übereinstimmen.

---

## Generische Konfiguration

### Callback-URI

Die Redirect-URI, die im OIDC-Provider registriert werden muss:

```
https://<OIDC_APP_URL>/auth/callback/oidc
```

Beispiel: `https://on-duty.example.com/auth/callback/oidc`

### Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `OIDC_PROVIDER` | Issuer-URL des Providers — **ohne** abschließenden Schrägstrich. Der Discovery-Endpoint wird automatisch unter `<OIDC_PROVIDER>/.well-known/openid-configuration` erwartet. |
| `OIDC_CLIENT_ID` | OAuth2-Client-ID der registrierten Anwendung |
| `OIDC_CLIENT_SECRET` | OAuth2-Client-Secret |
| `OIDC_APP_URL` | Öffentliche URL der App (HTTPS). Wird zur Ableitung der Callback-URI verwendet. |

Benötigte Scopes: `openid email profile`. Der Provider muss die E-Mail-Adresse des Benutzers im ID-Token liefern — sie ist das einzige Matching-Kriterium.

---

## Authentik

### 1. Anwendung und Provider anlegen

1. Als Admin einloggen → **Applications → Applications** → **Create with Wizard**
2. **Schritt 1 — Application:**
   - Name: z. B. `on-duty`
   - Slug: z. B. `on-duty`
3. **Schritt 2 — Provider:**
   - Provider type: **OAuth2/OpenID Connect**
   - Client type: **Confidential**
   - **Redirect URIs:** `https://<OIDC_APP_URL>/auth/callback/oidc` (eine URI pro Zeile)
   - Authorization flow: Standard-Flow übernehmen
   - Scopes / Property Mappings: Standardwerte belassen (`openid`, `email`, `profile` sind vorinstalliert)
4. **Create Application** klicken

### 2. Client-ID und Client-Secret ablesen

**Applications → Providers** → Provider anklicken → **Edit**. Client-ID und Client-Secret sind auf der Detailseite sichtbar.

### 3. Issuer-URL ermitteln

Authentik verwendet pro Anwendung eine eigene Issuer-URL:

```
https://<authentik-host>/application/o/<application-slug>
```

Beispiel: `https://auth.example.com/application/o/on-duty`

Diesen Wert als `OIDC_PROVIDER` in `.env.local` eintragen — **ohne** abschließenden Schrägstrich.

### 4. `.env.local` befüllen

```env
OIDC_PROVIDER=https://auth.example.com/application/o/on-duty
OIDC_CLIENT_ID=<Client-ID aus Schritt 2>
OIDC_CLIENT_SECRET=<Client-Secret aus Schritt 2>
OIDC_APP_URL=https://on-duty.example.com
```

---

## Benutzer in on-duty anlegen

OIDC-Benutzer müssen vor dem ersten Login in on-duty existieren. Die Verwaltung erfolgt unter **Admin → Benutzer** (verfügbar ab Phase 5). Die eingetragene E-Mail-Adresse muss exakt mit der E-Mail übereinstimmen, die der OIDC-Provider im Token liefert.

---

## Fehlerbehebung

| Fehlermeldung / Symptom | Ursache | Lösung |
|---|---|---|
| „Ihr Konto ist nicht für die Anmeldung freigeschaltet" | E-Mail aus dem OIDC-Token stimmt mit keinem on-duty-Konto überein | Benutzer in on-duty anlegen; E-Mail-Adresse prüfen |
| `invalid_redirect_uri` (Authentik-Fehlerseite) | Registrierte Redirect-URI stimmt nicht mit `${OIDC_APP_URL}/auth/callback/oidc` überein | URI im Authentik-Provider korrigieren oder `OIDC_APP_URL` anpassen |
| 404 / leere Antwort beim Login | Discovery-Endpoint nicht erreichbar | `OIDC_PROVIDER` prüfen: korrekter Slug, kein abschließender `/`, HTTPS |
