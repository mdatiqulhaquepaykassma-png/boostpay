// ---------------------------------------------------------------------------
// Web Push client (shared by every app: user · agent · management · admin)
// ---------------------------------------------------------------------------
// A closed app can only be woken by the browser's push service, so each device
// registers once with PushManager + the VAPID public key and the subscription is
// stored on the signed-in account. The server then pushes chat messages and
// notifications to that account's devices.
//
// This file is intentionally dependency-free and duplicated into each app bundle
// (the apps are four separate builds with their own domains).
// ---------------------------------------------------------------------------

const TOKEN_KEYS = ['boostpay_auth_token_v1', 'bpa_token_v1', 'bpm_token_v1', 'bpsup_token'];
const PROMPT_KEY = 'bp_push_prompt_v1';
const TOKEN_DB = 'bpsup';
const TOKEN_STORE = 'kv';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied' | 'error';

export function authToken(): string {
  try {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
  } catch {
    /* private mode */
  }
  return '';
}

function b64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The service worker cannot read localStorage, so it gets the token through
 *  IndexedDB (only used when a subscription rotates in the background). */
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

export function promptDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function dismissPrompt(): void {
  try {
    localStorage.setItem(PROMPT_KEY, 'dismissed');
  } catch {
    /* ignore */
  }
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

/** Save (or refresh) this device on the signed-in account. */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const token = authToken();
  if (token) await mirrorTokenForWorker(token);
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || 'Could not save this device for notifications.');
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
  await saveSubscription(sub);
  return 'granted';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken()}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    /* offline: the server prunes dead endpoints on the next 404/410 */
  }
  try {
    await sub.unsubscribe();
  } catch {
    /* ignore */
  }
}

/** Re-register silently when permission is already granted (new login / new device). */
export async function refreshPushSilently(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  if (!authToken()) return;
  try {
    const sub = await currentSubscription();
    if (sub) await saveSubscription(sub);
  } catch {
    /* non-fatal */
  }
}

export async function sendTestPush(): Promise<number> {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken()}` },
    body: '{}',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Test notification failed.');
  return Number(data && data.devices) || 0;
}
