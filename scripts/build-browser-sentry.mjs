import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [`${root}src/browser/sentry.ts`],
  outfile: `${root}public/js/sentry.min.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(`${root}package.json`, "utf8")).version) },
});
