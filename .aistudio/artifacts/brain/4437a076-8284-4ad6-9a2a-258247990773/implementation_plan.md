# Implementation Plan: Compounding Engine Per-Minute Rate Transition (0.001605%/min)

This plan transitions the BoostPay dynamic compounding engine from an hourly rate basis to a per-minute rate basis of **0.001605% per minute**, applying immediately to all running boost cycles and displaying both the per-minute rate and its equivalent hourly rate across the user and admin interfaces.

---

## 1. User Review Required
- **Selected Rate Standard**: `0.001605% per minute`.
  - Rate per millisecond: `(0.001605 / 100) / 60000 = 2.675e-10` per ms.
  - Equivalent hourly compounding rate: `(1 + 0.001605/100)^60 - 1 ≈ 0.09634%` per hour (linear `~0.0963%/hr`).
- **Display Format**: Both rates will be displayed clearly in the compounding card header and admin portal:
  `0.001605%/min (~0.0963%/hr)`.
- **Immediate Application**: The server-side background compounding ticker and client-side live visual ticker will immediately adopt this rate for all existing and newly started boost cycles without resetting user balances or elapsed timers.

---

## 2. Architecture & Layout Consistency
- **Domain**: High-precision financial web app (SaaS Dashboard & Mobile Web Touch).
- **Tabular Figures & Precision**:
  - Compounding yield ticker continues using monospace tabular figures (`font-mono tabular-nums`) with 8-decimal precision (`formatPrecisionAmount(val, 8)`).
  - Rate badges avoid generic pill slop, rendering as clean metadata (`Rate: 0.001605%/min · ~0.0963%/hr`).
- **Mathematical Continuity**:
  - The server authoritatively calculates accrued rewards using numerically stable continuous compounding:
    $$Y(t) = S \cdot \left( (1 + r_{\text{ms}})^t - 1 \right)$$
    where $S$ is starting balance, $t$ is elapsed milliseconds, and $r_{\text{ms}} = \frac{0.001605}{100 \times 60\,000} = 2.675 \times 10^{-10}$.
  - The client `IsolatedCompoundingCard` and `IsolatedLiveBalanceCard` in `WalletView.tsx` will share the identical rate per ms for 100% synchronization.

---

## 3. Step-by-Step Implementation Plan

### Step 1: Update Data Model and System Configuration Types (`src/types.ts`)
- Update `SystemConfig` in `src/types.ts` to include `minuteRatePercent: number` (default `0.001605`).
- Retain backward compatibility for `hourlyRatePercent` as a derived or optional property so existing code remains strictly type-safe.

### Step 2: Update Server Compounding Ticker and Database Defaults (`server.ts`, `data/boostpay_db.json`)
- In `server.ts`:
  - Set default config `minuteRatePercent: 0.001605` in `INITIAL_DB.config`.
  - Update `ratePerMs` calculation in the background boost ticker:
    `const minuteRate = config.minuteRatePercent ?? 0.001605;`
    `const ratePerMs = (minuteRate / 100) / 60000;`
  - Ensure all running user boost states compute `accumulatedYield` and final cycle payout with this rate.
- In `data/boostpay_db.json`:
  - Update the persisted `config` object to store `minuteRatePercent: 0.001605`.

### Step 3: Update Client Store & Formatting Utilities (`src/services/store.ts`, `src/utils/format.ts`)
- In `src/services/store.ts`:
  - Update `getDefaultConfig()` with `minuteRatePercent: 0.001605`.
  - Add helper `formatCompoundingRateDisplay(minuteRate: number)` returning `"0.001605%/min (~0.0963%/hr)"`.
- In `src/utils/format.ts`:
  - Ensure `formatRatePercent` supports high-precision decimal representation for small percentage rates like `0.001605%`.

### Step 4: Update Wallet View Live Tickers & Cards (`src/components/WalletView.tsx`)
- In `IsolatedLiveBalanceCard`:
  - Update rate parameter from `hourlyRatePercent` to `minuteRatePercent: number` (default `0.001605`).
  - Calculate `ratePerMs = (minuteRatePercent / 100) / 60000`.
- In `IsolatedCompoundingCard`:
  - Update ticker calculation to use per-minute rate per millisecond.
  - Update header display text to show:
    `Rate: 0.001605%/min (~0.0963%/hr) · Duration: ...`
- Pass `config.minuteRatePercent` from `WalletView` into both child cards.

### Step 5: Update Admin Portal Rate Configuration (`src/components/AdminPortal.tsx`)
- Update Admin Settings tab:
  - Change rate adjustment input label to "Compounding Rate (% per min)".
  - Display live preview of equivalent hourly rate: `Rate: X%/min (~(X * 60)%/hr)`.
  - Allow administrators to save and adjust the minute-based rate with instant server persistence.

---

## 4. Verification Checklist
- [ ] Run `npm run lint` and `npm run build` to ensure zero TypeScript errors.
- [ ] Verify server health endpoint and background ticker math via `curl`.
- [ ] Inspect `WalletView.tsx` cards: verify live balance and accrued reward tick smoothly with `2.675e-10` per ms.
- [ ] Confirm dual rate display shows `0.001605%/min (~0.0963%/hr)`.
- [ ] Check Admin Portal configuration view to ensure rate inputs and previews are functional.
