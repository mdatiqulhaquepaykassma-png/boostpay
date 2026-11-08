# REPORT 66 — Promo bonus sidha main balance e (bonus wallet bondho) — Banglish

**Date:** 2026-11-08
**Commit:** `0877b6b`
**Live:** `v1.2.1794174536` · user app `index-YIO1ZviS.js` · promo console `index-BVR02kux.js`
**Test:** journey **342 pass / 0 fail** · regression 42/0 · system-check clean · sob build clean

---

## 1. Ki korechi (apnar instruction onujayi)

| Apnar kotha | Ki hoyeche |
|---|---|
| Bonus main balance e jabe | ✅ `creditCampaignBonus` ekhon sidha `user.balance` e taka dey (`PROMO_BONUS` transaction + ledger + audit soho) |
| Bonus wallet lagbe na | ✅ user app theke 🎁 "Bonus wallet / Welcome bonus" card **sorano**; `/api/user/bonus` ekhon khali shell dey (purono APK vange na) |
| Only main wallet | ✅ boost, send, withdraw — sob ekhon ek e balance |
| Lock (B option) | ✅ campaign e **"Bonus lock (boost only)"** field — 0 din = kono lock nai (ekhon set 0) |
| Lock er somoy boost | ✅ boost always allowed (lock shudhu send / agent pay / withdraw bondho kore) |
| Expiry ekebare baad | ✅ validity, BURN, TO_BALANCE — sob baad. Purono `expiresAt` date pore thakleo kichu katbe na |

**Lock er message** (user ke dekhabe): *"Your $1.00 promotion bonus stays in your balance but can only be boosted until 2026-11-15. Boost it — the profit you earn on top is free to send."*

## 2. Purono $184 — production e already move hoye geche ✅

Boot e ekbar (idempotent) migration cholse, tai apnar click charao hoye geche. Production Postgres check (read-only):

```
[log] [boot] moved $184.00 of promotion bonus into 184 main balance(s)
grants 184 · creditedTo MAIN 184 · PROMO_BONUS transaction 184 ta
user balance: 184/184 jon er balance e $1 kore · #186 = $1
audit: "Boot migration: moved $184.00 of promotion bonus into main balances (184 user(s), 184 grant(s))"
```

Mane **#186 ar baki shob user er $1 ekhon asol main balance** — send/withdraw/boost sob korte parbe (lock 0 tai kono lock nai).

## 3. Notun API / console

```
POST /api/admin/promo/bonus/to-main          {dryRun} → {grants, users, total, preview}
                                             {confirm:true} → ledger theke balance e move (idempotent)
POST /api/admin/promo/campaigns/recount      (age chilo) — counter thik kore
```
Promo console e notun button: **Bonus → balance** (dry-run → confirm), ar campaign editor e **Bonus lock (boost only)** select.

Purono route gulo:
- `POST /api/user/bonus/convert` → 200 no-op (`moved: 0`, notice soho) — purono app error debe na
- `POST /api/user/bonus/send` → **410** ("send money from your balance instead")

## 4. Revoke (guruttopurno)

Bonus ekhon main balance e, tai **revoke** korle unspent bonus ta **balance theke kete neya hoy** (kintu balance 0 er niche jabe na) — `BONUS_REVOKED` transaction + ledger + audit soho. Age bonus wallet theke shudhu row sorato; ekhon taka o fire ashe.

## 5. Test (notun check gulo)

§19 rewrite (12 check) — lock campaign e bonus balance e ashe, locked obosthay send 403 + boost 200, lock 0 hole sathe sathe send 200, purono expiry date kichu kate na, ledger e "added to main balance"।

§28 (13 check) — bonus main balance e, lock signup screen e dekhay, expiry field ar nai, migration dry-run/confirm/idempotent (legacy grant seed kore test), normal user 401।

**Journey total: 342 pass / 0 fail.**

## 6. Apnar baki 3 ta click (promo console)

1. **Fix counters** (WELCOME card) → `used 367 → 184`, remaining `133 → 316`
2. **Fraud reviews → `RV-43696471` → Reject** (stale, #186 er $1 peye geche)
3. **WELCOME → Edit → Duplicate account check — same IP → "Ignore the IP"** (device on rekhe din) — na hole shared mobile IP er notun user abar hold hobe

## 7. Revert path

`git revert 0877b6b` — bonus abar alada wallet e jabe (data already balance e ache, tai revert korle taka double hobe NA, shudhu notun bonus gulo abar wallet e jabe). Boot migration idempotent, tai bar bar restart eo kono taka double hobe na.
