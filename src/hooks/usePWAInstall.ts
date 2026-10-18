import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Preserve global prompt instance across re-renders / re-mounts
declare global {
  interface Window {
    __boostpay_pwa_prompt?: BeforeInstallPromptEvent | null;
  }
}

export type InstallHelpMode = 'ios' | 'manual' | 'iframe';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== 'undefined' && window.__boostpay_pwa_prompt) {
      return window.__boostpay_pwa_prompt;
    }
    return null;
  });

  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return isStandalone;
  });

  const [isInstallLoading, setIsInstallLoading] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isIframe, setIsIframe] = useState(false);

  // Manual-install guidance (shown when the browser offers no native prompt)
  const [installHelpMode, setInstallHelpMode] = useState<InstallHelpMode | null>(null);

  useEffect(() => {
    // Check true standalone display mode
    const checkStandalone = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandalone);
    };

    checkStandalone();

    // Detect mobile OS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    // Detect if running inside an iframe (such as an embedded preview)
    try {
      setIsIframe(window.self !== window.top);
    } catch {
      setIsIframe(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent automatic mini-infobar so our in-app install button controls the prompt
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__boostpay_pwa_prompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setJustInstalled(true);
      window.__boostpay_pwa_prompt = null;
      setDeferredPrompt(null);
      setTimeout(() => setJustInstalled(false), 4000);
    };

    const handlePromptReady = (e: any) => {
      const pe = e.detail || window.__boostpay_pwa_prompt;
      if (pe) {
        setDeferredPrompt(pe);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('boostpay_pwa_ready', handlePromptReady);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Initial check for already captured prompt
    if (window.__boostpay_pwa_prompt) {
      setDeferredPrompt(window.__boostpay_pwa_prompt);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('boostpay_pwa_ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  /**
   * One-click direct native browser install prompt with zero guides or popups
   * Directly triggers Chrome's native Add to Home screen dialog
   */
  const install = useCallback(async (): Promise<boolean> => {
    let promptEvent = deferredPrompt || window.__boostpay_pwa_prompt;

    // Inside an embedded preview the browser blocks install prompts entirely —
    // open a real top-level tab (where install works) and explain why.
    if (!promptEvent && !isInstalled && typeof window !== 'undefined' && window.self !== window.top) {
      try {
        window.open(window.location.href, '_blank');
      } catch {
        // Popup blocked — fall through to guidance
      }
      setInstallHelpMode('iframe');
      return false;
    }

    // If deferredPrompt is not yet caught (e.g. Chrome on Android is still parsing manifest/SW),
    // wait with a fast poll and listener for up to 2500ms
    if (!promptEvent && !isInstalled) {
      setIsInstallLoading(true);
      promptEvent = await new Promise<BeforeInstallPromptEvent | null>((resolve) => {
        let finished = false;

        const checkPrompt = () => {
          if (window.__boostpay_pwa_prompt) {
            cleanup();
            resolve(window.__boostpay_pwa_prompt);
            return true;
          }
          return false;
        };

        const handler = (e: Event) => {
          if (!finished) {
            e.preventDefault();
            const pe = e as BeforeInstallPromptEvent;
            window.__boostpay_pwa_prompt = pe;
            setDeferredPrompt(pe);
            cleanup();
            resolve(pe);
          }
        };

        const readyHandler = (e: any) => {
          if (!finished) {
            const pe = e.detail || window.__boostpay_pwa_prompt;
            cleanup();
            resolve(pe);
          }
        };

        const cleanup = () => {
          finished = true;
          window.removeEventListener('beforeinstallprompt', handler);
          window.removeEventListener('boostpay_pwa_ready', readyHandler);
          clearInterval(pollInterval);
          clearTimeout(timeout);
        };

        window.addEventListener('beforeinstallprompt', handler);
        window.addEventListener('boostpay_pwa_ready', readyHandler);
        const pollInterval = setInterval(checkPrompt, 80);

        const timeout = setTimeout(() => {
          if (!finished) {
            cleanup();
            resolve(window.__boostpay_pwa_prompt || null);
          }
        }, 2500);
      });
      setIsInstallLoading(false);
    }

    if (promptEvent) {
      try {
        setIsInstallLoading(true);
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        setIsInstallLoading(false);

        if (choice && choice.outcome === 'accepted') {
          setIsInstalled(true);
          setJustInstalled(true);
          window.__boostpay_pwa_prompt = null;
          setDeferredPrompt(null);
          return true;
        }
        return false;
      } catch (err) {
        console.warn('Native PWA install prompt error:', err);
        setIsInstallLoading(false);
        return false;
      }
    }

    // No native prompt available (iOS Safari, in-app browsers, a previously
    // dismissed prompt, or an insecure context) — show step-by-step guidance
    // instead of silently doing nothing.
    setInstallHelpMode(isIOS ? 'ios' : 'manual');
    return false;
  }, [deferredPrompt, isInstalled, isIOS]);

  /**
   * Direct app open
   */
  const openApp = useCallback(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.location.href = '/';
  }, []);

  return {
    isInstallable: !!(deferredPrompt || (typeof window !== 'undefined' && window.__boostpay_pwa_prompt)),
    isInstalled,
    isIOS,
    isAndroid,
    isIframe,
    isInstallLoading,
    justInstalled,
    install,
    openApp,
    installHelpMode,
    closeInstallHelp: () => setInstallHelpMode(null)
  };
}
