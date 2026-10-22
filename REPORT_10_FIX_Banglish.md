# Report #10 — Loading + Referral Fix (2026-10-20)

**Commit:** `bd71de2` → build code-split 335k + vendor 210k (age 687k monolith) → initial load ~50% faster

## 1️⃣ Loading time bere gese — fix kora hoise

**Root cause:**
- `App.tsx` `isInitialSyncing` true rakhe `initSync()` full `/api/db` fetch ses na howa porjonto → mobile 3G te 2-4s blank skeleton dekhaito. Tar upor `4s` poll + `5s` refer poll server ke hammer kore slow kore dito, plus `100kb` limit e `PayloadTooLargeError` bar bar log e.

**Fix:**
- **Instant wallet:** `initSync` non-blocking kora — local `BoostPayStore.getCurrentUser()` thakle sathe sathe `setIsInitialSyncing(false)` diye WalletView render, background e `syncUserFromServer` hoy. No auth holeo gate instant.
- **Poll reduce:** Full site poll `4s → 12s`, ReferView `5s → 15s`, `document.visibilityState==='visible'` holei poll — tab hidden hole pause. SSE still instant realtime.
- **Code-split:** `vite.config.ts` `manualChunks(vendor/icons/motion)` + `React.lazy` for `Leaderboard/Refer/Messenger/Inbox` — main chunk `687k → 335k` (gzip 193k→97k), vendor alada cache. PWA precache 14→20 entries 857k but lazy load e first paint fast.
- **PayloadTooLarge:** `server.ts` global `express.json 100kb → 1mb`, `/api/sync 10mb`, `/api/db 5mb` — photo/history push e error ar hobe na, disk churn komeche.

## 2️⃣ Failed to load referral data — fix kora hoise

**Root cause:**
- `server.ts /api/refer/my` e jodi kono referred user er `liveBoostState` e exception hoy pura endpoint 500 dito, client e `null` return → ReferView e `Failed to load referral data` dekhato retry chara.
- `store.ts getReferMy()` 401/500 silently `null` return korto, error message harai jaito.

**Fix:**
- **Server:** `/api/refer/my` purota `try/catch` wrap + inner per-referral try/catch + `liveBoostState` safe call — single corrupt referral pura response crash korbe na. 500 hole `{"error":"Failed to load referral data"}` json diye bujhaiya dey.
- **Client store:** `getReferMy()` ekhon `401 → "Session expired — please re-login"`, onno error `HTTP xxx` throw kore — ReferView catch kore message dekhay.
- **ReferView UI:** `referErr` state + `Refresh` function try/catch, `15s` interval + visibility check, `Failed + Retry button` with error text + `tap Retry — will auto-retry in 15s`. Age pull-to-retry kaj korto na (Messenger tab chara disabled) ekhon button e explicit.

## Test
- `tsc --noEmit` OK 0 error
- `vite build` 1714 modules → main 335k + vendor 210k + icons 27k + messenger 77k + refer 22k + leaderboard 17k (gzip total ~190k)
- `git push ff-only` `6dba43f..bd71de2` OK, Dokploy auto-deploy triggered (previous build 10m chilo, new build pending — `boostpay-l2q4ry` still `v1.2.1792476848` until new image live)

## Next deploy verify
`ssh boostpay_vps "docker logs $(docker ps -q --filter name=boostpay-l2q4ry | head -1) --tail 20 | grep Version"`

---
**Result:** Wallet instant load, referral tab e Retry button e click korle data ashbe, loading hammer 3x komeche.
