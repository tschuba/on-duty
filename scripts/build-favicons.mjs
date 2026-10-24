// Builds the favicons from the glyph paths of branding/logo.svg:
//   public/favicon.svg            "od" monogram (tab icon)
//   branding/apple-touch-icon.svg "on" / "duty", two lines (source for the PNG)
//   public/apple-touch-icon.png   rendered from the SVG above (generated; do not edit by hand)
// Run by hand after changing the logo: pnpm icons:favicons
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = fileURLToPath(new URL("..", import.meta.url));
const logo = readFileSync(join(root, "branding", "logo.svg"), "utf-8");
// Logo paths in order: o n (blue) d u t y (red)
const [o, n, d, u, t, y] = [...logo.matchAll(/<path fill="(#\w+)" d="([^"]+)"\/>/g)].map(([, fill, dd]) => `<path fill="${fill}" d="${dd}"/>`);
const g = (tx, ty, s, ...paths) => `<g transform="translate(${tx} ${ty}) scale(${s})">${paths.join("")}</g>`;
const svg = (size, rx, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="#fff"/>${body}</svg>\n`;

// Glyph boxes in logo units: o 39..444 × 605..1203, d 1032..1443 × 383..1203; "d" pulled up to 60 units from "o".
const favicon = svg(1020, 190, g(33, -283, 1, o) + g(-495, -283, 1, d));
// Line 1 "on" (x 39..943), line 2 "duty" (x 1032..2786), both at half scale, centred on a 1000 canvas.
const apple = svg(1000, 0, g(254.5, -226.5, 0.5, o, n) + g(-454.5, 243.5, 0.5, d, u, t, y));

writeFileSync(join(root, "public", "favicon.svg"), favicon);
writeFileSync(join(root, "branding", "apple-touch-icon.svg"), apple);
writeFileSync(join(root, "public", "apple-touch-icon.png"), new Resvg(apple, { fitTo: { mode: "width", value: 180 } }).render().asPng());
console.log("  wrote favicon.svg, apple-touch-icon.svg, apple-touch-icon.png");
