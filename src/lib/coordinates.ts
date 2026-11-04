// Ohne Abhängigkeiten, damit Server und Browser-Bundle dieselbe Logik nutzen.
// Koordinaten nur zusammen; Strings, weil sie roh aus dem Formular bzw. numeric-Spalte kommen.
export function validateLocation(latitude: string, longitude: string): { latitude?: "invalid" | "pair"; longitude?: "invalid" | "pair" } {
  const parse = (v: string, max: number) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && Math.abs(n) <= max;
  };
  const errors: { latitude?: "invalid" | "pair"; longitude?: "invalid" | "pair" } = {};
  if (latitude && !parse(latitude, 90)) errors.latitude = "invalid";
  if (longitude && !parse(longitude, 180)) errors.longitude = "invalid";
  if (!latitude !== !longitude) errors[latitude ? "longitude" : "latitude"] ??= "pair";
  return errors;
}

const NUM = "(-?\\d+(?:[.,]\\d+)?)";
const PAIR = new RegExp(`^${NUM}\\s*[°]?\\s*[;,\\s]\\s*${NUM}\\s*[°]?$`);

// Ein Koordinatenfeld ("48.137154, 11.576124", auch Dezimalkomma): leer = keine Koordinaten, sonst
// Breite/Länge als Strings mit 6 Nachkommastellen oder error. Wertebereich prüft validateLocation.
export function parseCoordinates(raw: string): { latitude: string; longitude: string; error?: true } {
  const v = raw.trim();
  if (!v) return { latitude: "", longitude: "" };
  const m = PAIR.exec(v);
  if (!m || Object.keys(validateLocation(m[1], m[2])).length) return { latitude: "", longitude: "", error: true };
  const fmt = (x: string) => Number(x.replace(",", ".")).toFixed(6);
  return { latitude: fmt(m[1]), longitude: fmt(m[2]) };
}
