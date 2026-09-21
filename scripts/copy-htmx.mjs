import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const root = fileURLToPath(new URL("..", import.meta.url));
const dest = join(root, "public", "js");
const out = join(dest, "htmx.min.js");

if (existsSync(out)) {
  console.log("  htmx.min.js already exists, skipping");
  process.exit(0);
}

if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

const url = "https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js";
get(url, (res) => {
  if (res.statusCode === 301 || res.statusCode === 302) {
    get(res.headers.location, download);
    return;
  }
  download(res);
});

function download(res) {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => {
    writeFileSync(out, Buffer.concat(chunks));
    console.log(`  copied htmx.min.js (${Buffer.concat(chunks).length} bytes)`);
  });
}
