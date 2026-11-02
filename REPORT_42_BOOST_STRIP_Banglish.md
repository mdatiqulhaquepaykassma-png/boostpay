# REPORT 42 — Dashboard "Today" Strip (kom shomoy, beshi tothyo)

**Tarikh:** 2 November 2026
**Commit:** `f8ec243` (feature) + `94421bb` (midnight fix)
**Ki jinis:** WalletView-er "Best Balance" card-er thik niche ekta slim row — cycle koto deri, aj koto cycle, aj koto income.

---

## 1. Apni ja cheyechilen → ja holo

| Apnar chaoa | Ki diyechi |
|---|---|
| Cycle duration + countdown | Bame timer icon: `20h 14m` ba `0m 42s` (1 second-e update hoy) |
| Anumanik income (ei cycle) | Timer-er niche choto kore `≈$2.34` |
| Boost left / aj koto cycle baki | Majhe: `12/352` + niche `340 left` |
| Ajer income: earned / still coming / total | Dane: `$0.0022/$0.0922` + niche `today · $0.0900 to go` |
| Current balance | Upore already ache (Best Balance card) — strip e repeat korini, jate space bache |
| **Minimum space** | Collapsed obosthay ek row ≈ 52px (progress bar shoho), tap korle tarpor breakdown |

Tap korle nicher 4 ta line khule:
`Cycle · This cycle left · Cycles today · Income today` — ar `Open boosting card` / `Start the next cycle` button.

---

## 2. Notun backend — `GET /api/user/boost-plan?tz=360`

Ek request-e shob number. Rate kokhono phone-e jay na — projection shudhu server-e hoy, tai phone ar ledger kokhono mile na jawa possible na.

```json
{
  "serverTime": 1793607615677, "minutesLeftToday": 580, "balance": 100,
  "cycle":     { "running": true, "durationMs": 86400000, "remainingMs": 86350,
                 "projectedIncome": 2.338115, "accruedIncome": 0.0432,
                 "remainingIncome": 2.2949, "endsAfterMidnight": true },
  "nextCycle": { "durationMs": 86400000, "estimatedIncome": 2.338115 },
  "today":     { "cyclesDone": 0, "cyclesRemaining": 1, "cyclesPossible": 1,
                 "earned": 0, "remainingIncome": 2.338115, "projectedTotal": 2.338115 }
}
```

- `tz` = phone-er UTC offset minute-e (Dhaka = `360`). Tai **"aj" mane apnar phone-er midnight**, server-er UTC midnight na.
- `earned` = aj (local midnight theke) credited `REWARD` transaction gulo.
- `remainingIncome` = ekhon cholte thaka cycle-er baki + ajer vitore start-and-finish korte para porer cycle gulo (back-to-back dhore, guard 2000).
- `Cache-Control: no-store`, `requireUser` diye protected (agent/admin token 401).

---

## 3. Testing-e duita asol bug dhora porlo (fix kora hoyeche)

1. **Purono duration dekhato.** Cycle sesh hole `targetDurationMs` DB-te pore thake. Ekjon user jokhon $10 balance-e chilo tokhon 1 minute cycle peyechilo; balance bere 24 ghontar cycle hole-o strip "1 minute" dekhacchilo. → Ekhon idle obosthay notun tap je duration pabe, shetai dekhay (verified: `cycle 14756170ms = next 14756170ms`).
2. **Midnight-er porer cycle ajer income hisebe chole jeto chupchap.** → Ekhon cycle-er `endsAfterMidnight` flag ache; strip lekhe `after 12am $2.34`, ar breakdown-e `This cycle ends: after midnight (counted tomorrow)`. Cycle-ta count theke gay na (taka aschhe), kintu "aj" bole bhul dabi kore na.

---

## 4. Test result (local `:3901`, fresh seed)

| Suite | Age | Ekhon |
|---|---|---|
| `tools/user-journey.py` | 56/56 | **65/65** (+9 notun check) |
| `tools/regression.cjs` | 42/42 | **42/42** |
| `tools/system-check.py` | no problems | **no problems** |
| `tsc --noEmit` | clean | **clean** |
| `vite build` | clean | **clean** |

Notun 9 ta check (`4b. the today strip`):
strip load hoy · paused cycle-er checkpoint thake · accrued+remaining = projected · earned+toGo = total ar done+remaining = possible · **rate response-e nei** · idle duration = next duration · `tz` onujayi dayStart shore · token chara 401 · agent token 401.

> Note: majhkhane regression 39/3 ar 36/6 dekhachilo — seta amar nijer bar-bar login kora-r karone per-IP+email lockout e pore giyechilo (feature bug na). Server restart + fresh seed er por abar 42/42.

---

## 5. Deploy obostha

- `git push` (non-force, deploy key) → `f8ec243`, tarpor `94421bb`.
- Live `https://boostpay.online/api/health` version `v1.2.1793608008`-e giye endpoint eshe geche:
  `GET /api/user/boost-plan?tz=360` → **401 `Authentication required`** (age chilo `404 API_NOT_FOUND`), matlab route live.
  `94421bb` (midnight fix) er redeploy shesh hole version abar palte jabe.
- Baki live probe: `/api/definitely-not-real` → 404 JSON, `/wallet` → 200, security header ager motoi.

**Kivabe dekhben:** app-e login → Wallet → Best Balance card-er niche slim row. Cycle chalu thakle amber, pause-e grey, idle-e `idle` + porer cycle-er duration.

---

## 6. Preview file

`boost-strip-preview.html` — 3 ta obostha (1-minute cycle, 24-hour cycle, tap kora version) —
browser-e khule phone-er moto dekhte parben, app install chara.

---

## 7. Khola thaka (apnar decision lagbe)

1. FCM push (`google-services.json` chhara closed-app push hocche na)
2. Play Store ($25 + signed AAB), iOS
3. CF Access on admin hosts
4. Console app gulo-r CSP refactor
5. Hold semantics: $100 balance-e $10 hold → $90 sendable. Apnar ki "hold er cheye kom send ekdom bondho" chaichhen? (ager prosno-er uttor baki)
