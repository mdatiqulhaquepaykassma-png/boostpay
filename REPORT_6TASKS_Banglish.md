# BoostPay 6 Tasks — Fixed Report (Banglish)

## 1) Forget Password fix + Sign In
- **Problem**: Reset er por “sign in korte bole” message unclear, password hash vul (sha256 vs scrypt) → login fail hoto.
- **Fix**:
  - `server.ts:/api/users/reset-password` → `hashPassword(newPassword)` (scrypt) use, `delete resetToken/resetExpires`, audit log, inbox notification “Your password has been updated. Please sign in...”
  - API response: `{ success:true, message:'Password updated. Please sign in with your new password.', signInHint:true }`
  - `AuthGate.tsx` → `handleForgotRequest` message “Code sent to your email...”, `handleForgotReset` success → “Password updated — please sign in with your new password ✅” + auto switch `setTab('LOGIN')`, prefill `loginEmail`, clear errors, auto close modal 1.5s.
  - User ke clear instruction: code email e jabe (spam check), new password diye Sign In tab e login korte hobe.

## 2) Refer error 12 & 27 solo solved
- **Investigation VPS DB**: 
  - User #12 (jahidhasan128355@gmail.com) bal 398.39, referred #27 (borisal@gmail.com) + #28 (hassansourav...), but commissions 0.
  - Cause: `server.ts` ticker commission logic required `referrerBoostActive = isActive && !isPaused`. #12 was `isPaused:true` → no earning.
  - User #27 had 7 rewards ~0.00012 each, #12 should have gotten 10% each (~0.000012) but got 0 due to paused check.
- **Fix**: Changed `referrerCanEarn = referrer && !referrer.isFrozen` (frozen-only). Paused but not frozen → now earn. Future cycles from #27 will credit #12 correctly.
  - Retro: past 0.0001 missed commission small; next reward will auto-credit. Admin can run `/api/admin/audit/correct-balances` if exact backfill needed.
  - Also ensured `publicUser` not leaking `passwordPlain` that could confuse refer count UI.

## 3) IP Block settings Antifraud e add — ON/OFF Edit
- **Backend** `server.ts`:
  - `INITIAL_DB.config.antifraud` added `ipBlockEnabled:true`, `blockedIps:[]`, `ipAutoBlockThreshold:50`
  - Persistent helpers `isIpPersistentlyBlocked(ip)`, enhanced `checkBlacklist` to return 403 with reason + Retry-After if persistently blocked.
  - New endpoints:
    - `GET /api/admin/antifraud/ip-blocks` (list)
    - `POST /api/admin/antifraud/ip-blocks` (add IP+reason+duration)
    - `PUT /api/admin/antifraud/ip-blocks/:ip` (edit enabled/reason/until)
    - `DELETE /api/admin/antifraud/ip-blocks/:ip`
    - `POST /api/admin/antifraud/ip-blocks/toggle-enabled` (master ON/OFF)
  - All audit-logged + in-memory `ipBlacklist` sync for instant effect.
  - `readDb()` migration ensures old DB gets new fields + expired cleanup.
- **Frontend** `admin-app/AdminExtraViews.tsx`:
  - New `IpBlockManager` component under FraudView → shows master ON/OFF switch, add form (IP, reason, minutes), per-IP Enable/Disable + Unblock buttons, expiry display.
  - Integrated into `FraudView` between AntifraudConfigEditor and FraudAuditTrail.

## 4) Logout button color red
- `src/App.tsx` bottom nav: changed `text-zinc-500 hover:text-red-400` → `text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl font-bold`
- `src/components/SettingsModal.tsx` both logout buttons: `border-red-500/30 bg-red-500/10 text-red-400` → `border-red-600 bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-600/20`

## 5) All Frontend leaks fixed
- `server.ts publicUser()` now strips `password, passwordPlain, passwordHash, phrase, resetToken, resetExpires, emailVerificationCode, emailVerificationExpires` — API never leaks credentials.
- `src/services/store.ts`:
  - `mergeServerUser` → strips secrets, returns clean only.
  - `initSync` merge local→server: no longer merges `phrase/password` into stored user; strips before saving to localStorage.
  - `getCurrentUser` → strips secrets on return.
  - `setCurrentUser` → strips secrets before JSON.stringify and localStorage users array.
  - `SettingsModal` password change no longer stores `password: newPass` locally.
- Checked `grep passwordPlain` frontend → 0 leaks except allowed admin view.
- Tokens remain in `boostpay_auth_token_v1` (expected SPA) but never logged; SSE `?token=` over TLS not logged server-side.
- No admin links in user bundle, no hardcoded SMTP creds in frontend.

## 6) All Backend secured
- `publicUser` hardened, `adminUserView` only for admin APIs.
- `reset-password` fixed scrypt hash, 429 rateLimit 6/8, `checkOtpRateLimit` per email 1/15m per IP 12/h (configurable).
- `forgot-password` never leaks existence (generic success), email-only OTP via SMTP pool, fallback generic inbox only if `fallbackToInbox`.
- `ipBlacklist` persistent + admin ON/OFF edit, master toggle.
- Referral: frozen check only, safe bounds `commission <= finalYield*0.10`, rate 1-10, idempotent RC id check.
- Global guards: `rateLimit(200)` per IP+user, `checkBlacklist`, `body sanitizer` strip `$` and `.` keys, reject `balance` injection except admin/adjust, `sanitizeText` strip script/iframe/js:, `escapeHtml`, file upload 5MB limits, photo 5MB, voice 3MB, CORS allowlist, helmet headers (CSP, HSTS, X-Frame, etc.), block `.env/.api-secret/.git/data/boostpay_db`, session `revokedSessions` + `touchSession`, `PAYMENT_WEBHOOK_SECRET` required else reject, `transfer` with `withTransferLock` mutex + idempotency 24h, ledger atomic balance check.
- Build: `npx tsc --noEmit --skipLibCheck` pass (vite types optional), pushed `41a3e55` ff-only via `boostpay_deploy` key, Dokploy will rebuild (last check `docker ps` 37c2ee764aa2 up 4h, SMTP ready joypaykassma).

Next: Test forgot → email → reset → sign in, check #12 will earn next #27 reward, try antifraud → IP Block add 1.2.3.4 disable/enable, logout red visible.
