// Web Push enrolment for the support console.
// Notifications must work with the app CLOSED, so this registers the service
// worker, asks the browser for permission and stores the device subscription on
// the staff account (the API then pushes new user messages to it).
import { auth } from './api';

const TOKEN_DB = 'bpsup';
const TOKEN_STORE = 'kv';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied' | 'error';

function b64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The service worker cannot read localStorage, so it gets the token through IndexedDB
 *  (used only when a subscription rotates in the background). */
function mirrorTokenForWorker(token: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(TOKEN_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(TOKEN_STORE)) req.result.createObjectStore(TOKEN_STORE);
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(TOKEN_STORE, 'readwrite');
          tx.objectStore(TOKEN_STORE).put(token, 'token');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function permissionState(): PushState {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushState;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await registration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Ask permission (must be triggered by a tap) and store the subscription server-side. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  const keyRes = await fetch('/api/push/key');
  if (!keyRes.ok) throw new Error('Push notifications are not available right now.');
  const { publicKey } = await keyRes.json();

  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(publicKey),
    }));

  const token = auth.token();
  if (token) await mirrorTokenForWorker(token);

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token || ''}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || 'Could not save this device for notifications.');
  }
  return 'granted';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token() || ''}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    /* offline: the endpoint is pruned by the server on the next 404/410 anyway */
  }
  try {
    await sub.unsubscribe();
  } catch {
    /* ignore */
  }
}

/** Re-register silently when permission is already granted (new device / rotated key). */
export async function refreshPushSilently(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const sub = await currentSubscription();
    if (sub) {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token() || ''}` },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
    }
  } catch {
    /* non-fatal */
  }
}

export async function sendTestPush(): Promise<number> {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token() || ''}` },
    body: '{}',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Test notification failed.');
  return Number(data && data.devices) || 0;
}
