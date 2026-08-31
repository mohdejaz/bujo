/* Offline shell. Registered only over HTTPS/localhost (see app.js) — on a
 * plain-HTTP LAN address iOS refuses to install a service worker anyway.
 *
 * CACHE is stamped with the commit SHA at deploy time (see
 * .github/workflows/pages.yml), so every deploy gets a fresh cache and users
 * pick up changes on next launch. Locally the literal placeholder is used.
 *
 * The journal itself lives in localStorage, not here; this cache only holds
 * the files that make up the app, so a bad cache can never lose data.
 */
const CACHE = "bujo-shell-__BUILD_ID__";
const SHELL = [
  ".",
  "index.html",
  "styles.css?v=__BUILD_ID__",
  "app.js?v=__BUILD_ID__",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/* Cache-first for instant cold starts, with a background refresh so the next
   launch picks up a redeploy. */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((hit) => {
        const net = fetch(e.request)
          .then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});
