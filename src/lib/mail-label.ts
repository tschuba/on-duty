// Org-Name fürs Betreff-Präfix "[<Name>|<Typ>]": ohne Trennzeichen/Klammern/Zeilenumbrüche, Fallback "on-duty".
// Wird auch von scripts/zitadel-init.mjs genutzt (dort als Kopie — beide Stellen synchron halten).
export function mailLabel(orgName: string | undefined): string {
  return (orgName ?? "").replace(/[|[\]\r\n]/g, " ").replace(/\s+/g, " ").trim() || "on-duty";
}
