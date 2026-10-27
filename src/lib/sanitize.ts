import sanitizeHtml from "sanitize-html";

// Für von Admins per Trix-Editor eingegebenes Rich-Text (z. B. Datenschutzerklärung).
// Whitelist deckt Trix' Standard-Toolbar ab (Überschrift, Fett/Kursiv, Liste, Zitat, Link).
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["h1", "p", "br", "strong", "em", "a", "ul", "ol", "li", "blockquote"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener", target: "_blank" }) },
  }).trim();
}
