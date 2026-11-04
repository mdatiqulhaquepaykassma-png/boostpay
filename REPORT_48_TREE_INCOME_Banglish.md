# REPORT 48 — Tree-e income: kon member theke koto pelam

**Commit:** `56335ed` · **Live:** `v1.2.1793787906` · **Tarikh:** 4 Nov 2026

## 1. Apnar chaoa

> "tree te click korle income dekhabe — tree e giye user e click korle tare diye amader koto income hoyeche seita dekhabe."

## 2. Ki holo

**My Team Tree** sheet-e ekhon taka dekha jay:

### (a) Sheet header
```
My Team Tree
8 members · 3 levels · earned $0.00000004
```

### (b) Prottek member row-e income chip
```
YOU #U1                                   team 8
⌄ #7  L1   [+$0.00000004]  team 2   3h ago  💬
   INCOME THROUGH #7   [$0.00000004]
   their own boost $0 · their team $0.00000004
› #8  L2   [+$0.00000004]  team 1   3h ago  💬
› #3  L1                    team 1   3h ago  💬
› #2  L1                    team 2   3h ago  💬
```

- **`+$X`** = oi member **ar tar niche puro team** theke apnar earn kora commission (multi-level hishebe)
- member tap korle **INCOME THROUGH** bar khule: oi member-er **nijer boost** theke koto + tar **team** theke koto (exact split)
- compact card-e-o dekha jay: `My Team Tree (8) · L1 3 · L2 3 · L3 2 · earned $…`

## 3. Server — income attribution

`GET /api/user/team/summary` → notun `income` block:
```json
"income": { "total": 4.121e-08, "last24h": 4.121e-08, "topMember": { "id": "9", "amount": 4.121e-08 } }
```
`GET /api/user/team/children?parentId=…` → prottek row-e:
```json
{ "id": "7", "incomeSelf": 0, "incomeTeam": 4.121e-08 }
```
ar expanded node-er jonno `node: { incomeSelf, incomeTeam }`.

Kivabe hishab:
- `db.referCommissions` theke amar (caller-er) shob commission niye,
- prottek row-er jonno **graph walk**: `incomeSelf` = oi member-er nijer cycle theke; `incomeTeam` = oi member + tar niche shobai (subtree) theke,
- tai **level-1 member gulor `incomeTeam` er jog = total team income** (subtree gulo disjoint) — ei ta test-e verify kora.
- Purono commission row (jegulo-te `level` field nei) o thik moto hishabe dhukbe — graph diyei attribution hoy.
- Nije nijer commission kokhono count hoy na; team-er baire kono row ignore hoy.

## 4. Test

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **117 / 117** (age 109; +8 notun income check) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |

Notun check: summary-e income total · prottek row-e self/team split · **L1 member-der incomeTeam er jog = team total** · income negative na · team income ≥ nijer income · row-e naam/email nei · member khulle income ashe · token chara 401.

Browser-e-o (Playwright, 390×844): login `u1` → Refer → My Team Tree → `#7` tap → `INCOME THROUGH #7 $0.00000004 · their own boost $0 · their team $0.00000004`। Screenshot: `report-assets/tree-income.png`।

## 5. Note

- Ei feature **shudhu porar jonno** — commission-er hishab ba payout logic bodlano hoyni.
- Refer page-er purono "Lifetime Referral Earnings" card age-r motoi ache (oi ta total), tree ta ekhon bole **kar theke** koto eshechhe.
- `income.total` ar `recentCommissions` er jog ek-i (same source), tai duita number kokhono mile na jawa uchit na.
- Deploy-er samoy GitHub-er ekta "Git Operations" incident chilo — prothom push `Internal Server Error` diye reject hoy, kintu pore push hoye geche ar Dokploy redeploy koreche (version `v1.2.1793787906`)। Code hariye jayni।
