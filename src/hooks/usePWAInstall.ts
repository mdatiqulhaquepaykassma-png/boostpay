import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    // Clean up any stale/bogus localStorage flags
    try {
      localStorage.removeItem('boostpay_pwa_installed');
    } catch {}

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

    // Detect if inside an iframe (like AI Studio preview)
    try {
      setIsIframe(window.self !== window.top);
    } catch {
      setIsIframe(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent automatic mini-infobar so our in-app install button controls the flow
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setJustInstalled(true);
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
   * One-click direct native browser install prompt
   * Returns true if user accepted the installation prompt
   */
  const install = useCallback(async (): Promise<boolean> => {
    if (deferredPrompt) {
      try {
        setIsInstallLoading(true);
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setIsInstallLoading(false);
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
          setJustInstalled(true);
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

    // If deferred prompt is not yet available (e.g. iOS Safari, or browser menu installation)
    return false;
  }, [deferredPrompt]);

  /**
   * Direct app open without popup blocker
   */
  const openApp = useCallback(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.location.href = '/';
  }, []);

  return {
    isInstallable: !!deferredPrompt,
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
