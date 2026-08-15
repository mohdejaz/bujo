/* sw.js - app-shell cache for offline use.
 *
 * Only registered over HTTPS/localhost (see app.js). On the Mac-LAN (plain
 * HTTP) setup it never runs; it's here so a later GitHub Pages (HTTPS) deploy
 * gives real offline + install with no code changes.
 */
const CACHE = "bujo-shell-v1";
const SHELL = [
  ".",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/bujo.js",
  "js/storage.js",
  "vendor/sql-wasm.js",
  "vendor/sql-wasm.wasm",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
