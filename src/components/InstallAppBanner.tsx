import { FC, useEffect, useState } from 'react';
import { Download, X, Loader2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * InstallAppBanner — the visible way to install the app (owner report
 * 2026-11-10: "boostpay.online/app e gale install ase na").
 *
 * Chrome removed its automatic install mini-infobar years ago: unless the app
 * itself calls `beforeinstallprompt.prompt()`, the only install path is the
 * browser menu — which most users never find. So /app now ASKS: a small strip
 * with an Install button that triggers the native sheet, and, when the browser
 * refuses a programmatic prompt (iOS Safari, in-app browsers, a prompt the user
 * already dismissed), falls back to the existing step-by-step help sheet.
 *
 * It never shows inside the installed app, and a dismissal is remembered for a
 * day so it cannot nag.
 */
export const InstallAppBanner: FC<{ className?: string }> = ({ className = '' }) => {
  const { isInstalled, isInstallLoading, install } = usePWAInstall();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  // remember a dismissal (a day), and never show it once installed
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem('boostpay_install_banner_dismissed') || 0);
      if (at && Date.now() - at < 24 * 60 * 60 * 1000) setHidden(true);
    } catch { /* private mode */ }
  }, []);

  if (isInstalled || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem('boostpay_install_banner_dismissed', String(Date.now())); } catch { /* ignore */ }
  };

  const onInstall = async () => {
    setBusy(true);
    try { await install(); } finally { setBusy(false); }
  };

  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-amber-500/5 px-3 py-2.5 ${className}`}
      role="region"
      aria-label="Install the BoostPay app"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-zinc-950">
        <Download className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-bold leading-tight text-white">Install the BoostPay app</div>
        <div className="text-[9.5px] leading-tight text-amber-200/80">Full screen, one tap away — no browser bar.</div>
      </div>
      <button
        onClick={() => void onInstall()}
        disabled={busy || isInstallLoading}
        className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-[11px] font-black text-zinc-950 transition hover:bg-amber-400 disabled:opacity-60"
      >
        {(busy || isInstallLoading) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-amber-200/60 hover:text-white">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default InstallAppBanner;
