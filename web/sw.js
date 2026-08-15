/* sw.js - app-shell cache for offline use.
 *
 * Only registered over HTTPS/localhost (see app.js). On the Mac-LAN (plain
 * HTTP) setup it never runs; it's here so the GitHub Pages (HTTPS) deploy
 * gives real offline + install.
 *
 * CACHE is stamped with the commit SHA at deploy time (see
 * .github/workflows/pages.yml). A new deploy => new cache name => the SW
 * updates and re-fetches the shell, so users pick up changes on next launch.
 * Locally the literal "__BUILD_ID__" placeholder is used, which is fine.
 */
const CACHE = "bujo-shell-__BUILD_ID__";
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

// Stale-while-revalidate: serve from cache instantly (fast + offline), but
// refresh the cached copy from the network in the background so the next load
// is current even between version bumps.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((hit) => {
        const network = fetch(e.request)
          .then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    )
  );
});
