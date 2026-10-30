import { useEffect, useState } from 'react';
import {
  currentSubscription,
  disablePush,
  dismissPrompt,
  enablePush,
  permissionState,
  promptDismissed,
  pushSupported,
  refreshPushSilently,
  sendTestPush,
} from './pushClient';

/**
 * Floating "turn notifications on" card.
 * Rendered after sign-in (needs the account token to attach the device).
 * Hidden for good once the user says "not now" — the same switch is reachable
 * again from this card after a fresh install.
 */
export function PushOptIn({ accent = 'amber' }: { accent?: 'amber' | 'cyan' | 'emerald' }) {
  const [state, setState] = useState<'loading' | 'unsupported' | 'off' | 'on' | 'denied'>('loading');
  const [hidden, setHidden] = useState(() => promptDismissed());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pushSupported()) return setState('unsupported');
      if (permissionState() === 'denied') return setState('denied');
      const sub = await currentSubscription();
      if (!alive) return;
      setState(sub ? 'on' : 'off');
      if (sub) void refreshPushSilently(); // keeps the server copy fresh per account
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading' || state === 'unsupported') return null;
  if (state === 'off' && hidden) return null;
  if (state === 'on' && !open) {
    // already on: keep a tiny badge so the user can send a test / turn it off
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Notification settings"
        style={{ position: 'fixed', right: 12, bottom: 88, zIndex: 60 }}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/15 text-[13px] shadow-lg backdrop-blur"
      >
        🔔
      </button>
    );
  }

  const tone =
    accent === 'cyan'
      ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200'
      : accent === 'emerald'
        ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
        : 'border-amber-500/40 bg-amber-950/40 text-amber-200';

  const turnOn = async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await enablePush();
      if (res === 'granted') {
        setState('on');
        setOpen(true);
        setNote('Notifications on — this phone now gets alerts with the app closed.');
      } else if (res === 'denied') {
        setState('denied');
        setNote('Blocked. Allow notifications for this site in your browser settings, then reload.');
      } else {
        setState('off');
      }
    } catch (err: any) {
      setNote(err?.message || 'Could not turn notifications on.');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setNote('');
    try {
      const n = await sendTestPush();
      setNote(`Test sent to ${n} device${n === 1 ? '' : 's'}. Lock the phone to see it arrive.`);
    } catch (err: any) {
      setNote(err?.message || 'Test failed.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setNote('');
    try {
      await disablePush();
      setState('off');
      setOpen(false);
      setNote('Notifications turned off for this device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', left: 10, right: 10, bottom: 84, zIndex: 60, maxWidth: 410, margin: '0 auto' }}
      className={`rounded-2xl border px-3 py-2.5 shadow-xl backdrop-blur ${tone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold">🔔 {state === 'on' ? 'Notifications are on' : 'Get alerts when the app is closed'}</p>
          <p className="mt-0.5 text-[10px] leading-snug opacity-80">
            {state === 'denied'
              ? 'Blocked in browser settings — allow notifications for this site.'
              : state === 'on'
                ? 'New messages and payment alerts reach this phone even when the app is shut.'
                : 'Turn on push so new messages reach this phone even with the app closed.'}
          </p>
          {note && <p className="mt-1 text-[10px] font-semibold opacity-90">{note}</p>}
        </div>
        <button
          onClick={() => { setOpen(false); setHidden(true); dismissPrompt(); }}
          aria-label="Close"
          className="shrink-0 rounded-lg border border-white/15 px-1.5 py-0.5 text-[10px] font-bold opacity-70"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {state !== 'on' ? (
          <button
            onClick={turnOn}
            disabled={busy || state === 'denied'}
            className="flex-1 rounded-xl bg-white/90 px-3 py-1.5 text-[11px] font-black text-zinc-950 disabled:opacity-50"
          >
            {busy ? '…' : 'Turn on'}
          </button>
        ) : (
          <>
            <button onClick={runTest} disabled={busy} className="flex-1 rounded-xl bg-white/90 px-3 py-1.5 text-[11px] font-black text-zinc-950 disabled:opacity-50">
              {busy ? '…' : 'Send test'}
            </button>
            <button onClick={turnOff} disabled={busy} className="rounded-xl border border-white/25 px-3 py-1.5 text-[11px] font-bold opacity-90 disabled:opacity-50">
              Turn off
            </button>
          </>
        )}
        {state !== 'on' && (
          <button
            onClick={() => { setOpen(false); setHidden(true); dismissPrompt(); }}
            className="rounded-xl border border-white/25 px-3 py-1.5 text-[11px] font-bold opacity-80"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}

export default PushOptIn;
