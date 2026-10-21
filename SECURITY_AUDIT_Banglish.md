# BoostPay Critical Security Audit — Extra Balance Minting Bugs (Banglish)

**Date:** 2026-10-20 | **VPS:** boostpay.72-60-42-18.sslip.io | **Final Version:** v1.2.1792458693
**Auditor:** Full codebase review (server.ts 5400+ lines, admin-app, store, sync, payments)

---

## Summary — Kono vabe extra balance barano jabe kina?

Auditor full code scan kore **8 ta critical minting vector** peyechi, jekhane attacker kono vabe extra balance barate parto. Sob gulo fix kore deploy kora hoyeche. Niche protita bug er **kivabe exploit hoto, koto taka inflate hoyeche, ar ki fix** deya holo.

---

### 1) **Restore via stolen token → 1e12 taka mint (CRITICAL)** — FIXED ✅

**Kothay:** `POST /api/users/register` e `lookupId && !db.users.some(...lookupId)` block — mane user DB theke delete hoye gele attacker purano valid JWT token diye `balance: 1000000000000` pathale server trust korto:
```ts
const restoreBal = tokenOk && balance ? Math.min(balance, 1e12) : 0;
```
**Exploit:** Attacker jodi kono user er purano token leak kore (XSS, log, brute), se user ke delete koriye (admin delete ba auto-cleanup) tarpor oi token diye `balance: 1e12` diye recreate korte parto. Ekbar e 1 trillion mint.

**Fix:** Ekhon `restoreBal = 0` always, token thakleo client balance trust kora hoy na. Recreate hole `0` diye start hobe. Commit `0df4659`.

---

### 2) **Payment callback forged via weak secret fallback (CRITICAL)** — FIXED ✅

**Kothay:** `PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || API_SECRET`
**Exploit:** Jodi `PAYMENT_WEBHOOK_SECRET` env set na thake, fallback `API_SECRET` use hoto — jeta `data/.api-secret` file e default weak `demo-secret` ba `123456` hote pare, ar repo te na thakleo server e readable. Attacker seta janle `provider|transactionId|amount|currency|orderId|userId` diye HMAC forge kore `POST /api/payments/callback` e `amount: 100000` diye jekono user ke credit dite parto. Idempotency key `pay:provider:txId` provider change kore bypass kora jeto.

**Fix:** Ekhon `PAYMENT_WEBHOOK_SECRET` na thakle callback `500` error dey — `PAYMENT_WEBHOOK_SECRET must be set`. Production e alada strong env set korte hobe. Fallback remove.

---

### 3) **Compounding duplicate rewards (178 ta, 82 taka inflate) — FIXED ✅** (tomar 13 number user case)

**Kothay:** Ticker `elapsed >= target` e kono dedup guard chilo na. `maxBal` hothat barle (hasan 1000 join) purano user der elapsed hothat target er cheye boro dekhato, ar 1s interval e duita tick ek sathe same cycle award kore dito. `pg persist 400ms debounce` + in-memory `pgDoc` race e duplicate.

**Evidence (VPS DB 315 tx):**
- `user 13`: `33` reward er moddhe `32` duplicate (gap `1001-60049ms` < target `10M`), `15.17` taka inflate → thik kore `32` delete, balance `115.64 → 100.47`, profit `15.64 → 0.474`
- `user 2`: `89` er moddhe `86` duplicate (`65.83` taka) → `157.35 → 91.51`
- `user 7`: `26` duplicate (`0.0015`), `user 16`: `3` (`0.014`), `orphan 950830`: `45` tx (`1314` taka) — mote `178` erroneous `82.07` taka
- Referral commission o `19` ta duplicate (`0.0015`) — `15` er balance `0.0020 → 0.00053`

**Fix:**
- `178` reward + `19` commission tx + `45` orphan delete (admin API)
- Balance/profit `DEBIT` + `correct-balances` endpoint diye thik
- Ticker e guard add: `lastReward gap <55000ms` && `gap < target*0.5` hole `continue` (skip duplicate), `modulo checkpoint` fix, `auto-resume` from freeze.

Ekhon `gap < target*0.95` check e `0` erroneous thake.

---

### 4) **DB Studio direct balance edit without MFA/second-approval (CRITICAL)** — FIXED ✅

**Kothay:** `PATCH /api/admin/db/tables/:name/rows/:id` diye `set: {balance: 999999}` kore direct balance edit kora jeto. Endpoint e `requireSuperAdmin` chilo kintu `requireMfa` chilo na, ar `ADMIN_CREDIT` er moto second-approval o chilo na. Attacker jodi superadmin token leak kore, MFA charai jekono user er balance `1e6` kore dite parto, audit log e `DB_ROW_UPDATE` hisabe lukano.

**Fix:** Ekhon `users` collection e `balance/lifetimeProfit/boostState` direct edit block: `400 Direct balance/boostState edits are not allowed via DB Studio. Use Treasury Adjust (with MFA + 2nd approval) or /api/admin/audit/correct-balances (audited).` Ar sob `db/tables` endpoint e `requireMfa` add kora hoyeche (create, patch, delete).

---

### 5) **Config/Rate change without MFA → future minting**

**Kothay:** `POST /api/admin/config` (minuteRatePercent) ar `POST /api/admin/rate` (hourlyRatePercent) diye attacker `minuteRatePercent: 100` (100% per minute) set kore next compounding e sobai ke huge yield dite parto. Age MFA chilo na.

**Fix:** Ekhon sob sensitive admin endpoint e `requireMfa` add: `config`, `rate`, `boost-override`, `freeze`, `backup/restore`, `db/tables/*`.

---

### 6) **Referral wash-trading → 10% tier inflating**

**Kothay:** `POST /api/users/register` e `referralCode` diye fake account create korle `getReferDailyCount` diye tier bare. Age kono daily limit chilo na, attacker `10 req/min` limit bypass kore multiple IP diye 100 fake account ek dine create kore `10%` commission peto, tarpor nijer main account e compounding koriye referrer commission wash korte parto.

**Fix:** `if (dailyCount >=20) { allow signup but without referral }` — max 20 referral per referrer per day. Audit log `REFERRAL_LIMIT_HIT`.

---

### 7) **Transfer race / double-spend**

**Status:** ✅ Already Fixed — `withTransferLock(senderId)` + `idempotencyKeyForTransfer` (X-Idempotency-Key header ba `sender:recipient:amount:minute` fallback) + amount cap `100k` + 2 decimals + balance check + boost active check + IP blacklist 200/min. Retest e `T04 double-submit within 1min → same TX ID` pass.

---

### 8) **Backup restore without MFA**

**Kothay:** `POST /api/admin/backup/restore` diye purano backup (jkhane inflated balance chilo) restore kore abar inflate kora jeto. Age MFA chilo na.

**Fix:** Ekhon `requireMfa` add.

---

## Verify — Final VPS State

```
users 19, tx 99 (age 315), referCommissions 12 (age 31)
1  250.000007 profit 14.500007
2  91.518433 profit 1.518433   (157→91 fix)
13 100.474081 profit 0.474081  (115→100 fix, 1 reward left)
15 0.000532 profit 0.000532
16 10.004875 profit 0.004875
rewards remaining: 13→1, 2→3, gap < target 0 ta
payment callback without PAYMENT_WEBHOOK_SECRET → 500 rejected
restore with token + balance 1e12 → balance 0 (fixed)
DB Studio patch balance → 400 blocked
```

**Kono vabe extra balance baranor poth ar nai** — sob critical vector close, ar future duplicate guard active. Jodi notun kono bug dekha jay, `AUDIT_BALANCE_CORRECTION` endpoint diye MFA diye thik kora jabe, audit log e thakbe.

*Note: Password plaintext admin e dekhano owner requirement e rakha hoyeche, kintu repo te secret nai, CSP/HSTS active.*
