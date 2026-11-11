// Promotion console service worker.
// The app shell is cached so the PWA opens instantly, but the HTML must never be
// stale — a cached index.html pins the browser to an old JS bundle, which is how
// new console options "disappear" after a deploy. So: network-first for the shell,
// cache-first only for the hashed assets (their names change on every build).
// API calls always go to the network (promotion data must be live).
const CACHE = 'bp-promo-v2';
const SHELL = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return; // never cache money data
  // HTML / navigation: always try the network first, fall back to the cache offline.
  const isShell = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (isShell) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  // Hashed build assets: cache-first is safe, the filename changes with the build.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('/')))
  );
});
