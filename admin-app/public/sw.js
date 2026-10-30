// BoostPay Progressive Web App Service Worker
const CACHE_NAME = 'boostpay-admin-shell-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/pwa-192x192.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('PWA core asset precache non-fatal error:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API requests, chat SSE streams, or non-GET requests
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/stream')
  ) {
    return;
  }

  // Network-first strategy with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful basic responses for static assets
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic' &&
          /\.(png|svg|ico|jpg|jpeg|webp|gif|woff|woff2|css|js)$/i.test(url.pathname)
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      })
  );
});

// ---------------------------------------------------------------------------
// Web Push — arrives while the app is CLOSED (the browser wakes this worker)
// ---------------------------------------------------------------------------
const notifIcon = '/pwa-192x192.png';
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'BoostPay', body: event.data ? event.data.text() : '' };
  }
  const isCall = payload.kind === 'incoming_call';
  const title = payload.title || 'BoostPay';
  const options = {
    body: payload.body || '',
    icon: notifIcon,
    badge: notifIcon,
    tag: payload.tag || 'boostpay',
    renotify: true,
    // A ringing phone must not be silenced by another message in the same app.
    requireInteraction: !!isCall,
    silent: false,
    vibrate: isCall ? [400, 200, 400, 200, 400] : [80, 40, 80],
    data: {
      url: payload.url || '/',
      timestamp: payload.timestamp || Date.now(),
      kind: payload.kind || '',
      callId: payload.callId || '',
      from: payload.from || '',
      media: payload.media || ''
    },
  };
  if (isCall) {
    // Answer/Decline where the platform supports notification actions (Android /
    // desktop Chrome). iOS shows the body only; tapping opens the app, which then
    // picks the call up from /api/chat/call-pending.
    options.actions = [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' }
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // Declining from the notification: tell the caller the call is over, then stop.
  if (event.action === 'decline' && data.callId) {
    event.waitUntil((async () => {
      try {
        const token = await readToken();
        if (token) {
          await fetch('/api/chat/call-signal', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ targetId: data.from, signal: { kind: 'reject', callId: data.callId } })
          });
        }
      } catch {
        /* the caller's own 45 s timeout ends the ring anyway */
      }
    })());
    return;
  }

  const target = data.url || '/';
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

/** Auth token mirrored into IndexedDB by the app (the worker cannot read localStorage). */
function readToken() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('bpsup', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
      };
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
    } catch {
      resolve('');
    }
  });
}

// Browsers occasionally rotate a subscription; register the new one silently.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/push/key');
        const { publicKey } = await res.json();
        const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
        const key = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const token = await new Promise((resolve) => {
          const req = indexedDB.open('bpsup', 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
          };
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
