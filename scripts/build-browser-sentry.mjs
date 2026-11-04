import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [`${root}src/browser/inventory-location-view.ts`],
  outfile: `${root}public/js/inventory-location-view.min.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
});
await build({
  entryPoints: [`${root}src/browser/inventory-map.ts`],
  outfile: `${root}public/js/inventory-map.min.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
});
await build({
  entryPoints: [`${root}src/browser/inventory-location.ts`],
  outfile: `${root}public/js/inventory-location.min.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
});
await build({
  entryPoints: [`${root}src/browser/sentry.ts`],
  outfile: `${root}public/js/sentry.min.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(`${root}package.json`, "utf8")).version) },
});
