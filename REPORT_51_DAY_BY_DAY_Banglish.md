# REPORT 51 — Lifetime income + profit miss = din-bhayi hishab (day by day)

**Commit:** `79e19fe` · **Live:** `v1.2.1793987360` · **Tarikh:** 6 Nov 2026

## 1. Apnar chaoa
> "lifetime bolte account kholar por kon din koto tk miss hoyeche — suppose 1 tarik e account khulche, sei din balance koto chilo ar koto tk miss koreche, emon kore protidin er koto tk miss hoyeche seta bojhabe. Abar kon kon din koto tk income/profit hoyeche seitar jogfol-o bojhabe."

Age lifetime ta ekta **average** diye estimate chilo (ek number). Ekhon eta **asol din-bhayi ledger** — prottek diner row, ar "lifetime" mane oi row gulor **jogfol**।

## 2. Strip-e ekhon ki dekhabe

Collapsed (same 85px):
```
today 0/2 · 2 missed | ≈$0.936 profit miss | life $6.29 in · ≈$1.73 profit miss
```

Tap korle (expanded):
```
CYCLE                    11h 22m → $0.468
NEXT CYCLE               11h 22m → +$0.468
CYCLES TODAY             0 done · none left today
INCOME TODAY             $0 earned · $0 left · $0 total
PROFIT MISSED TODAY      2 cycles → ≈$0.936
LIFETIME INCOME · 7D     $6.29 boost · 9 cycles
PROFIT MISSED LIFETIME   4 cycles → ≈$1.73

┌ DAY BY DAY · SINCE 2026-10-31        SUM = LIFETIME ┐
│ DAY     BAL       PROFIT      MISSED        C/S    │
│ 10-31   $36.21    +$0.439     no miss       1/1    │
│ 11-01   $36.65    +$1.29      no miss       2/2    │
│ 11-02   $37.95    +$0.568     ≈$0.373 miss  1/2    │
│ 11-03   $38.51    +$1.85      no miss       2/2    │
│ 11-04   $40.36    +$0.478     ≈$0.422 miss  1/2    │
│ 11-05   $40.84    +$1.66      no miss       2/2    │
│ 11-06   $42.50    +$0          ≈$0.936 miss  0/2    │
└────────────────────────────────────────────────────┘
```
- **DAY** = kon din
- **BAL** = oi din shuru-te apnar balance koto chilo
- **PROFIT** = oi dine asole koto profit peyechhen
- **MISSED** = oi dine koto profit miss korechen (≈)
- **C/S** = oi dine koyta cycle hoyeche / koyta slot chilo

## 3. Server — `lifetime` block

```json
"lifetime": {
  "days": 7, "truncated": false, "since": 1793708782053,
  "income": 6.2872, "referralIncome": 0, "totalIncome": 6.2872,
  "missed": 4, "missedIncome": 1.73009536,
  "slots": 12, "cycles": 9,
  "series": [
    { "day": "2026-10-31", "balance": 36.2128, "cycleMs": 40920000,
      "slots": 1, "cycles": 1, "earned": 0.4386, "referral": 0,
      "missed": 0, "missedIncome": 0 }
    /* … ekta row per din, oldest → today */
  ]
}
```

**Hisheb:**
- **Prottek diner balance**: wallet aaj ek-ta number, tai diner shuru-r balance **back-calculate** kora hoy — aaj er balance theke oi diner pore je transaction gulo hoyeche segulo ulta bad diye (`CREDIT_TYPES` / `DEBIT_TYPES` list diye)।
- **Diner cycle length**: oi diner shuru-r balance diye `calculateDynamicDuration()` — balance beshi hole cycle lomba, tai prottek diner nijer duration ধরা hoy।
- **Slots** = oi dine koyta cycle dhore (signup din ar aaj pro-rated — puro din na)। **Missed** = slots − oi dine paid cycle।
- **Slice guard**: kono dine ledger-e cycle thakle slot count tar niche name na.
- **Timezone**: din-এর boundary phone-er midnight (Dhaka = UTC+6), server-er UTC na।
- **Row limit**: ek bochor (366 din) — tar beshi purono account hole `truncated: true` ar list-e "last 1y" dekhabe; totter jogfol oi window-er।
- `lifetime.income/missed/missedIncome/slots` shob **row gulor sum** — tai expanded view-er "SUM = LIFETIME" shotti-i mile।

## 4. Accuracy note (sotti)
- **PROFIT (earned)** = ledger theke asol taka — 100% accurate।
- **BAL** = back-calculated, tai jodi kono purono transaction mudrik-krito na thake (jemon promotion bonus) tahole oi diner balance ektu differ korte pare. Amra credit/debit type-er puro list dhorechi।
- **MISSED** ta "oi dine balance ta diye cycle chalale koto hate parto" — estimate (≈), karon ek cycle per tap ar tap korenni bole।
- Lifetime ager average-model theke ekhon **din-bhayi sum** — number ta bodlate pare (beshi accurate)।

## 5. Test

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **129 / 129** (+5: row count = days, prottek row-e balance+cycle, date order + last row = today, row sum = lifetime, cycles ≤ slots) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |
| Browser | 390×844 + 320×568 (timezone Asia/Dhaka), 7-din er demo account diye render + scroll check |

Screenshot: `report-assets/lifetime-day-by-day.png` (390) · `report-assets/lifetime-day-by-day-320.png` (320)
