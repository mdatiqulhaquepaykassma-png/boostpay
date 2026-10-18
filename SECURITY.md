# BoostPay — Security Audit & Hardening Report

_Audited: 2026-10-18 · Scope: `server.ts` API, `src/` client, deployment config_

## Summary

The audit found **5 critical** and **3 medium** vulnerabilities. All have been fixed
and verified with live proof-of-concept tests (attack scripts re-run after the fix to
confirm they are blocked).

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | 🔴 Critical | Admin API completely unauthenticated (credit/delete/export as anonymous) | ✅ Fixed |
| 2 | 🔴 Critical | Account takeover via transfer spoofing (debit any user with no auth) | ✅ Fixed |
| 3 | 🔴 Critical | Plaintext passwords exposed via API responses & DB export | ✅ Fixed |
| 4 | 🔴 Critical | Money minting via `/api/users/register` balance injection | ✅ Fixed |
| 5 | 🔴 Critical | Admin credentials hardcoded in the frontend JS bundle | ✅ Fixed |
| 6 | 🟠 Medium | No brute-force protection on login endpoints | ✅ Fixed |
| 7 | 🟠 Medium | Prototype-pollution / dirty-object input on `/api/sync` | ✅ Fixed |
| 8 | 🟠 Medium | Missing security response headers | ✅ Fixed |

---

## Details & Fixes

### 1. Unauthenticated Admin API (Critical)
**PoC (before):** `curl -X POST /api/admin/adjust -d '{"userId":"1","type":"CREDIT","amount":5000}'`
credited $5,000 with no credentials. `GET /api/admin/db/export` dumped the entire
database. `POST /api/admin/users/delete` could delete any user.

**Fix:** every `/api/admin/*` route (except `/api/admin/login`) now requires a signed
HMAC admin token (`Authorization: Bearer <token>`). Tokens are issued at admin login,
expire after 30 days, and are validated with timing-safe comparison.

### 2. Transfer Spoofing (Critical)
**PoC (before):** `POST /api/transfer {"senderId":"1","recipientId":"2","amount":50}`
stole $50 from user 1 — no authentication whatsoever.

**Fix:** all money-moving and account-scoped routes (`/api/transfer`, `/api/boost/*`,
`/api/notifications/*`, `/api/users/:id`, `/api/sync`, `/api/db`) require a signed user
token, and the token's user ID must match the `senderId`/`userId` in the request.
Users can only act as themselves.

### 3. Plaintext Passwords & Secrets in API Responses (Critical)
**PoC (before):** `GET /api/db`, `GET /api/users/:id`, login responses and the admin
export all contained `password` and 12-word recovery `phrase` fields in plaintext.

**Fix:**
- Passwords are now hashed with **scrypt + per-user random salt** (Node built-in `crypto`,
  no extra dependencies). Legacy plaintext rows are transparently upgraded to hashes on
  the next successful login.
- `password` and `phrase` fields are stripped from **every** API response (`publicUser()`).
  The admin console receives only `hasPassword: boolean` and shows a masked `••••••••`.
- The recovery phrase stays server-side (visible to the admin console only, for support
  search — it is a high-entropy secret, not reused as a password).

### 4. Money Minting via Registration (Critical)
**PoC (before):** `POST /api/users/register {"id":"1","balance":999999}` inflated any
existing account. Fresh registration also accepted arbitrary `balance`.

**Fix:**
- Fresh registrations **always** start at $0 — client-supplied `balance` / `lifetimeProfit`
  / `boostState` are ignored (and password now requires ≥ 4 characters).
- Restoring an **existing** account can no longer modify its balance at all.
- Restoring a **vanished** account (container redeploy self-heal) still carries its
  balance — see residual risks.

### 5. Admin Credentials in the Frontend Bundle (Critical)
**Before:** `AdminPortal.tsx` contained a client-side fallback accepting
`admin@gmail.com / 123456 / admin786` — shipped to every browser in the JS bundle.

**Fix:** the fallback was removed. Admin credentials are server-side only and can be
overridden with `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables. **Set these in
production** — the built-in defaults remain only for out-of-the-box demos.

### 6. Brute-Force Protection (Medium)
**Fix:** in-memory rate limiting on `/api/users/login` (15/min), `/api/users/register`
(10/min) and `/api/admin/login` (10/min) per IP, returning `429 Too Many Requests`.

### 7. Unsanitized Sync Input (Medium)
**Fix:** `/api/sync` now strips `__proto__` / `constructor` / `prototype` keys, clamps
numeric money fields to sane finite values, and hashes any plaintext password a client
pushes before it touches the database.

### 8. Security Headers (Medium)
**Fix:** all responses now send `X-Content-Type-Options: nosniff`, `X-Frame-Options:
SAMEORIGIN`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`.

---

## Architecture Changes

- **Signed session tokens.** Login/registration return a 30-day HMAC-SHA256 signed
  token (`base64url(payload).signature`). The client stores it and sends it as
  `Authorization: Bearer <token>` on API calls. The signing secret is auto-generated
  once and persisted at `data/.api-secret` (mode 0600).
- **Server authority.** Balances, credentials, admin flags (`isBlocked`, `isTempLocked`)
  and system config can only be changed through their dedicated endpoints — never via
  client sync pushes (prevents stale-client rollback attacks).
- **Offline mode preserved.** The client keeps the user's typed password in
  `localStorage` for offline login fallback; the server never sees anything but hashes.

## Residual Risks (known, accepted trade-offs)

1. **Container-redeploy self-heal.** `/api/users/register` with a missing user ID can
   recreate that account including its balance (needed to restore users after a server
   wipe). An attacker could theoretically pre-create a missing ID with a fake balance.
   **Mitigation:** persist `data/` on a Docker volume — the self-heal path then never
   triggers in normal operation and the surface disappears. Set `API_SECRET` in the
   environment so tokens survive redeploys as well.
2. **No email verification.** Anyone can register with any email address.
3. **Accounts without a stored password** accept any password at login (legacy
   compatibility). All accounts created through the UI set a password.
4. **Rate limiter is in-memory** — resets on restart and is per-instance (behind a
   shared proxy all clients share one IP bucket).
5. **HTTP(S) termination is external.** Tokens/passwords must travel over TLS provided
   by the reverse proxy (Dokploy/Render/Cloudflare) — never expose the Node port raw.

## Verification (all re-tested after the fix)

- Anonymous `/api/admin/*` → `401` ✅
- Anonymous `/api/transfer`, `/api/db`, `/api/users/:id`, `/api/sync` → `401` ✅
- Valid user token + spoofed `senderId` → `403` ✅
- Valid user token on admin endpoints → `401` ✅
- Cross-user `/api/users/:id`, `/api/boost/*` → `403` ✅
- Login/register/transfer/admin responses contain no `password`/`phrase` fields ✅
- DB file contains only `scrypt$…` hashes (legacy rows upgraded on login) ✅
- Register balance injection no longer changes balances ✅
- 20 rapid failed logins → `429` after the limit ✅
- Security headers present on responses ✅
- `tsc --noEmit` and `vite build` clean ✅


---

## V6 Port Notes (applied on top of the BoostPay V6 codebase)

This same hardening layer was re-ported onto the "BoostPay V6" server (`server.ts`),
which had regressed to the original vulnerable patterns. In addition to the fixes
above, the V6 port closes these V6-specific issues:

1. **Chat API auth** - `/api/chat/messages` accepted any `userId` (anyone could read
   any conversation) and `/api/chat/stream` was open to all. Both now require a valid
   session; users can only read their own conversations (admins excepted). The SSE
   stream authenticates via `?token=` (EventSource cannot send headers).
2. **Account-restore minting** - the "recreate vanished user" path of
   `POST /api/users/register` trusted client-supplied `balance`/`lifetimeProfit`.
   Those values are now only honored when the request also carries a valid pre-wipe
   session token for that exact account (self-heal keeps working, free-money minting
   does not). Fresh registrations always start at zero.
3. **Single-source PWA manifest** - both `public/manifest.json` and the plugin's
   manifest were being emitted (duplicate `<link rel="manifest">`). `public/manifest.json`
   is now the single source (dev route + build copy), plugin manifest generation off.
4. **Production default** - `NODE_ENV` now defaults to production (`!== 'development'`),
   so the Vite dev middleware can never accidentally run in production (which broke
   PWA installability).

V6 features preserved: minute-based yield rates, SSE chat + reactions, admin freeze,
audit logs, boost pause/resume/stop-with-partial-reward, dynamic durations, ID/phrase
account recovery, legacy user-ID map, and the sequential-ID allocator.
