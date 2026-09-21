import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dest = join(root, "public", "fonts");

if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

function findFont(pkg, weight, style = "normal") {
  const dir = join(root, "node_modules", pkg, "files");
  if (!existsSync(dir)) throw new Error(`Package not found: ${pkg}`);
  const match = readdirSync(dir).find(
    (f) => f.includes(`latin`) && f.includes(`-${weight}-${style}.woff2`)
  );
  if (!match) throw new Error(`Font not found: ${pkg} weight=${weight} style=${style}`);
  return join(dir, match);
}

const copies = [
  [findFont("@fontsource/oswald", "700"), "oswald-700.woff2"],
  [findFont("@fontsource/inter", "400"), "inter-400.woff2"],
  [findFont("@fontsource/inter", "500"), "inter-500.woff2"],
];

for (const [src, dst] of copies) {
  copyFileSync(src, join(dest, dst));
  console.log(`  copied ${dst}`);
}
