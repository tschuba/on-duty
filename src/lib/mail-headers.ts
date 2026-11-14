// Zusatz-Header freier Mail-Vorlagen. Gemeinsame Prüfung für Editor (Browser-Bundle) und Server: keine Server-Abhängigkeiten.
export function checkHeader(name: string, value: string): string | undefined {
  if (!/^[A-Za-z0-9-]+$/.test(name)) return `Header „${name}“: Name nur mit Buchstaben, Ziffern und Bindestrich`;
  if (/^x-on-duty-/i.test(name)) return `Header „${name}“ ist reserviert`;
  if (!/^x-/i.test(name)) return `Header „${name}“: nur Namen, die mit „X-“ beginnen, sind erlaubt`;
  if (/[\r\n]/.test(value)) return `Header „${name}“: Wert darf keinen Zeilenumbruch enthalten`;
}

// Eine Zeile je Header: „X-Name: Wert“.
export function parseHeaders(text: string): { headers: Record<string, string>; errors: string[] } {
  const headers: Record<string, string> = {}, errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const at = line.indexOf(":");
    if (at < 0) return void errors.push(`Zeile ${i + 1}: Format „X-Name: Wert“ erwartet`);
    const name = line.slice(0, at).trim(), value = line.slice(at + 1).trim();
    const err = checkHeader(name, value);
    if (err) errors.push(`Zeile ${i + 1}: ${err}`);
    else headers[name] = value;
  });
  return { headers, errors };
}
