# Automatic PWA Install Prompt Banner on Load (Android Chrome)

Implement a prominent, automatic mobile-first PWA Install Banner that displays on load for Android Chrome users, providing immediate 1-tap installation with native browser prompt execution and clear guided fallback.

> [!IMPORTANT]
> **User Review & Confirmed Choices**:
> - **Target Device & Browser**: Android mobile phone with Google Chrome.
> - **Requested Interaction**: Show an automatic install prompt banner on load (rather than requiring users to search for an install button).
> - **Behavior**: When running in standard browser mode (not yet added to home screen), display a prominent bottom banner with "Install App" and "Later" options. Clicking "Install App" immediately invokes Chrome's native `beforeinstallprompt.prompt()` or provides direct visual guidance. Once running in standalone mode (already installed), the banner is automatically suppressed.

---

### 1. Overview & Core Concept

- **What It Does**: When an Android Chrome user opens BoostPay, an elegant floating install prompt card automatically slides in from the bottom of the viewport. It displays the BoostPay app icon, name, and a high-contrast 1-tap "Install App" button.
- **Target Audience / Persona**: Mobile users accessing BoostPay on Android devices who want instant, full-screen home-screen app access without navigating browser menus.
- **Key Value**: Solves the issue of users missing manual install buttons by presenting an immediate, friction-free installation prompt on arrival.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Page Load**: When an Android user arrives on the website (login screen or main wallet), the app checks if it is already installed (`display-mode: standalone`).
  2. **Automatic Reveal**: If running in browser mode, an animated floating bottom banner slides up after a gentle 800ms dwell time.
  3. **Direct 1-Tap Install**: Tapping "Install App" triggers the native Android Chrome install dialog (`deferredPrompt.prompt()`).
  4. **Fallback Guidance**: If Chrome has not yet emitted `beforeinstallprompt` (or inside an in-app webview), tapping opens the visual 3-step guide: "Tap Chrome menu (⋮) -> Tap 'Install app' -> Tap 'Install'".
  5. **Dismissal & Memory**: Tapping "Dismiss" / "Later" closes the banner for the current session without annoying returning users.

- **Visual Identity & Theme**:
  - *Container*: Floating rounded card (`rounded-2xl border border-amber-500/30 bg-zinc-900/95 shadow-2xl backdrop-blur-md p-4`).
  - *Colors*: Dark zinc canvas (`#09090b`), gold/amber primary accent (`#f59e0b` / `bg-amber-500`), crisp white text (`#f4f4f5`).
  - *Typography*: Clean sans-serif with bold CTA button labels and compact 1-line description.
  - *Thumb-Zone Placement*: Centered at the natural thumb zone (`fixed bottom-20 sm:bottom-6 left-4 right-4 max-w-md mx-auto z-50`), floating safely above the fixed bottom navigation bar.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Automatic Banner vs. Full-Screen Modal**:
  - *Chosen Approach*: Floating bottom banner with dual actions ("Install Now" and "Later").
  - *Why*: Non-intrusive yet impossible to miss. It avoids blocking user interaction while giving an immediate 1-tap installation affordance.
  - *Alternative Considered*: Full-screen blocking modal; rejected as it blocks users who want to quickly check the login screen first.

- **Decision 2: Native Prompt Interception & Webview Detection**:
  - *Chosen Approach*: Intercept `beforeinstallprompt` event and hook it directly to the banner's "Install" CTA. If the event is pending or in an embedded browser/iframe, offer a direct new tab launch or visual Chrome menu steps.
  - *Why*: Chromium security policies restrict native prompt execution to user gesture callbacks and standalone browser windows.

---

### 4. Technical Architecture & Component Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Page Load                        │
│                 (Android Chrome Mobile)                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                Check standalone mode matches?
                               │
                ┌──────────────┴──────────────┐
               YES                            NO
                │                             │
    [Suppress Banner]             Listen for beforeinstallprompt
    (App already installed)                   │
                                  ┌───────────┴───────────┐
                                  │ Wait 800ms dwell time │
                                  └───────────┬───────────┘
                                              │
                              ┌───────────────▼───────────────┐
                              │ Automatic Mobile Install Card │
                              │   - BoostPay App Icon         │
                              │   - "Install App" CTA         │
                              │   - "Maybe Later" Dismiss     │
                              └───────────────┬───────────────┘
                                              │
                                  User clicks "Install App"
                                              │
                                ┌─────────────┴─────────────┐
                         deferredPrompt?             No prompt event?
                                │                           │
                 [deferredPrompt.prompt()]         [Show InstallGuideModal]
                 (Native Android Dialog)          (Chrome menu ⋮ step guide)
```

- **Interactive Components**:
  - `PWAAutoInstallBanner`: New mobile-first auto-prompt banner component mounted at root (`App.tsx`).
  - `usePWAInstall`: Exposes `deferredPrompt`, `isInstallable`, `isInstalled`, `isAndroid`, `install()`.
  - `InstallGuideModal`: High-contrast visual step guide for fallback scenarios.
