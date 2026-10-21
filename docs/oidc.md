# OIDC-Provider konfigurieren

on-duty nutzt OpenID Connect (OIDC) für die Anmeldung regulärer Benutzer. Der lokale Admin-Account (`admin`) ist davon unabhängig und wird über ein eigenes Formular unter `/admin/login` verwaltet.

## Voraussetzungen

- Ein laufender OIDC-Provider (z. B. Authentik, Keycloak, Zitadel)
- Eine öffentlich erreichbare App-URL mit HTTPS (`OIDC_APP_URL`)
- Benutzer werden entweder **vorab in on-duty angelegt** oder registrieren sich selbst (siehe [Selbstregistrierung](#selbstregistrierung)). Die E-Mail-Adresse im on-duty-Benutzerkonto muss mit der E-Mail aus dem OIDC-Token übereinstimmen.
- Der Provider muss `email_verified=true` im Token liefern. Ohne bestätigte E-Mail verknüpft on-duty ein OIDC-Konto **nicht** mit einem bestehenden Benutzer und legt keinen neuen an.

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
| `OIDC_ACCOUNT_URL` | Optional. Link zur Kontoverwaltung beim Anmeldedienst (erscheint auf `/account` als „Anmeldedaten verwalten“). Zitadel: `<issuer>/ui/console/users/me` (gegen die Instanz prüfen). |

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

Diesen Wert als `OIDC_PROVIDER` in `.env` eintragen — **ohne** abschließenden Schrägstrich.

### 4. `.env` befüllen

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

---

## Selbstregistrierung

Standardmäßig ist die Selbstregistrierung **aus**. Der Admin schaltet sie unter **Admin → Konfiguration** ein (`registrationEnabled`).

| Einstellung | Wirkung |
|---|---|
| `registrationEnabled` | Beim ersten OIDC-Login mit bestätigter E-Mail wird automatisch ein on-duty-Benutzer angelegt. |
| `registrationAutoApprove` | Neue Benutzer erhalten sofort die Standardrolle. Ohne diese Option sehen sie die Seite „Freischaltung ausstehend“, bis ein Admin ihnen unter **Admin → Benutzer** eine Rolle zuweist („Ablehnen“ löscht den Benutzer). |
| `registrationDefaultRoleId` | Rolle für automatisch freigegebene Benutzer; muss mindestens ein Recht haben. **Achtung:** Jeder, der sich beim Provider registrieren kann, bekommt diese Rechte. |

Bei neuen Registrierungen ohne Auto-Freigabe erhalten alle Benutzer mit `system:admin` eine E-Mail an ihre `users.email` (SMTP nötig). Adressen auf `.invalid` (z. B. lokaler Admin) werden übersprungen; es gibt keine eigene Empfängerliste und keine Drosselung. Bei Auto-Freigabe wird keine Mail verschickt.

**Zwei Schalter:** Die Registrierung beim Provider (Zitadel: *Register allowed*, Authentik: Enrollment Flow) bleibt dauerhaft aktiv; im Alltag steuert der Admin nur `registrationEnabled` in on-duty. Bei einem dedizierten Provider ist der on-duty-Schalter optional, bei einem **geteilten** Provider nötig, sonst würde jeder dort Registrierte einen on-duty-Benutzer erhalten. Provider-Konten ohne on-duty-Benutzer können entstehen, wenn die Registrierung in on-duty aus ist.

**Konto löschen:** Benutzer können ihr Konto unter `/account` (bzw. auf der Wartebildschirm-Seite) selbst löschen. Das lokale Admin-Konto und das letzte Konto mit Benutzerverwaltungs-Recht sind ausgenommen. Das Konto beim Provider bleibt bestehen und muss dort separat gelöscht werden.

### Zitadel

*Settings → Login Behavior and Security → Register allowed* aktivieren. Für Bestätigungsmails ist ein SMTP-Server nötig (*Notification settings → SMTP*); der Standalone-Stack bringt keinen mit.

### Authentik

Authentik liefert `email_verified` seit Release **2025.10** standardmäßig als `false` (davor immer `true`). **Vor dem Update bzw. vor dem Einschalten dieser Version von on-duty** ein eigenes Scope-Mapping anlegen (*Customization → Property Mappings → Scope Mapping*, Scope `email`) und im OAuth2-Provider (*Advanced protocol settings → Scopes*) das Standard-Mapping „OpenID 'email'“ entfernen und stattdessen dieses auswählen:

```python
return {
    "email": request.user.email,
    "email_verified": request.user.attributes.get("email_verified", False),
}
```

Für die Selbstregistrierung einen Enrollment Flow bauen (Stages: Prompt → User Write → Email → User Login) und in der Login-Stage verlinken. Das Setzen des Attributs `email_verified` nach der Email-Stage (z. B. per Expression Policy) muss in der eigenen Instanz getestet werden. Sind alle Benutzer vertrauenswürdig, kann das Mapping stattdessen fest `True` liefern.

Kontrolle: Im ID-Token bzw. Userinfo-Endpoint (z. B. mit jwt.io) muss `"email_verified": true` stehen.

## Kontowechsel

`/login` leitet automatisch zum Provider weiter, mit `prompt=select_account`. Dort kann ein anderes Konto gewählt werden. „Abmelden“ ist rein lokal (kein Single Sign-Out). Bei `/login?error=…` erfolgt keine Weiterleitung. `/admin/login` bleibt unverändert.

## Anmeldeseite gestalten (Zitadel)

`scripts/zitadel-init.mjs` (Phase `oidc`) setzt idempotent die Label Policy der Instanz (Primär-, Warn-, Hintergrundfarbe hell/dunkel aus `src/styles/app.css`), lädt Schrift und Logo aus `branding/` hoch und aktiviert die Policy. Fehler dabei sind nur Warnungen.

- Schrift: `branding/inter-500.ttf` (Zitadel empfiehlt TTF; Inter, OFL-Lizenz). Grenze: nur eine Schrift möglich, Oswald für Überschriften geht nicht.
- Logo: `branding/logo.svg` und `logo-dark.svg`, Wortmarke „onduty“ zweifarbig (Primär-/Fehlerfarbe wie im App-Header, Schrift Oswald), als SVG-Pfade vorgerendert.
- Texte: Der Login-UI v2 wird über die Settings-V2-API (`PUT /v2/settings/hosted_login_translation`) umgetextet (`de`, `en`, Anrede „du“): `common.title`, `accounts.description`, `accounts.addAnother`, `loginname.title`, `loginname.description`, `register.description`, `logout.title`, `logout.description`. `ORG_NAME` ersetzt „Zitadel“ im Text. Alle übrigen Texte bleiben Zitadel-Standard.

## Registrierung absichern (Zitadel-seitig)

on-duty enthält keinen Bot-Schutz. Optionen beim Provider (Konkretes gegen die verwendete Zitadel-Version prüfen):

- Registrierung abschalten bzw. nur per Einladung / Admin-Anlage.
- Domain-Einschränkung und Captcha per Action oder vorgeschaltetem Dienst (nichts Eingebautes).
- E-Mail-Verifizierung ist Pflicht (`email_verified=true`).
- In on-duty `registrationEnabled` und Auto-Freigabe ausgeschaltet lassen.
