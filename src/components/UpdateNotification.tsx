import { FC, useState, useEffect } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';

export const UpdateNotification: FC = () => {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [initialVersion, setInitialVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 1. Fetch initial version
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.version) {
          setInitialVersion(data.version);
        }
      })
      .catch(() => {});

    // 2. Poll for updates/deployments every 12 seconds
    const interval = setInterval(() => {
      fetch('/api/version')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.version && initialVersion) {
            if (data.version !== initialVersion) {
              setHasUpdate(true);
            }
          }
        })
        .catch(() => {});
    }, 12000);

    // 3. Listen for Service Worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setHasUpdate(true);
      });
    }

    return () => clearInterval(interval);
  }, [initialVersion]);

  const handleReload = () => {
    // Reload directly to fetch latest deployed bundle
    window.location.reload();
  };

  if (!hasUpdate || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-5 duration-300">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-zinc-900/95 p-3.5 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="text-left">
            <div className="text-xs font-bold text-white">New update available</div>
            <div className="text-[11px] text-zinc-400">
              A fresh update has been deployed. Reload to apply.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReload}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-400 active:scale-95 cursor-pointer shadow-md shadow-amber-500/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Reload</span>
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-lg p-1 text-zinc-400 transition hover:text-white cursor-pointer"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
