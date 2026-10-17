# Direct 1-Tap PWA App Installation for Android Chrome

Fix PWA installation criteria so that tapping "Install" directly triggers the native Google Chrome install dialog on Android without any intermediate popups or guides.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following user decisions were confirmed and will govern the fix:

- **Confirmed Decision 1 (Target Platform)**: Android with Google Chrome.
- **Confirmed Decision 2 (Direct Install Flow)**: Direct 1-tap native install only (`no need guide, no need popup, direct install need`). Tapping the install trigger immediately calls `deferredPrompt.prompt()`.
- **Confirmed Decision 3 (Root Cause Fixes)**:
  1. Add missing `<link rel="manifest" href="/manifest.json" />` in `index.html`.
  2. Register service worker immediately in `src/main.tsx` (`registerSW({ immediate: true })`).
  3. Remove `window.open` block inside `usePWAInstall.ts` that intercepted and canceled direct install attempts.
  4. Ensure `sw.js` and `manifest.json` satisfy all Chromium PWA installation criteria (service worker with fetch listener, valid maskable & any PNG icons, standalone display mode).

---

## 1. Overview & Core Concept

- **What It Does**: Fulfills 100% of Chromium's PWA installability requirements so Google Chrome on Android recognizes BoostPay as an installable application. When the user taps the Install button in the top navigation or bottom dock, the native Chrome installation prompt ("Install app? Add to Home screen") appears directly on screen.
- **Target Audience / Persona**: Mobile users on Android Chrome looking to install BoostPay directly to their device home screen or app drawer.
- **Key Value**: Delivers frictionless, instant 1-tap native installation with zero modal clutter or popup friction.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. User opens BoostPay on Android Chrome.
  2. The browser registers the service worker and loads `manifest.json`. Chrome fires the native `beforeinstallprompt` event.
  3. The user taps the "Install" button in the bottom dock or navbar.
  4. Chrome's native bottom sheet or dialog pops up immediately: "Install BoostPay - Add to Home screen".
  5. Upon accepting, Chrome installs the app with the high-resolution BoostPay icon and standalone display mode. The button updates immediately to "Installed" with a checkmark.

- **Visual Identity & Theme**:
  - Clean, unboxed button styling matching the Zinc/Amber theme.
  - Active button states with subtle scale feedback on tap (`active:scale-95`).
  - Zero modal popups or secondary guide sheets.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct Native Prompt without Popups or Fallback Modals**
  - *Chosen Approach*: Streamline `usePWAInstall.ts` and `InstallButton.tsx` to directly invoke `promptEvent.prompt()` with no extra modals or popup sheets.
  - *Why*: Exactly matches user's explicit request ("no need guide, no need popup, direct install need").
- **Decision 2: Immediate Service Worker Registration**
  - *Chosen Approach*: Register the service worker at app bootstrap in `src/main.tsx` via `virtual:pwa-register`.
  - *Why*: Chromium strictly requires an active registered service worker with offline/fetch capabilities before it will consider an app installable.
- **Decision 3: Manifest Link in HTML Head**
  - *Chosen Approach*: Explicitly include `<link rel="manifest" href="/manifest.json" />` in `index.html`.
  - *Why*: Without this tag, browsers do not parse the Web App Manifest.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PWA Installation Architecture                   │
└────────────────────────────────────────────────────────────────────────┘

  [ index.html ]
   ├── <link rel="manifest" href="/manifest.json" />
   └── <meta name="theme-color" content="#09090b" />

  [ src/main.tsx ]
   └── registerSW({ immediate: true })  ───> [ Service Worker Active ]
                                                    │
                                                    ▼
  [ Google Chrome on Android ] ─────────────> [ beforeinstallprompt Event ]
                                                    │
                                                    ▼
  [ usePWAInstall.ts ]
   ├── Stores prompt event in memory
   └── install() ───> promptEvent.prompt() ───> [ Chrome Native Install UI ]
```

### Files to Update:
1. `index.html`:
   - Add `<link rel="manifest" href="/manifest.json" />` inside `<head>`.
2. `src/main.tsx`:
   - Import and call `registerSW({ immediate: true })` from `virtual:pwa-register`.
3. `src/hooks/usePWAInstall.ts`:
   - Remove `window.open` code that blocked direct prompts.
   - Simplify `install()` to directly execute `promptEvent.prompt()` and return user outcome.
4. `src/components/InstallButton.tsx` and `src/App.tsx`:
   - Ensure the install button directly triggers `install()` with 1 tap.
