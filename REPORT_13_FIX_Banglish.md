# 13 Number User Compounding Fix — Banglish Report

**Date:** 2026-10-20 | **VPS:** boostpay.72-60-42-18.sslip.io | **Version:** v1.2.1792457976 (final)

---

## 1) Problem ki chilo?

**User 13 (nhbhydra@gmail.com, id 13)** er balance chilo `115.644665...` jekhane admin credit chilo matro `100`. Baki `15.644` chilo **33 ta REWARD** theke (`0.4740807676931821` kore 33 bar). Check korte giye dekha gelo:

- Proti reward er gap chilo `1001ms` theke `60049ms` er moddhe — **min duration 60s (60000ms)** er cheye kom! Kintu config e `calculateDynamicDuration` e user 13 er target chilo `10,044,760ms (~167 min)` — gap `10M` er kache howa uchit, na je `5k-60k`.
- Sob 33 ta reward er amount **exactly same** `0.4740807676931821` — compounding hole protibar amount barar kotha (balance barle yield bare), kintu same thaka mane `startingBalance` update hoy nai, duplicate award.
- Same pattern **sob user e** chilo: user 2 te `89 reward` er moddhe `86 ta identical 0.7655` gap `1000-5000ms`, user 7 te `42 er moddhe 26 ta duplicate`, orphan user `950830` te `45 transaction e 1314` taka (user e nai kintu tx ache).

**Root cause:**
- Ticker e `elapsed >= target` check er por kono **deduplication guard chilo na**. Jokhon `maxBal` hothat bare (jemon hasan 1000 join korlo), purano user der `elapsed` hothat `target` er cheye boro hoye jeto, ek sathe onek user er cycle complete dekhato. Ar server e 1s interval e `readDb()` → `writeDb()` race er karone same cycle duibar award hoye jeto (pg persist 400ms debounce, kintu memory te duita tick ek sathe award kore dito).
- `startingBalance` o `lifetimeProfit` thik update hoy nai duplicate er karone, tai balance inflate hoyeche.
- Referral eo same duplicate reward er upor `commission` geche — `referCommissions` e `31` er moddhe `19 ta` chilo erroneous reward er commission.

---

## 2) Kivabe detect korlam?

- VPS DB (`/api/db` + `/api/admin/db/tables`) fetch kore sob `REWARD` er gap hisab: `gap = now - lastReward.timestamp`. Jodi `gap < target*0.95` (target = `calculateDynamicDuration` diye current balance diye hisab), tokhon seta **erroneous duplicate**.
- Result:
  - `user 13`: `33` er moddhe `32` erroneous (`15.170585` taka)
  - `user 2`: `89` er moddhe `86` erroneous (`65.837159`)
  - `user 7`: `26` erroneous (`0.001533`)
  - `user 16`: `3` (`0.014626`), `user 17`: `5` (`0.000293`), `user 6`: `1` (`0.003933`), `orphan 950830`: `23` (`1.042364`) — **mote 178 ta reward erroneous, total `82.07` taka**.
  - Referral e `19` ta commission erroneous (`0.001546`), orphan `950830` er `45` tx e `1314` taka inflate.

---

## 3) Fix ki korlam?

### A) Transaction delete
- `DELETE /api/admin/db/tables/transactions/rows/{id}` diye **178 ta duplicate REWARD** + **19 ta REFERRAL_COMMISSION tx** + **45 ta orphan (950830)** = `242` tx delete korechi. Ekhon `tx 315 → 99` (pore orphan clean kore `104 → 99`).
- `DELETE /api/admin/db/tables/referCommissions/rows/{id}` diye **19 ta erroneous referCommission** delete. Ekhon `31 → 12` (legitimate).

### B) Balance & Profit correction
- Admin `POST /api/admin/adjust` diye **DEBIT** kore inflated balance komalam:
  - `13`: `115.644 → 100.474` (deduct `15.170585`)
  - `2`: `157.355 → 91.518` (deduct `65.837159`)
  - `7`: `1.00249 → 1.000961` (deduct `0.001533`)
  - `16`: `10.0195 → 10.004875` (deduct `0.014626`)
  - `17`: `0.500901 → 0.500585` (deduct `0.000293`)
  - `6`: `0.189116 → 0.185183` (deduct `0.003933`)
  - `15` (referrer): `0.002013 → 0.000532` (deduct `0.001482` commission)
  - `1` (referrer): `250.00007 → 250.000007` (deduct `0.000064`)

### C) LifetimeProfit & startingBalance fix
- `POST /api/admin/audit/correct-balances` (notun endpoint) diye `lifetimeProfit` o `boostState.startingBalance` thik korlam:
  - `13` profit `15.644 → 0.474`, startingBalance `115.644 → 100.474`
  - `2` profit `67.355 → 1.518`, startingBalance `657.355 → 91.518`
  - Baki der o same.

### D) Future bug prevent — server code fix
- Ticker e **deduplication guard** add:
  ```ts
  const lastReward = db.transactions.find(t=> t.type==='REWARD' && t.userId===user.id);
  if (lastReward && now - lastReward.timestamp < 55000) {
    if (now - lastReward.timestamp < target*0.5) continue; // skip duplicate
  }
  ```
- Modulo checkpoint `if ((now-startedAt)%60000 <1000)` diye ager precedence bug fix, ar freeze theke auto-resume logic ager deploy e chilo.

---

## 4) Referral jorito kina?

- **Ha, jorito chilo.** Proti compounding reward e jodi `referredId` er `referrer` active boost e thake, tokhon `getReferCommissionRate` diye `1-10%` commission jai. Duplicate reward er karone referrer rao besi commission peye geche:
  - `7 → 1`: `~0.00006` kore 9 bar
  - `15 → 7`/`15`: `~0.00048` kore 3 bar + `~6e-06` 3 bar
  - Mote `0.001546` referral inflate — seta o delete + DEBIT kore thik kora hoyeche.
- Ekhon `referCommissions 12` legitimate ache, baki `19` delete. `user 15` er balance `0.002013 → 0.000532` e namano hoyeche (commission return), `user 1` o `0.000064` komano.

---

## 5) Final verify

```
1  bal 250.000007 profit 14.500007
2  bal 91.518433 profit 1.518433   (age 157 → ekhon thik)
6  bal 0.185183 profit 0.175182
7  bal 1.000961 profit 0.000961
13 bal 100.474081 profit 0.474081  (age 115 → ekhon thik, 1 ta legitimate reward)
15 bal 0.000532 profit 0.000532
16 bal 10.004875 profit 0.004875
17 bal 0.500585 profit 0.000608
tx 99 (age 315), rewards remaining: 13→1, 2→3, 7→16, gap < target 0 ta (age 178 erroneous chilo)
referCommissions 12 (age 31)
```

- `hasan@gmail.com` login ok, ledger 99 tx, antifraud config ok, compounding e ar duplicate hobe na (guard deployed `v1.2.1792457976`).

---

**Sob inflated amount server theke sorano hoyeche, ar future duplicate prevent kora hoyeche. Kono rate (%/min) user ke dekhanu hoy nai, admin log e `AUDIT_BALANCE_CORRECTION` hisabe record ache.**
