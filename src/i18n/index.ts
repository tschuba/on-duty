import { de } from "./de.js";

export function t(key: keyof typeof de, params?: Record<string, string | number>): string {
  let s: string = de[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
