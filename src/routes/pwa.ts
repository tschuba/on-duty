import { readFileSync } from "node:fs";
import { Hono } from "hono";

// package.json liegt in Dev und im Docker-Image (WORKDIR /app) im cwd.
const APP_VERSION: string = JSON.parse(readFileSync("package.json", "utf8")).version;

// Cache name follows the app version, so every release installs a fresh worker and drops the old cache.
// Only static assets are cached (network-first); pages, HTMX fragments and auth always hit the network.
const script = `const CACHE = "on-duty-${APP_VERSION}";
const PRECACHE = ["/offline.html", "/icon-192.png"];
const STATIC = /^\\/(css|js|fonts)\\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (request.mode === "navigate") {
    e.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  } else if (STATIC.test(url.pathname)) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request)),
    );
  }
});
`;

export const pwaRoutes = new Hono();

// no-cache: browsers must revalidate the worker script so releases roll out promptly.
pwaRoutes.get("/sw.js", (c) => {
  c.header("Content-Type", "text/javascript; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  return c.body(script);
});
