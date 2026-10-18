# BoostPay — Complete Production Review
_Security · Hacking · Money Integrity · UI/UX · PWA · Fintech · Scale · Features_
_Audited 2026-10-18 (this review + prior SECURITY.md hardening)_

---

## 1. Security Status (বর্তমান অবস্থা)

### ✅ Fixed & Verified (with live attack PoCs before/after)

| Attack | Before | Now |
|---|---|---|
| Anonymous admin API (`/api/admin/adjust` → mint $5,000) | worked | `401` — signed admin token required |
| Transfer spoofing (debit anyone via `senderId`) | stole $50 | `401/403` — token must match sender |
| Plaintext passwords + recovery phrases in API/DB export | leaked | scrypt-hashed at rest, stripped from every response |
| Money minting via `register` balance injection (`balance: 999999`) | worked | new accounts forced to $0; restores can't change balances |
| Admin credentials in frontend JS bundle | readable by anyone | removed; `ADMIN_EMAIL`/`ADMIN_PASSWORD` env only |
| Brute-force login | unlimited attempts | 15/min login, 10/min register & admin login (`429`) |
| Prototype-pollution / dirty sync input | accepted | keys stripped, money clamped, pushed passwords hashed |
| Missing security headers | none | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Stale-client rollback (unblock users, revert rate) | possible | server-authoritative fields only change via admin endpoints |

### ⚠️ Known residual risks (accepted / documented in SECURITY.md)
1. **Self-heal restore** (recreating vanished users after container wipe) can carry balances — mitigate by persisting `data/` on a volume; then the path never triggers.
2. **No email verification** — anyone can register any email.
3. Accounts with **no password set** accept any password (legacy compat).
4. Rate limiter is in-memory (per instance).
5. TLS must terminate at the reverse proxy — never expose the Node port raw.

### 🛡️ "হ্যাকিং করতে পারবে কিনা?" — attack map
| Vector | Status |
|---|---|
| Balance inflation / money minting | ❌ blocked (server-authoritative) |
| Steal via forged transfers | ❌ blocked (signed tokens, self-only) |
| Admin takeover without login | ❌ blocked (HMAC admin tokens) |
| Password/phrase theft via API | ❌ blocked (hashed + stripped) |
| CSRF (cookie-based) | ❌ N/A — tokens are `Authorization` headers, not cookies |
| XSS (React auto-escaping) | ❌ no `dangerouslySetInnerHTML`; CSP recommended as extra layer |
| Clickjacking | ❌ `X-Frame-Options: SAMEORIGIN` |
| Brute force | ❌ rate limited |
| SQL injection | ❌ N/A (JSON store) — **becomes relevant when you move to Postgres (use Prisma/parameterized queries)** |
| Supply-chain (npm deps) | ⚠️ run `npm audit` in CI; pin lockfile; renovate |
| Insider/admin abuse | ⚠️ add admin audit log (feature #9 below) |
| DoS / traffic floods | ⚠️ put Cloudflare / proxy rate limits in front |

---

## 2. "Amount বাড়াতে পারবে না" — Money Integrity Matrix

| Attempt | Result |
|---|---|
| `POST /api/users/register {"balance":999999}` | ignored — new accounts start at $0 |
| Register-restore with inflated balance on existing user | ignored — restores never touch balances |
| Client `/api/sync` push with fake balance | server balance preserved |
| Client sync with fake new user | accepted only as account-restore (residual — see §1) |
| Forged `/api/transfer` from someone else's account | `403` — token must be sender |
| Direct `/api/admin/adjust` | `401` without admin token |
| Double-spend two transfers at once | ⚠️ single-process file DB is serialized (safe today); on multi-instance use DB transactions with `UPDATE users SET balance=balance-? WHERE balance>=?` |

**Real-fintech upgrade path:** double-entry ledger (every move = balanced debit+credit rows), idempotency keys on every money API, row-level DB constraints, immutable audit trail, daily reconciliation job.

---

## 3. PWA Install — কেন কাজ করছিল না + ফিক্স

### Root causes found & fixed this session

| # | Problem | Fix |
|---|---|---|
| 1 | **Production was running Vite DEV middleware** when `NODE_ENV` is unset (`=== 'production'` check) — dev HMR/WebSocket noise in `index.html` was the giveaway. Dev-mode SW & dev server make the app non-installable and slow | Server now serves the built static app **unless** `NODE_ENV=development` explicitly. `npm start` → production, `npm run dev` → dev |
| 2 | **iOS Safari has no `beforeinstallprompt`** — clicking Install silently did nothing for iPhone users | New **PWAInstallHelp** modal with Bangla step-by-step (Share → Add to Home Screen → Add) |
| 3 | **No guidance fallback** when Chrome's prompt is unavailable (in-app browsers, dismissed prompt, non-Chrome) — spinner 2s then silence | Same modal with Android steps (⋮ menu → Install app) |
| 4 | **Iframe/preview**: browsers block install prompts inside cross-origin iframes | Modal offers "Open in Browser" + `window.open` fallback |
| 5 | **Duplicate manifests** (`public/manifest.json` vs plugin-generated) overwriting each other | Single source: plugin manifest (added `orientation`, `lang`); `public/manifest.json` deleted |
| 6 | `sw.js`/`manifest.json` could be cached stale, blocking update/install re-check | `Cache-Control: no-cache` on sw.js, workbox, manifest, index.html |
| 7 | Missing `viewport-fit=cover` → `env(safe-area-inset)` unusable (needed for standalone iOS layout) | added |

### Verified (production mode)
`manifest.json` 200 + `application/json` + no-cache ✓ · `sw.js` 200 + `application/javascript` + no-cache ✓ · workbox fetch-handler present ✓ · exactly one `<link rel=manifest>` ✓ · Chrome installability fields PASS ✓

### PWA checklist for the live deployment (এগুলো নিজে মিলিয়ে নিন)
1. **HTTPS domain** (`https://boostpay.xxx`) — HTTP হলে কোনো ব্রাউজারেই ইনস্টল হবে না।
2. Service worker registered (DevTools → Application → Service Workers — status **activated**).
3. Chrome Android: 3-dot menu → “Install app” available? If prompt doesn't auto-appear: **engagement heuristic** — user must visit a couple of times; the in-app Install button now shows manual steps either way.
4. iOS: Safari (not in-app browser/Chrome iOS) → Share → Add to Home Screen. `apple-touch-icon` + `apple-mobile-web-app-capable` ✓ already.
5. If a **previous broken install** exists: uninstall the old app / clear site data, then reinstall (manifest `id: '/'` reuses the same app identity).
6. `API_SECRET` env set (tokens survive redeploys) and `data/` on a persistent volume.

---

## 4. UI/UX Issues — found & fixed

| Issue | Fix |
|---|---|
| `hover:bg-zinc-750` — invalid Tailwind class (Pause button hover did nothing) | `hover:bg-zinc-700` |
| Fixed bottom nav overlapped iPhone home indicator | `pb-[calc(...+env(safe-area-inset-bottom))]` + content padding |
| Content under iOS status bar/notch in standalone | `pt-[env(safe-area-inset-top)]` + `viewport-fit=cover` |
| Amount field `type=number` mobile quirks (e/- spinners, keyboard) | `type=text` + `inputMode=decimal` + digits/dot filter |
| “Boosting Completed!” banner fired on plain transfers (prior session) | reward-signature detection |
| Balance highlight never triggered (dead ref compare, prior session) | fixed |
| Install button silent failure | guidance modal (§3) |

**Remaining UI/UX suggestions (not blocking):** Bangla language toggle (most users are BD), skeleton loaders for leaderboard/inbox, pull-to-refresh on wallet, dark/light theme, `aria-live` for toasts, haptic-style button feedback, empty-state illustrations, transaction detail sheet with copy-ref button.

---

## 5. New Features — prioritized roadmap

**P0 (trust & retention — 1-2 weeks)**
1. **2FA / Transaction PIN** — 4-6 digit PIN signed on every transfer (fintech must-have).
2. **Email verification + password reset** (tokenized reset link).
3. **Web Push notifications** (VAPID) — offline yield/transfer alerts (the PWA SW already exists!).
4. **Session & device management** — “where you're logged in”, one-tap revoke (tokens are stateless today; add a token revocation list).

**P1 (product — 2-4 weeks)**
5. QR-code pay (encode user ID, scan-to-send).
6. Transaction search/filter/CSV export.
7. Admin dashboard charts (liquidity, yield paid, DAU) — `/api/admin/stats` already returns the data.
8. Scheduled/auto-restart compounding (auto-start next cycle toggle).
9. **Admin audit log** (who credited/deleted what, immutable).
10. Referral system + leaderboard rewards.

**P2 (growth)**
11. Bangla/English i18n, onboarding tour, biometric login (WebAuthn/passkeys), dark/light theme, in-app support SLA view.

---

## 6. Fintech-Grade Security (production হলে যা লাগবে)

This app is currently a **demo/soft-money fintech**. For real money, regulators (Bangladesh Bank / PCI-DSS if cards / local MFS rules) require:

1. **KYC/AML** — identity verification, sanctions screening, transaction monitoring, suspicious-activity reporting.
2. **Double-entry ledger + reconciliation** — no balance mutation without balanced ledger rows; nightly reconciliation vs bank/PSP statements.
3. **Idempotency keys** on every money-moving API (prevents double-submit duplicates).
4. **Strong customer auth (SCA/2FA)** + device binding + transaction signing.
5. **Encryption**: TLS 1.3 in transit; AES-256 at rest (managed DB encryption + encrypted backups); **never** store reusable secrets client-side.
6. **RBAC + approval workflows** for admin money actions (4-eyes principle), full **immutable audit trail**.
7. **PCI-DSS** if any card data (best: never touch cards — use PSP tokenization like Stripe/bKash/SSLCommerz).
8. **Pen-test + SAST/DAST** in CI, dependency scanning, bug bounty, WAF.
9. **Secrets management** (Vault/cloud KMS) — not `.env` on disk.
10. **DR/backup**: point-in-time recovery, RTO/RPO defined; fraud-loss reserve; SOC2/ISO27001 when enterprise clients arrive.

---

## 7. High-Traffic / Production Strength Plan

### Bottlenecks in the current architecture
| Component | Problem at scale |
|---|---|
| `data/boostpay_db.json` | whole-file read/write per request; 1s ticker rewrites every second — O(DB) IO |
| In-memory rate limit & secret | resets on restart; per-instance only |
| 1s polling per client (`/api/users/:id`) | 1,000 active users = 1,000 req/s just for sync |
| Single Node process | one CPU; any crash = downtime |
| `/api/db` returns ALL users/txs | payload grows unbounded (MBs) |
| Express default | no gzip/brotli, no HTTP caching on API |

### Target architecture (step-wise)
**Step 1 — cheap wins (this week):**
- `NODE_ENV=production` now defaulted ✅ (dev middleware never runs in prod)
- Enable gzip/brotli (reverse proxy or `compression` middleware)
- Add `Cache-Control` on API GETs (`/api/db` 5s, `/api/users/:id` 2s) or switch polling to `ETag/If-None-Match` (304s cut bandwidth ~90%)
- Paginate transactions/notifications (`?limit=50&before=ts`)
- `pm2 start -i max` or Docker multi-replica behind Dokploy's load balancer; add `/api/health` to LB checks

**Step 2 — data layer (this month):**
- **PostgreSQL** (your `config.dokploy` already hints at it!) via **Prisma**; replace `readDb/writeDb` with queries; `balance NUMERIC(18,8)`; row locks for transfers (`SELECT … FOR UPDATE`) — solves concurrency + multi-instance
- **Redis** for rate limits, sessions/token revocation, and pub/sub → replace 1s polling with **SSE or WebSocket** push (server → client only on change)
- Move the yield ticker to a **single scheduled job** (cron/worker) computing rewards from `startedAt` lazily on read — no per-second file writes

**Step 3 — scale & reliability:**
- Frontend as static SPA on CDN (Vercel/Cloudflare) + API as stateless containers (easy horizontal scale)
- Managed Postgres (Neon/RDS/Supabase) with connection pooling (PgBouncer), read replicas
- Observability: Sentry (errors), Prometheus/Grafana or Axiom (metrics/logs), uptime alerts
- Autoscaling rules on CPU/RPS; load-test with k6 before campaigns
- Backups: continuous WAL archiving + weekly restore drills

**Capacity estimate after Step 1-2:** 1 container ≈ 1–2k RPS for cached reads; SSE cuts sync traffic ~10x; a 2–3 replica + Redis + Postgres setup comfortably handles 50k–100k DAU.

---

## 8. Files changed in this session
`server.ts` (prod-by-default, SW/manifest cache headers), `package.json` (dev/start env), `index.html` (viewport-fit), `vite.config.ts` (manifest merge), `public/manifest.json` (deleted — duplicate), `src/hooks/usePWAInstall.ts` (guidance states), `src/components/PWAInstallHelp.tsx` (new), `src/App.tsx` (modal + safe-area), `src/components/WalletView.tsx` (hover fix), `src/components/P2PTransferModal.tsx` (decimal input) — plus the previous security hardening (see SECURITY.md).
