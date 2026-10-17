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

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  /**
   * One-click direct native browser install prompt with automatic readiness resolution
   * Returns true if user accepted the installation prompt
   */
  const install = useCallback(async (): Promise<boolean> => {
    let promptEvent = deferredPrompt || window.__boostpay_pwa_prompt;

    // If deferredPrompt is not yet caught (e.g. Chrome on Android is still initializing),
    // wait up to 2 seconds for beforeinstallprompt event before giving up
    if (!promptEvent && !isInstalled) {
      if (typeof window !== 'undefined' && window.self !== window.top) {
        // If in an iframe, open in full top-level browser tab so Chrome allows native installation
        window.open(window.location.href, '_blank');
        return false;
      }

      setIsInstallLoading(true);
      promptEvent = await new Promise<BeforeInstallPromptEvent | null>((resolve) => {
        let finished = false;
        const handler = (e: Event) => {
          if (!finished) {
            finished = true;
            e.preventDefault();
            const pe = e as BeforeInstallPromptEvent;
            window.__boostpay_pwa_prompt = pe;
            setDeferredPrompt(pe);
            window.removeEventListener('beforeinstallprompt', handler);
            resolve(pe);
          }
        };

        window.addEventListener('beforeinstallprompt', handler);

        setTimeout(() => {
          if (!finished) {
            finished = true;
            window.removeEventListener('beforeinstallprompt', handler);
            resolve(window.__boostpay_pwa_prompt || null);
          }
        }, 2000);
      });
      setIsInstallLoading(false);
    }

    if (promptEvent) {
      try {
        setIsInstallLoading(true);
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        setIsInstallLoading(false);

        if (choice.outcome === 'accepted') {
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

    return false;
  }, [deferredPrompt, isInstalled]);

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
    openApp
  };
}
