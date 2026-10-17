# Seamless Real-Time In-Place Sync & Full-Reload Elimination

Eliminates repetitive full-app reloads, page flushes, and UI re-render thrashing across both the user wallet interface and the Admin Portal. Replaces reload prompts with seamless, non-intrusive background state synchronization that preserves active typing, scroll position, and UI stability.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product decisions were confirmed during interactive clarification:

- **Confirmed Decision 1 (Real-Time Background Sync)**: Deliver all balance, user, rate, and transaction updates in real time in-place via non-intrusive background synchronization, with zero full-page reloads (`window.location.reload()`).
- **Confirmed Decision 2 (Admin Portal Silent State Sync)**: Admin data refreshes silently without triggering loading spinners on every tick, without re-rendering untouched inputs, and strictly preserving active typing fields, focus states, and scroll position.
- **Confirmed Decision 3 (Eliminate Version Reload Banner)**: Remove the `UpdateNotification` component and its reload prompt, allowing deployments and data updates to apply seamlessly in-place without disturbing the user.

---

## 1. Overview & Problem Definition

### The Reload & Thrashing Problem
Previously, users experienced repetitive app reloading and jarring interface jitter due to four distinct issues:
1. **Periodic Reload Prompt**: `UpdateNotification.tsx` polled `/api/version` every 12 seconds and listened to service worker `controllerchange`, displaying a prompt that forced `window.location.reload()`.
2. **Aggressive Admin Polling with State Churn**: `AdminPortal.tsx` ran `refreshData()` every 500ms, toggling `setIsRefreshing(true)` twice a second and generating new object references on every pass. This caused the entire admin DOM tree to re-render continuously, producing input focus loss, cursor jumping, and visual jitter.
3. **Redundant User Synchronization**: Both `App.tsx` and `WalletView.tsx` ran independent 500ms intervals calling `syncUserFromServer()` and triggering React state updates even when balances and boost states were unchanged.

### The Solution
1. **Completely eliminate forced full page reloads**: Remove `UpdateNotification` and any `window.location.reload()` calls.
2. **Value-Equality & Diff-Guarded State Updates**: Deep-compare incoming server state against current state before calling React setters (`setUsers`, `setStats`, `setCurrentUser`). If data is identical, preserve object identity to prevent React re-renders.
3. **Silent Background Sync in Admin Portal**: Run background polling without setting `isRefreshing = true` (reserving the spinner strictly for manual click). Isolate and preserve all input fields (`searchTerm`, `adjustAmount`, `adjustNote`, `supportMessage`, etc.) while live data syncs smoothly behind the scenes.
4. **Single Consolidated Sync Loop**: Unify user state sync in `App.tsx` and `WalletView.tsx` to prevent redundant network requests and duplicate state dispatches.

---

## 2. Technical Architecture & Data Flow

```
┌────────────────────────────────────────────────────────┐
│             Backend API Server (Express)               │
│  - /api/user/:id                                       │
│  - /api/admin/stats                                    │
│  - /api/admin/users                                    │
└────────────┬─────────────────────────────┬─────────────┘
             │ (Periodic In-Place Sync)    │ (Silent Diff-Guarded Sync)
             ▼                             ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│      App / Wallet        │  │       AdminPortal        │
│  - Diff-checked sync     │  │  - Silent background sync│
│  - Only update on change │  │  - No spinner on poll    │
│  - Smooth local ticker   │  │  - Active typing guarded │
│  - ZERO page reloads     │  │  - Table scroll preserved│
└──────────────────────────┘  └──────────────────────────┘
```

---

## 3. Implementation Steps

1. **Remove Reload Banner & Decommission Reload Prompts (`App.tsx` & `UpdateNotification.tsx`)**:
   - Remove `<UpdateNotification />` and its import from `App.tsx`.
   - Ensure no automatic or user-facing `window.location.reload()` triggers exist in the application.

2. **Refactor Admin Portal Silent Sync (`AdminPortal.tsx`)**:
   - Decouple background polling from `isRefreshing`: background ticks never set `isRefreshing(true)`.
   - Add shallow/deep diff guards before setting `users`, `stats`, `config`, and `messages` so React only re-renders when data actually changes.
   - Guard active input elements so typing in adjustment amounts, search queries, or support chat is never interrupted by live background data updates.

3. **Optimize User State Reconciliation (`App.tsx` & `WalletView.tsx`)**:
   - Ensure `App.tsx` background sync only calls `setCurrentUser` if balance, lifetimeProfit, yield, or boost state values differ from the current user object.
   - Harmonize `WalletView.tsx` sync interval to avoid duplicate parallel fetch requests.

4. **Verify & Test**:
   - Test admin inputs and table updates to confirm active text fields retain focus without jitter.
   - Run `npm run build` and `compile_applet` to verify clean compilation.
