// Bump this string on every deploy — it's what forces old cached assets to be
// dropped and lets a new index.html reach an already-installed phone with no
// reinstall. (See CLAUDE.md "Deploying".)
const CACHE_VERSION = "spitiko-merged-2026-10-16-1";

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./catalog.json",
  "./tasks.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts, future backend calls — untouched

  const isShell = req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/";

  if (isShell) {
    // network-first: always try to get the latest deploy; fall back to cache offline
    e.respondWith(
      fetch(req)
        .then(res => {
          caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  // cache-first for everything else (icons, manifest, catalog, fonts) — refreshed
  // automatically whenever CACHE_VERSION bumps and the old cache gets dropped
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res.ok) caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
        return res;
      });
    })
  );
});
