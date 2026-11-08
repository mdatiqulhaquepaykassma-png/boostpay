# REPORT 65 — Backfill er gonona + counter fix — Banglish

**Date:** 2026-11-08
**Commits:** `b1bd849` (double-count fix) · `e9e73ab` (Fix counters + §27)
**Live:** `v1.2.1794172281`, promo console bundle `assets/index-5LA5xBsR.js`

---

## 1. Apnar proshner uttor (production DB read-only check)

**"Give to existing users" click er phol:**

| Kotha | Sonkha |
|---|---|
| Bonus peyeche | **184 jon** (shob account — karo nai emon ekjon o nei) |
| Backfill er nijer report | `given to 183 existing account(s)` (audit `WELCOME_BACKFILL`, by `billal@gmail.com`) |
| + #185 (agei peyechilo) | +1 → total 184 |
| Protijoner | **$1** → total **$184** |
| Double pay | **0** (184 grant / 184 user) |
| Spend / expire | 0 — shob `ACTIVE`, `remaining $1` |
| Bonus ledger | 184 ta `BONUS_CREDIT`, sum = $184 ✔ |

Bonus ta **Bonus wallet** e (Available Balance e na) — withdraw korte parbe, transfer parbe na (apnar tick onujayi).

**#186 o peye geche** — grant `BG-42461073`, $1, 20:39Z. Review approve korar dorkar nai; purono `RV-43696471` **stale** — **Reject** korlei queue porishkar.

## 2. Bug dhora porse: campaign slot double-count

Backfill er code nijei `used` barato, ar engine (`creditCampaignBonus`) o barato → **proti user 2 bar**:

```
asol grant  = 184
campaign used = 367  (366 + #185)   ← vul
remaining slots = 500 - 367 = 133   ← asole 316 howa uchit
```

Mane 133 jon signup korlei campaign "full" hoye jeto, 316 ta slot kharap.

**Fix (deployed):** backfill er extra increment sorano hoyeche — ekhon proti paid user e **1 slot**. Journey e ei niyom check kora hoy (notun check: "the campaign counts one slot per paid user, not two").

## 3. Notun feature: "Fix counters" (campaign card)

Purono drift (ei campaign er 367) DB te kora nai — karon production Postgres e state thake ar ami admin hisebe login korte pari na. Tai **ek click er repair tool** banalam:

Promo console (refresh koren) → WELCOME card → **Fix counters**

- Prothome dry-run dekhay: `slots used: 367 → 184`, `budget used: $184 → $184`
- Confirm korle counter bonus ledger theke abar hishab hoy
- **Kono taka move hoy na**, idempotent, audit log: `CAMPAIGN_RECOUNT`
- SUPERADMIN only (normal user → 401)

Click korar por: `remainingSlots` **133 → 316** hoye jabe.

## 4. Notun API

```
POST /api/admin/promo/campaigns/recount
  {campaignId, dryRun:true}              → {dryRun:true, campaigns:[{code, before, after, changed}]}
  {campaignId, confirm:true}             → counter ledger theke set kore
```

## 5. Test

| Suite | Result |
|---|---|
| User journey (**§27** +5 check, total 326) | **326 pass / 0 fail** |
| Regression | 42 / 0 |
| System check | no problems |
| tsc (server/promo) + vite build | clean |
| Live route | `POST …/campaigns/recount` unauth → **401** (route ache) |

## 6. Ekhon baki (2 click, apnar console theke)

1. **WELCOME card → Fix counters** → confirm → slots `367 → 184` (remaining 133 → 316)
2. **Fraud reviews → `RV-43696471` → Reject** (stale — #186 er $1 already peyeche)

## 7. Mone rakhar kotha

- `dupIp` / `dupDevice` ei campaign e ekhono **on** — shared mobile IP er area te notun user abar hold hote pare. Tick flip korte: WELCOME → Edit → **Duplicate account check — same IP → Ignore the IP**.
- Revert path: `git revert e9e73ab b1bd849` — counter repair tool baad dileo engine er counting thik thakbe.
