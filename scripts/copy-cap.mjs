import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dest = join(root, "public", "js", "cap");
mkdirSync(dest, { recursive: true });

// WASM wird selbst ausgeliefert (kein CDN-Abruf durch Besucher), Version muss zur Widget-Version passen.
copyFileSync(join(root, "node_modules/@cap.js/widget/cap.min.js"), join(dest, "cap.min.js"));
for (const f of ["cap_wasm_bg.wasm", "hashwx.wasm"]) copyFileSync(join(root, "node_modules/@cap.js/wasm/browser", f), join(dest, f));
console.log("  copied Cap widget + WASM");
