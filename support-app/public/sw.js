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
const notifIcon = '/icon.svg';
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
