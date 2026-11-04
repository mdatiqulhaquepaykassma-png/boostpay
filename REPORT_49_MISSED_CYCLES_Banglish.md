# REPORT 49 — Missed cycles: aj koyta miss holo, koto taka, ar lifetime

**Commit:** `ecae45a` · **Live:** `v1.2.1793789806` · **Tarikh:** 4 Nov 2026

## 1. Apnar chaoa

> "today total 24 ghontay koyta boost pabe, koyta miss hoyse, 24 ghontay koto income hoto, koto already miss hoyse — lifetime koto tk miss hoyse-o dekhabe. Ei sob boosting-er opore jei bar-e (strip) koyta cycle baki ache sekhane, ar okhane lifetime income + lifetime missed-o dekhabe."

## 2. Strip (Boosting card-er opor) — ekhon dui line

**Collapsed (85px, tap → detail):**
```
⏱ idle ≈$0.167 | ⚡ 0/1  1 left | 📈 $0/$0.167  today · $0.167 to go   ⌄
today 0/3 · 1 missed | ≈$0.167 lost | life $0 in · ≈$0.502 lost
```

**Tap korle:**
```
CYCLE            7h 32m → $0.167
NEXT CYCLE       7h 32m → +$0.167
CYCLES TODAY     0 done · 1 more × ~7h 32m
INCOME TODAY     $0 earned · $0.167 left · $0.167 total
MISSED TODAY     1 cycle → ≈$0.167
LIFETIME INCOME  $0 boost · 0 cycles
MISSED LIFETIME  3 cycles → ≈$0.502
```

## 3. Server — `GET /api/user/boost-plan` e notun field

```json
"today": {
  "cyclesDone": 0, "cyclesRemaining": 1, "cyclesPossible": 1,
  "cyclesPerDay": 3,          // 24h ÷ cycle duration = 24 ghontay koyta boost
  "slotsSoFar": 2,            // aj midnight theke eto cycle-slot periye geche
  "missed": 1,                // slots − done = miss kora cycle
  "missedIncome": 0.167
},
"lifetime": {
  "estimated": true,          // ⚠️ estimate, wallet ekta single number
  "cycles": 0, "income": 0, "referralIncome": 0, "totalIncome": 0,
  "avgCycleMs": 27114768, "avgIncomePerCycle": 0.167,
  "slots": 3, "missed": 3, "missedIncome": 0.502, "sinceMs": 88664576
}
```

**Hisheb kora hoy kivabe**
- **Ajer:** `cyclesPerDay = 24h ÷ cycle length`; `slotsSoFar = (ekhon − aj midnight) ÷ cycle length`; `missed = slotsSoFar − ajer paid cycles`; `missedIncome = missed × ei cycle-er anumanik income`.
- **Lifetime:** `income` = shob `REWARD` transaction-er jog (asol taka), + `referralIncome` alada. `slots` = account-er boyosh ÷ **je cycle gulo asole chaliyechhen tar average duration** (history na thakle ajer duration), `missed = slots − cycles`, `missedIncome = missed × average income per cycle`.
- Rate kokhono phone-e jay na — shob number server-e hishab kora.

## 4. Sotti (important)

- "Miss" mane **apni oi slot-e Boost tap korenni** — one cycle per tap rule-er karone proti slot-e alada tap lagে. Eta kono dhar, debt ba penalty na.
- **Lifetime missed ekta ESTIMATE** — wallet ekta single number, tai "ki hate parতo" model kora hoy apnar asol cycle history theke. Tai UI-te "≈" chinho deya ache.
- Cycle duration balance onujayi bodlay, tai lifetime hishebe **average** duration use hoy (ajer ta na).

## 5. Test

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **124 / 124** (+7 notun: cyclesPerDay, done+missed=slots, negative na, lifetime estimated, lifetime ≥ today, rate leak nei) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |

Browser-e 390×844 ar 320×568 duitai-te render check kora — strip 85px, overflow nei, tap korle 6 line-er breakdown.

Screenshot: `report-assets/strip-missed.png` (collapsed) · `report-assets/strip-missed-open.png` (expanded)
