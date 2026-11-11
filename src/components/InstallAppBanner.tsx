import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Download, X, Loader2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * InstallAppBanner — one tap, the browser's own install sheet, nothing else.
 *
 * Owner rule (2026-11-10): "no popup, direct install". So this button NEVER
 * opens a dialog of ours. It calls the native `beforeinstallprompt.prompt()`
 * — Chrome/Edge/Android then show their own install sheet. If the browser has
 * not handed us the prompt yet, we wait for it silently (the tap is remembered
 * as intent) and fire it the moment it arrives. Only when the platform can never
 * install from a button (iOS Safari, an in-app browser) does the text change,
 * inline, to the exact two-tap instruction — still no overlay.
 */
const hintFor = (isIOS: boolean) =>
  isIOS
    ? 'Safari: tap Share ⬆️ → "Add to Home Screen" → Add.'
    : 'Chrome: ⋮ menu → "Install app" (or "Add to Home screen").';

export const InstallAppBanner: FC<{ className?: string }> = ({ className = '' }) => {
  const { isInstalled, isIOS, installDirect, hasNativePrompt } = usePWAInstall();
  const [hidden, setHidden] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [hint, setHint] = useState('');
  const intent = useRef(false);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem('boostpay_install_banner_dismissed') || 0);
      if (at && Date.now() - at < 24 * 60 * 60 * 1000) setHidden(true);
    } catch { /* private mode */ }
  }, []);

  // the tap asked for an install; the browser's prompt can arrive a moment later
  useEffect(() => {
    if (!intent.current || !hasNativePrompt) return;
    intent.current = false;
    setWaiting(false);
    void installDirect();
  }, [hasNativePrompt, installDirect]);

  const run = useCallback(async () => {
    setHint('');
    intent.current = true;
    setWaiting(true);
    const result = await installDirect();
    if (result === 'PROMPTED') { setWaiting(false); return; }

    // give the browser a few seconds to hand us the prompt (cold start on a
    // phone), then explain inline — never as a popup
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!intent.current) return;                 // the effect above fired it
    }
    intent.current = false;
    setWaiting(false);
    setHint(hintFor(isIOS));
  }, [installDirect, isIOS]);

  if (isInstalled || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem('boostpay_install_banner_dismissed', String(Date.now())); } catch { /* ignore */ }
  };

  return (
    <div
      className={`rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-amber-500/5 px-3 py-2.5 ${className}`}
      role="region"
      aria-label="Install the BoostPay app"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-zinc-950">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-bold leading-tight text-white">Install the BoostPay app</div>
          <div className="text-[9.5px] leading-tight text-amber-200/80">Full screen, one tap away — no browser bar.</div>
        </div>
        <button
          onClick={() => void run()}
          disabled={waiting}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-[11px] font-black text-zinc-950 transition hover:bg-amber-400 disabled:opacity-70"
        >
          {waiting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Install
        </button>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-amber-200/60 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {hint && (
        <p className="mt-2 rounded-xl bg-black/30 px-2.5 py-1.5 text-[9.5px] leading-snug text-amber-100/90" role="status">
          {hint}
        </p>
      )}
    </div>
  );
};

export default InstallAppBanner;
