# REPORT 50 — "lost" → "profit miss" (word bodlano)

**Commit:** `c39f0c7` · **Live:** `v1.2.1793795526` · **Tarikh:** 4 Nov 2026

## 1. Apnar chaoa
> "lost er jaygay profit miss likhe dan, jate user bojhe se tar koto profit miss koreche."

Puro strip-e "lost" shob jaygay **"profit miss"** kora hoyeche — user ek nojore bujhbe eta tader *profit* jeta tara miss korche, kono charge/penalty na.

## 2. Ki ki bodlalo

| Age | Ekhon |
|---|---|
| `≈$0.228 lost` | `≈$0.228 profit miss` |
| `life $0 in · ≈$0.455 lost` | `life $0 in · ≈$0.455 profit miss` |
| `MISSED TODAY` (row) | `PROFIT MISSED TODAY` |
| `MISSED LIFETIME` (row) | `PROFIT MISSED LIFETIME` |

Collapsed strip (85px):
```
⏱ idle ≈$0.114 | ⚡ 0/1  1 left | 📈 $0/$0.114  today · $0.114 to go  ⌄
today 0/4 · 2 missed | ≈$0.228 profit miss | life $0 in · ≈$0.455 profit miss
```

Tap korle:
```
CYCLES TODAY           0 done · 1 more × ~5h 54m
INCOME TODAY           $0 earned · $0.114 left · $0.114 total
PROFIT MISSED TODAY    2 cycles → ≈$0.228
LIFETIME INCOME        $0 boost · 0 cycles
PROFIT MISSED LIFETIME 4 cycles → ≈$0.455
```

## 3. Note
- Number/hisheb e kono bodlano hoyni — shudhu **word** (copy)। API, rate, ledger sob age-r motoই।
- "≈" chinho thakলো, karon lifetime ta estimate (wallet ekta single balance number)।

## 4. Test
`user-journey` **124/124** · `regression.cjs` 42/42 · `system-check` clean · tsc + vite build clean · live bundle `/assets/index-BD4yt6wg.js`-e "profit miss" confirm kora hoyeche.

Screenshot: `report-assets/strip-profit-miss.png` (collapsed) · `report-assets/strip-profit-miss-open.png` (expanded)
