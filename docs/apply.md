# Öffentliche Antragsformulare

`/apply` und `/apply/youth` sind die einzigen öffentlich erreichbaren Routen der App —
kein Login nötig (siehe `src/index.tsx`, Kommentar „Public application forms — no auth
guard“). Interessierte tragen dort ihre Daten ein, der Antrag landet als offener
Eintrag in der internen `/applications`-Warteschlange.

## Routen

| Route | Zweck |
|---|---|
| `/apply` | Normale Mitgliedschaft |
| `/apply/youth` | Kinder-/Jugendfeuerwehr (inkl. Erziehungsberechtigte) |

Beide Formulare verlangen Vor-/Nachname, Geburtsdatum, Adresse und mindestens einen
Kontaktweg (E-Mail oder Telefon).

## Link teilen

Da diese Routen extern beworben werden (Vereins-Website, Social Media, ...), zeigt die
`/applications`-Seite im Adminbereich beide vollständigen URLs mit Kopieren-Button an
(`src/routes/applications.tsx`). Die Basis-URL kommt aus der ohnehin vorhandenen
Umgebungsvariable `OIDC_APP_URL` — es gibt kein separates Config-Feld dafür.
