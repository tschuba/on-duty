import { copyFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const nm = join(root, "node_modules");
const jsDest = join(root, "public", "js");
const cssDest = join(root, "public", "css");

for (const d of [jsDest, cssDest]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const lf = join(nm, "leaflet", "dist");
copyFileSync(join(lf, "leaflet.js"), join(jsDest, "leaflet.min.js"));
copyFileSync(join(lf, "leaflet.css"), join(cssDest, "leaflet.css"));
// leaflet.css references images/ relative to itself (layer/marker icons, controls)
cpSync(join(lf, "images"), join(cssDest, "images"), { recursive: true });

const mc = join(nm, "leaflet.markercluster", "dist");
copyFileSync(join(mc, "leaflet.markercluster.js"), join(jsDest, "leaflet.markercluster.min.js"));
copyFileSync(join(mc, "MarkerCluster.css"), join(cssDest, "MarkerCluster.css"));
copyFileSync(join(mc, "MarkerCluster.Default.css"), join(cssDest, "MarkerCluster.Default.css"));
console.log("  copied leaflet + markercluster");
