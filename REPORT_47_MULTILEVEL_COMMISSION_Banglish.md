# REPORT 47 — Unlimited level commission, proti level-e half

**Commit:** `1cb9eb9` · **Tarikh:** 4 Nov 2026

## 1. Apnar nirdesh

> "refer tree theke o commission pabe — unlimited level porjonto. Proti level-e commission half hoye jabe: 1st level akhon er moto 10%, 2nd 5%, 3rd 2.5% … unlimited."

## 2. Ja holo

Ei porjonto commission shudhu **direct** referrer peto. Ekhon ekta cycle shesh hole **puro upline chain** (unlimited upor porjonto) commission pay:

| Level | Rate | Koto |
|---|---|---|
| L1 (direct referrer) | apnar **ajer tier rate** (1–10%, age-r motoi) | 10% |
| L2 | L1 ÷ 2 | 5% |
| L3 | L1 ÷ 4 | 2.5% |
| L4 | L1 ÷ 8 | 1.25% |
| … | … | … unlimited |

- Rate ta **L1-er tier rate** theke shuru hoy (global daily ranking, age-r motoi — L1-er behaviour ekdom bodlayni).
- Sob level-er jog = 2 × L1 (jemon 10% → 20%), tai per-cycle total ceiling 20% hisebe server-e guard rakha hoyeche.
- Dust guard: kono level-e commission $0.00000001 er niche hole sei level skip (ledger abrja na barate), ar cyclic/corrupt referral link hole loop theme jay (visited set + max 60 level).
- Frozen/blocked upline oi level-er share pabe na, kintu tar uporer level gulo payout pete thake.

## 3. Live proof (local server, asol ticker)

Chain: `U1 ← m1 ← m2 ← m3`, m3 ekta cycle shesh korlo (yield `$0.00001247`):

| Receipt | Level | Rate | Amount |
|---|---|---|---|
| m2 | L1 | 10% | $0.0000012467 |
| m1 | L2 | 5% | $0.0000006234 |
| U1 | L3 | 2.5% | $0.0000003117 |

Exactly half, exactly quarter — ar ti-er jog = 17.5% (20%-er niche)।

## 4. Database / ledger

- `referCommissions` row-e notun field: `level` (1, 2, 3 …), ar `rate` ekhon 2 decimal (2.5, 1.25)।
- `transactions`-e `REFERRAL_COMMISSION` tx: notes `L2 referral commission 5% on User #3 compounding $…`, `metadata: { referredId, rate, level, sourceTxId }`.
- Notification: `REFERRAL EARNED: +$… (L2 · 5% of User #3 yield $…)`।
- **Refer page** (user app):
  - commission row: `From #3 @ 5% · L2` + chip `L2 5%`
  - detail modal: notun **Level** row
  - explainer: "L1 10% → L2 5% → L3 2.5% → L4 1.25% …, unlimited levels"

## 5. Test

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **109 / 109** (age 95; +14 notun commission check) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |

Notun check gulo: 3-deep chain banano · deepest member cycle chalu · cycle shesh · L1/L2/L3 protteke commission pay · **L1 = ajer tier rate** · **L2 = L1/2** · **L3 = L1/4** · **amount-o half** · level stamp · kono level L1-er cheye beshi pay na · nijer cycle theke nije commission pay na.

Notun section ta 2.5 min wait kore (asol cycle shesh hote hoy) — tai journey suite ekhon ~4 min ney. Kono kichu fake kora hoyni.

## 6. Screenshot

`report-assets/refer-multilevel.png` — Refer page-e `From #3 @ 5% · L2` + `L2 5%` chip.

## 7. Duita jinis jene rakha dorkar

1. **Ei commission age-r motoi "mint" hoy** (referrer-er balance barhe, je cycle korlo tar yield theke katar hoy na). Tai L1+L2+L3+… = L1 × 2 — mane apnar current payout volume theke ~2 gun hobe. Chaile "je cycle korlo tar yield theke kete dewa" korte pari, kintu seta financial rule bodlabe — apnar alada "ha" lagbe.
2. **Tier rate ta global daily**: L2/L3 rate ta L1 referrer-er ajer tier theke ashe (ke aj koto jon join koriyeche tar ranking). Mane aj tier 4% hole L1 4%, L2 2%, L3 1%.

Revert path: `git revert 1cb9eb9` — commission abar shudhu direct referrer e firbe.
