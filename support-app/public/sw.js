// BoostPay Support Chat — shell cache + Web Push receiver.
// Push notifications are the whole point of this worker: they arrive with the
// app CLOSED (the browser's push service wakes this worker), which an SSE
// connection or a polling timer can never do.
const CACHE = 'boostpay-support-shell-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['/', '/manifest.json', '/icon.svg']))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'BoostPay Support', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'BoostPay Support';
  const options = {
    body: payload.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || 'boostpay-support',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url: payload.url || '/', timestamp: payload.timestamp || Date.now() },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an open tab if there is one, otherwise it
// opens the console at the requested screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          try {
            client.navigate(target).catch(() => {});
          } catch {
            /* older browsers: just focus */
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});

// Some browsers rotate the subscription; keep the server in sync automatically.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/push/key');
        const { publicKey } = await res.json();
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        const token = await new Promise((resolve) => {
          const req = indexedDB.open('bpsup', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => {
            try {
              const tx = req.result.transaction('kv', 'readonly');
              const get = tx.objectStore('kv').get('token');
              get.onsuccess = () => resolve(get.result || '');
              get.onerror = () => resolve('');
            } catch {
              resolve('');
            }
          };
          req.onerror = () => resolve('');
        });
        if (token) {
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ subscription: sub.toJSON() }),
          });
        }
      } catch {
        /* the app re-subscribes on next open anyway */
      }
    })()
  );
});
