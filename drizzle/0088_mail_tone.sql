-- Mail-Ton: direkt an den Empfänger adressiert. Nur system-Zeilen, Admin-Overrides bleiben unangetastet.
UPDATE "mail_templates" SET
  "subject" = $s$Neu: Termine bekommst du jetzt per Mail$s$,
  "body" = $b$Hallo {{addressee}},

ab jetzt schreiben wir {{you}} per Mail an, wenn bei {{org.name}} ein Termin neu angelegt, geändert oder abgesagt wird. Bei Terminen mit Anmeldung kannst du direkt in der Mail zu- oder absagen, ohne dich im Portal anzumelden.

Du musst dafür nichts tun. Wenn du diese Mails nicht möchtest, sag uns hier kurz Bescheid:

{{#recipients}}
{{#multiple}}
--- {{name}} ---
{{/multiple}}
Termin-Mails abbestellen: {{optOutUrl}}

{{/recipients}}
{{#multiple}}
Für alle Mitglieder dieser Adresse auf einmal: {{optOutAllUrl}}

{{/multiple}}
Du kannst das jederzeit wieder ändern, auch ohne Anmeldung: {{org.url}}/me

Viele Grüße
{{org.name}}
$b$
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" = 'event-mail-info';--> statement-breakpoint
UPDATE "mail_templates" SET "body" = replace(replace(body, $a$folgender Termin findet statt:$a$, $b$der folgende Termin findet nun doch statt:$b$), $a$Die Absage wurde zurückgenommen.$a$, $b$Die Absage haben wir zurückgenommen.$b$)
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" = 'event-uncancelled';--> statement-breakpoint
UPDATE "mail_templates" SET "body" = replace(body, $a$ist eingegangen und wird geprüft. Das ist noch keine Zusage.$a$, $b$ist bei uns eingegangen, wir schauen sie uns an und melden uns. Das ist noch keine Zusage.$b$)
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" = 'lend-submitted';--> statement-breakpoint
UPDATE "mail_templates" SET "body" = replace(body, $a$dein Antrag wurde leider abgelehnt.$a$, $b$leider können wir deinen Antrag auf Mitgliedschaft bei {{org.name}} nicht annehmen. Wenn du Fragen dazu hast, melde dich gern bei uns.$b$)
WHERE "variant" = 'system' AND "locale" = 'de' AND "key" = 'application-rejected';
