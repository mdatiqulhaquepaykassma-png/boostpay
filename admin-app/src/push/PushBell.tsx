import { useEffect, useState } from 'react';
import {
  currentSubscription,
  disablePush,
  enablePush,
  permissionState,
  pushSupported,
  refreshPushSilently,
  sendTestPush,
} from './pushClient';

/**
 * 🔔 notification button that sits inside the chat screen (the floating card was
 * removed on request). Tapping it opens a small sheet: turn push on, send a test,
 * or turn it off for this device. The dot turns green when this phone is enrolled.
 */
export function PushBell({ className = '' }: { className?: string }) {
  const [state, setState] = useState<'loading' | 'unsupported' | 'off' | 'on' | 'denied'>('loading');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pushSupported()) return setState('unsupported');
      if (permissionState() === 'denied') return setState('denied');
      const sub = await currentSubscription();
      if (!alive) return;
      setState(sub ? 'on' : 'off');
      if (sub) void refreshPushSilently();
    })();
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await enablePush();
      if (res === 'granted') {
        setState('on');
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
      setNote('Notifications turned off for this device.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'unsupported') return null;
  const on = state === 'on';

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setNote(''); }}
        title={on ? 'Notifications are on' : 'Turn on notifications'}
        aria-label="Notifications"
        className={`relative flex items-center justify-center rounded-2xl border min-h-[44px] px-3 transition cursor-pointer ${
          on
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-zinc-800 bg-zinc-900 text-amber-400 hover:text-amber-300 hover:border-amber-500/40'
        } ${className}`}
      >
        <span className="text-[15px] leading-none">🔔</span>
        <span
          className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-zinc-600'}`}
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[430px] rounded-t-3xl border border-zinc-800 bg-zinc-900 p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Notifications</div>
                <div className="mt-1 text-sm font-black text-white">
                  {on ? '🔔 Alerts are on for this phone' : 'Get alerts when the app is closed'}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] font-bold text-zinc-400"
              >
                ✕
              </button>
            </div>

            <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
              {state === 'denied'
                ? 'Notifications are blocked for this site. Open your browser settings → Notifications → Allow for this site, then reload.'
                : on
                  ? 'New messages and money alerts reach this phone even when the app is completely closed.'
                  : 'Turn on push so new messages and money alerts reach this phone even with the app closed.'}
            </p>

            {note && (
              <p className="mb-3 rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-[11px] font-semibold text-zinc-300">
                {note}
              </p>
            )}

            <div className="flex gap-2">
              {!on ? (
                <button
                  onClick={turnOn}
                  disabled={busy || state === 'denied' || state === 'loading'}
                  className="h-11 flex-1 rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 disabled:opacity-60"
                >
                  {busy ? '…' : 'Turn on notifications'}
                </button>
              ) : (
                <>
                  <button
                    onClick={runTest}
                    disabled={busy}
                    className="h-11 flex-1 rounded-2xl bg-amber-500 text-xs font-black text-zinc-950 disabled:opacity-60"
                  >
                    {busy ? '…' : 'Send test'}
                  </button>
                  <button
                    onClick={turnOff}
                    disabled={busy}
                    className="h-11 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 text-xs font-bold text-zinc-300 disabled:opacity-60"
                  >
                    Turn off
                  </button>
                </>
              )}
            </div>
            <p className="mt-3 text-center text-[9px] leading-relaxed text-zinc-600">
              iPhone: iOS 16.4+ and the app must be added to the Home Screen.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default PushBell;
