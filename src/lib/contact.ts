// Formatprüfung für öffentliche Formulare (kein DNS/MX). Gespeichert wird die Eingabe;
// nur der Personenabgleich nutzt die normalisierte Telefonnummer.
export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function normalizePhone(v: string): string {
  return v.replace(/[\s\-/()]/g, "");
}

export function isValidPhone(v: string): boolean {
  return /^\+?\d{6,15}$/.test(normalizePhone(v));
}
