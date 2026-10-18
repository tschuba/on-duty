export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

// Format check + ISO 13616 mod-97 checksum. Does not verify per-country lengths.
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})(?=.)/g, "$1 ");
}
