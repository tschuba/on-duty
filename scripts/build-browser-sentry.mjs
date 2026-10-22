import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [`${root}src/browser/sentry.ts`],
  outfile: `${root}public/js/sentry.min.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
});
