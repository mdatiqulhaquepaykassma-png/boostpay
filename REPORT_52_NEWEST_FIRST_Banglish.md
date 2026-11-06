# REPORT 52 — Day-by-day list: notun opore, purono niche

**Commit:** `41c8002` · **Live:** `v1.2.1793994869` · **Tarikh:** 7 Nov 2026

## 1. Apnar chaoa
> "notun gulo opore thakbe, old gulo niche thakbe"

Age list oldest → newest chilo (mismask neoẏe)। Ekhon **aaj er din shobar opore**, tar nicher din gulo nicher dike — WhatsApp/statement-er moto.

## 2. Ekhon ki dekhbe

```
┌ DAY BY DAY · SINCE 2026-11-01        SUM = LIFETIME ┐
│ DAY     BAL       PROFIT      MISSED        C/S    │
│ 11-07   $42.50    +$0         no miss       0/0    │  ← aaj (opore)
│ 11-06   $41.94    +$0.556     ≈$0.446 miss  1/2    │
│ 11-05   $40.63    +$1.31      no miss       2/2    │
│ 11-04   $40.63    +$0         ≈$0.836 miss  0/2    │
│ 11-03   $38.66    +$1.98      no miss       3/3    │
│ 11-02   $38.04    +$0.622     ≈$0.366 miss  1/2    │
│ 11-01   $36.77    +$1.27      no miss       2/2    │  ← shob theke purono (niche)
└────────────────────────────────────────────────────┘
LIFETIME INCOME · 7D     $5.73 boost · 9 cycles
PROFIT MISSED LIFETIME   4 cycles → ≈$1.65
```
Header-er `SINCE 2026-11-01` ekhon **shob theke purono din** দেখায় (list-er niche-r row), ar scroll korei purono dine jaowa jay।
Jogfol/lifetime hisheb age-r motoi — sudhu **order** ulta hoyeche।

## 3. Technique
- `lifetime.series` array ekhon **newest → oldest** (index 0 = aaj)
- `todayRow` = `series[0]` (strip-er collapsed chip ar expanded "today" row ekhon oi row thekei ashe, tai dutoi shob shomoy mile)
- Header-er "SINCE" = `series[last]` (purono din), onek purono account hole `(last 1y)` label

## 4. Test
- Notun check: **"day rows are newest-first and the first row is today"** (date order descending + top row = ajker din)
- Sathe purono ekta flaky check thik kora hoyeche: "the day follows the phone" age `dayStart + 6h` fixed offset compare korto, ja UTC 18:00 er por (Dhaka-e midnight) bhul fail korto. Ekhon check kore — local midnight puro din, `now` tar bhitore, ar UTC midnight er theke alada।

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **129 / 129** |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |
| Browser | 390×900 + 320×640 (Asia/Dhaka), 7-din demo account — top row 11-07 (aaj), bottom 11-01 |

Screenshot: `report-assets/lifetime-newest-first.png` · `report-assets/lifetime-newest-first-320.png`
