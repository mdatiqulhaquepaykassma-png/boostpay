import { FC } from 'react';
import { X, Share, Menu, Smartphone, MonitorUp, ExternalLink } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * Step-by-step manual install guidance, shown automatically when the browser
 * offers no native install prompt (iOS Safari, in-app browsers, iframes, or
 * a previously dismissed prompt). One modal serves every install button.
 */
export const PWAInstallHelp: FC = () => {
  const { installHelpMode, closeInstallHelp, isIOS } = usePWAInstall();

  if (!installHelpMode) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 pb-8 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Install BoostPay</h3>
              <p className="text-[11px] text-zinc-400">
                {installHelpMode === 'ios'
                  ? 'iPhone / iPad এ ইনস্টল করার নিয়ম'
                  : installHelpMode === 'iframe'
                    ? 'Open in your browser first'
                    : 'Browser menu থেকে ইনস্টল করুন'}
              </p>
            </div>
          </div>
          <button
            onClick={closeInstallHelp}
            className="text-zinc-500 hover:text-white p-1 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {installHelpMode === 'ios' && (
          <ol className="space-y-2.5 text-xs text-zinc-300">
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">1</span>
              <span>
                নিচের <strong className="text-amber-400">Share</strong> বাটনে ট্যাপ করুন
                <Share className="inline w-3.5 h-3.5 mx-1 text-amber-400" />
                (Safari toolbar-এর মাঝের আইকন)
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">2</span>
              <span>
                তালিকা থেকে <strong className="text-white">“Add to Home Screen”</strong> বেছে নিন
                <span className="text-zinc-500">(নিচে স্ক্রল করতে হতে পারে)</span>
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">3</span>
              <span>
                উপরে-ডানে <strong className="text-white">“Add”</strong> চাপুন — BoostPay আইকন হোম স্ক্রিনে যোগ হবে 🎉
              </span>
            </li>
          </ol>
        )}

        {installHelpMode === 'manual' && (
          <ol className="space-y-2.5 text-xs text-zinc-300">
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">1</span>
              <span>
                Chrome-এর <strong className="text-amber-400">⋮ menu</strong>
                <Menu className="inline w-3.5 h-3.5 mx-1 text-amber-400" />
                ট্যাপ করুন (উপরে-ডানে)
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">2</span>
              <span>
                <strong className="text-white">“Install app”</strong> অথবা
                <strong className="text-white">“Add to Home screen”</strong> বেছে নিন
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 font-bold text-[10px]">3</span>
              <span>
                <strong className="text-white">“Install”</strong> চাপুন — অ্যাপটি হোম স্ক্রিনে যোগ হবে 🎉
              </span>
            </li>
          </ol>
        )}

        {installHelpMode === 'iframe' && (
          <div className="space-y-3 text-xs text-zinc-300">
            <p className="flex items-start gap-2">
              <MonitorUp className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                ইনস্টল করতে হলে অ্যাপটিকে আপনার ব্রাউজারে খুলতে হবে — এমবেড করা উইন্ডোতে ব্রাউজার ইনস্টল ব্লক করে।
              </span>
            </p>
            <a
              href={typeof window !== 'undefined' ? window.location.href : '/'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeInstallHelp}
              className="flex items-center justify-center gap-2 w-full h-11 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              Open in Browser
            </a>
          </div>
        )}

        {!isIOS && installHelpMode !== 'iframe' && (
          <p className="mt-3 text-[10px] text-zinc-500 leading-relaxed">
            Tip: সরাসরি ব্রাউজারে (এমবেড না) খুললে এবং HTTPS ডোমেইনে গেলে এক ট্যাপেই ইনস্টল প্রম্পট আসবে।
          </p>
        )}
      </div>
    </div>
  );
};
