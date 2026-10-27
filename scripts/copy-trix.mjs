import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = join(root, "node_modules", "trix", "dist");
const jsDest = join(root, "public", "js");
const cssDest = join(root, "public", "css");

for (const d of [jsDest, cssDest]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

copyFileSync(join(pkg, "trix.umd.min.js"), join(jsDest, "trix.min.js"));
copyFileSync(join(pkg, "trix.css"), join(cssDest, "trix.css"));
console.log("  copied trix JS + CSS");
