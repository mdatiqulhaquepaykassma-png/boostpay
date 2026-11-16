/* The installable PWA opens /app. Workbox's navigation fallback intentionally
 * excludes that URL so its special manifest keeps working. Cache only this
 * public HTML shell, never API responses or financial requests. */
(function () {
  const CACHE = 'boostpay-pwa-app-shell-v1';
  const APP_PATH = '/app';
  const TIMEOUT_MS = 8000;

  async function saveShell(response) {
    if (!response || response.status !== 200 || response.redirected ||
        !(response.headers.get('content-type') || '').includes('text/html')) return;
    // Do not save an error/challenge page that happens to return HTTP 200.
    const html = await response.clone().text();
    if (!html.includes('/app/manifest.json')) return;
    const cache = await caches.open(CACHE);
    await cache.put(APP_PATH, response.clone());
  }

  self.addEventListener('install', function (event) {
    // Prime the installed entry on a good connection; a failed prime must not
    // prevent Workbox or push notifications from installing/updating.
    event.waitUntil(fetch(APP_PATH, { cache: 'no-store' }).then(saveShell).catch(function () {}));
  });

  self.addEventListener('fetch', function (event) {
    const req = event.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || req.mode !== 'navigate' || url.origin !== self.location.origin ||
        (url.pathname !== APP_PATH && url.pathname !== APP_PATH + '/')) return;

    event.respondWith((async function () {
      const controller = new AbortController();
      const timeout = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      try {
        const response = await fetch(req, { signal: controller.signal });
        if (response.ok) {
          await saveShell(response.clone()).catch(function () {});
          return response;
        }
        // A temporary server/gateway error may still have a usable local shell.
        if (response.status < 500) return response;
      } catch (_) {
        // Connectivity changed or the network stalled. Only the app shell is cached.
      } finally {
        clearTimeout(timeout);
      }
      const cached = await (await caches.open(CACHE)).match(APP_PATH);
      if (cached) return cached;
      return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>BoostPay</title></head><body style="background:#09090b;color:#fafafa;font:16px system-ui;padding:24px"><h2>Connection unavailable</h2><p>Connect to the internet, then try again. Transactions require a live connection.</p><button onclick="location.reload()" style="padding:12px">Try again</button></body></html>', {
        status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    })());
  });
})();
