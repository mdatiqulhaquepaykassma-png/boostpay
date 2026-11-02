# REPORT 45 — Team Tree ekhon ekta chhoto card, click korle full list

**Commit:** `8224fa1` (UI) + `6e9687b` (test rerun-safe) · **Live:** `v1.2.1793613144`

## 1. Apnar point

> "tree te click korle full list dekhabe — akhon refer page tree deye vore gase, ata te click korle full list asbe"

Thik — age puro tree ta Refer page-ei boshe chilo, page ta lomba hoye jacchilo. Ekhon:

## 2. Ki badlalo

**Refer page-e ekhon shudhu ekta patla card (63px):**

```
🧱 My Team Tree  (7)                       Full list ›
   L1 3 · L2 3 · L3 1        +3 today
```

**Card-e click → full list** ekta bottom-sheet-e khule (screen-er 92%, upor-er stats + puro tree, sheet-er vitorei scroll hoy):

```
🧱 My Team Tree                 ⟳  ✕
   7 members · 3 levels
[TOTAL 7] [DIRECT 3] [DEPTH 3] [BOOSTING 0]
L1 3  L2 3  L3 1

 YOU  #U1                          team 7
 ↳ #3   L1                      1m ago
 › #2   L1  team 1              1m ago
 ⌄ #1   L1  team 3              1m ago
    ↳ #5   L2                  1m ago
    ⌄ #4   L2  team 1          1m ago
       ↳ #7   L3               1m ago
```

- `›` tap → oi member-er team khule (unlimited level), `⌄` tap → bondho
- sheet-er baire click ba `✕` → bondho
- row-e `team N` = oi member-er niche koto jon
- `Message` button → sheet bondho hoye oi member-er chat khule

**Important:** tree-er member list **sheet kholar age fetch hoy na** — tai Refer page khub halka thake, ar boro team-er jonno-o phone-e bojha pore na (prottek level 100 row, tarpor `Load more`)।

## 3. Ekta bug dhora porlo (fix korechi)

Sheet-er niche **bottom nav bar ta upore paint korchilo** (because nav-er nijer stacking context ache) — mane sheet-er nichi diye nav dekha jeto. Fix: sheet ta ekhon **React portal** diye `<body>`-e mount hoy, tai nav sheet-er niche chole jay. Verify: nav-er centre-e `elementFromPoint` ekhon sheet return kore, nav na.

## 4. Test

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **83 / 83** (por por duibar chalিয়ে, same DB-te-o 83/83) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |

Harness-o improve korechi: tree test ekhon (a) prottek run-e unique email use kore, (b) count gulo **delta** hisebe check kore — tai local DB-te purono member thakleo test ta fer-o fail kore na.

Browser-e verify (Playwright, 390×844): card 63px, click → sheet, `#1` → `#5 #4` khule, `#4` → `#7` (L3) khule, `✕` → bondho, nav sheet-er niche.

Screenshot: `report-assets/team-card.png` (compact card) · `report-assets/team-sheet.png` (full list)

## 5. Note

- Server-side logic (team build, permission, privacy) ei turn-e **touch hoyni** — shudhu UI layout bodlalo.
- Refer page-e ager motoi ache: refer code, tier countdown, Lifetime earnings, Live Referral Panel (direct referrals-er balance/cycle), apply code, commission history.
