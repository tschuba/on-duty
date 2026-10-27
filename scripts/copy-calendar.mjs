import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = join(root, "node_modules", "vanilla-calendar-pro");
const jsDest = join(root, "public", "js");
const cssDest = join(root, "public", "css");

for (const d of [jsDest, cssDest]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

copyFileSync(join(pkg, "index.mjs"), join(jsDest, "vanilla-calendar.min.js"));
copyFileSync(join(pkg, "styles", "index.css"), join(cssDest, "vanilla-calendar.css"));
console.log("  copied vanilla-calendar-pro JS + CSS");
