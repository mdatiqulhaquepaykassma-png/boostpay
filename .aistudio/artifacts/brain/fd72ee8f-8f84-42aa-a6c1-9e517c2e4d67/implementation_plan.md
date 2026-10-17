# Fix Admin Panel Balance Credit & Authoritative Balance Protection

Resolves the issue where user balances were not being added or updated from the Admin Panel. Implements strict server-authoritative balance protection to prevent stale client state from overwriting balances, enhances the Admin UI with instant quick-credit actions, and provides clear visual confirmations and real-time user notifications.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product decisions were confirmed during interactive clarification:

- **Confirmed Decision 1 (Server-Authoritative Balance Protection)**: The server (`boostpay_db.json`) is the single source of truth for all user balances. `/api/sync` will no longer allow client `localStorage` to overwrite server balance values.
- **Confirmed Decision 2 (Direct In-Table & Header Quick Credit)**: In addition to the existing management panel, add a prominent "+ Add Balance" button at the top of the Users tab and direct "+ Credit" buttons on each user row for instant access.
- **Confirmed Decision 3 (Instant Feedback & User Alert Notification)**: Display an immediate green confirmation badge (`Successfully added $XX.XX to User #ID. New Balance: $YY.YY`) in the Admin Panel and dispatch a real-time treasury notification to the user's inbox.

---

## 1. Overview & Root Cause Analysis

### Why Balance Credit Was Failing
1. **Accidental Client Overwrite in `/api/sync`**:
   Whenever a client device or tab ran its sync cycle, `server.ts` line 571 took `incUser.balance` from the client's `localStorage` and merged it into the server database. If a user was open on another tab or phone with an older cached balance, it repeatedly wiped out the admin's credit and reverted the balance back to the old value!
2. **String Type Mismatch in User Lookup**:
   In `server.ts` `/api/admin/adjust`, `db.users.find(u => u.id === userId)` used strict equality `===`. When `u.id` or `userId` had slight type differences (e.g., number vs string), the server returned `404 User not found`.
3. **Silent Failure in UI**:
   In `AdminPortal.tsx`, if `res.ok` was false or if the amount input contained currency symbols (`$`, spaces), `handleAdjustBalance` silently exited without displaying any error message to the admin.
4. **Discoverability**:
   The balance adjustment panel was hidden at the very bottom of the page and required the admin to click a small "Manage" button on a table row that is easily scrolled off-screen on mobile devices.

---

## 2. Technical Architecture & Fix Strategy

```
┌────────────────────────────────────────────────────────┐
│                   AdminPortal.tsx                      │
│  - Quick "+ Credit" button on each user row            │
│  - Header quick-action modal by User ID or dropdown    │
│  - Input sanitization (strips '$', commas, whitespace) │
│  - Instant green success feedback                      │
└──────────────────────────┬─────────────────────────────┘
                           │ POST /api/admin/adjust
                           ▼
┌────────────────────────────────────────────────────────┐
│                     server.ts                          │
│  - Match users safely: String(u.id) === String(userId) │
│  - Authoritatively increment user.balance              │
│  - Create ADMIN_CREDIT transaction & ledger entry      │
│  - Create live SYSTEM_ALERT notification               │
│  - Persist to data/boostpay_db.json                    │
│  - In /api/sync: STRICTLY PREVENT client overwrite of  │
│    server user balances                                │
└──────────────────────────┬─────────────────────────────┘
                           │ Real-Time User Sync
                           ▼
┌────────────────────────────────────────────────────────┐
│                  User Wallet View                      │
│  - Authoritative balance reflected immediately         │
│  - Real-time toast alert "Funds Deposited by Admin"    │
└────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Steps

1. **Protect Server Balance in `server.ts`**:
   - In `/api/sync`: Keep `mergedUsers[idx].balance` untouched by incoming client sync payloads. Client sync can register new offline users or sync offline messages, but cannot overwrite existing server balances.
   - In `/api/admin/adjust`:
     - Robust type-safe ID matching: `String(u.id) === String(userId)`.
     - Numeric sanitization: parse cleaned amount, reject zero/negative numbers with clear error message.
     - Add transaction audit record and treasury alert notification.

2. **Enhance Admin Portal Interface (`AdminPortal.tsx`)**:
   - Add a high-visibility "+ Add Balance" button in the Users tab header opening a quick-credit modal.
   - Add a compact "+ Credit" button directly in the table row actions for instant 1-click balance adjustments.
   - Sanitize amount inputs (handling `$50`, `50.00`, ` 50 `).
   - Display clear, vibrant green success feedback with the user's updated balance upon completion, plus red error alerts if anything fails.

3. **Client Store Integration (`src/services/store.ts`)**:
   - Add `adminAdjustBalance` method to update both local storage and trigger authoritative server sync.

4. **Testing & Build Verification**:
   - Test balance crediting via API and UI to confirm data persistence in `boostpay_db.json`.
   - Run `npm run build` and `compile_applet`.
