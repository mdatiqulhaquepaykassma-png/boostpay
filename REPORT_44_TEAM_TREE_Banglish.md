# REPORT 44 — Refer page-e Team Tree (unlimited level)

**Commit:** `431e7ba` · **Tarikh:** 2 Nov 2026

## 1. Apni ja cheyechen

> "refer e total team member tree show korbe — user er under e unlimited level porjonto koto jon join koreche sei amount show korbe, and tree show korbe jate bojha jay team kar under e koto jon ache."

## 2. Ki banaisi (Refer tab-e, refer code card-er niche)

**Ekta card: "My Team Tree"**

Top-e 4 ta boro number:
| Total Team | Direct | Depth | Boosting |
|---|---|---|---|
| 7 (all levels) | 3 (level 1) | 3 levels | 0 right now |

Tarpor per-level chips: `L1 3` `L2 3` `L3 1` `+3 today`

Tarpor tree:
```
YOU  #U1                                    team 7
 ↳ #3   L1                              2m ago
 › #2   L1   team 1                     2m ago
 ⌄ #1   L1   team 3                     2m ago
    ↳ #5   L2                          2m ago
    ⌄ #4   L2   team 1                 2m ago
       ↳ #7   L3                       2m ago
```
- `›` mane oi member-er nijer team ache — tap korle khule jay (joto level, unlimited)
- `team N` = oi member-er niche koto jon ache (tader nijer team)
- `L1/L2/L3…` = apnar theke koto level niche
- choto dot: **green = ekhon boost korche**, amber = pause, grey = idle
- prottek row-te `Message` button — oi member-ke direct message

## 3. Server — duita notun endpoint (duitai user token lage)

**`GET /api/user/team/summary`** — shudhu count, kono member list na (phone-e halka):
```json
{ "total": 7, "direct": 3, "depth": 3,
  "byLevel": [{"level":1,"count":3},{"level":2,"count":3},{"level":3,"count":1}],
  "boostActive": 0, "boostPaused": 0, "joinedToday": 3, "newestJoinAt": 1793611760550 }
```

**`GET /api/user/team/children?parentId=<id>&offset=&limit=`** — ek level, tap korle:
```json
{ "parentId": "U1", "childCount": 3, "hasMore": false,
  "children": [{ "id": "1", "level": 1, "teamSize": 3, "directCount": 2,
                 "boostActive": false, "boostPaused": false, "joinedAt": 1793611760283 }] }
```

**Kivabe kaj kore:**
- Tree ta `db.referrals` theke BFS diye banano — kono alada tree table nei, tai commission logic ar tree kokhono mile na jawa possible na.
- `teamSize` niche theke upore (bottom-up) hishab kora, tai prottek row-te exact subtree size.
- **Lazy**: page khulole shudhu level 1 ashe; tarpor prottek tap-e ek level. Unlimited level hole-o phone-e bojha pore na (prottek call 100 row, `Load more` ase).
- Safety: visited set (cyclic/corrupt link hole infinite loop na), node cap 50000, depth cap 500.
- **Permission**: je kono branch chailen, server check kore sei node apnar nijer team-e ache kina — na thakle `403 That member is not in your team.` Admin/agent token `401`.
- **Privacy**: response-e shudhu ID, count ar join time — kono naam/email nei (apnar standing rule).

## 4. Test (local `:3901`)

Notun 18 ta check jog korechi `tools/user-journey.py`-te (chain banate 5 ta signup: 2 direct, 2 level-2, 1 level-3):

```
[11. my team tree — how many joined under me, at every level]
  PASS  tree-a@gmail.com joins under me                     200 id=2
  PASS  a referral of my referral joins (level 2)           200 id=4
  PASS  a level 3 join works too (unlimited depth)          200 id=6
  PASS  total team counts every level                       total=5 expected=5
  PASS  per-level counts add up to the total                L1 2 · L2 2 · L3 1
  PASS  direct count is level 1 only                        direct=2
  PASS  depth reports the real tree depth                   depth=3
  PASS  team numbers carry no names or emails               counts/ids only
  PASS  each row says how many people sit under that member teamSize=2
  PASS  opening a member shows their own team               200 rows=1 level=2
  PASS  somebody else's branch is refused                   403
  PASS  the team tree needs a signed-in user                401
  PASS  an agent token cannot read a user team tree         401
```

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **83 / 83** (age 65) |
| `tools/regression.cjs` | **42 / 42** |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` + `vite build` | clean |

Browser-e-o chalিয়ে dekhlam (Playwright, asol app, `u1@gmail.com` login): tree render hoy, `#1` tap → `#5 #4` khule, `#4` tap → `#7` (level 3) khule, abar tap → collapse. Kono console error nei (purono `/api/db?slim=1` 401 chhara, seta age theke ache).

Screenshot: `report-assets/tree-expanded.png`

## 5. Note

- Ei feature **shudhu porar jonno** — kono balance, commission ba payout logic-e hat deya hoyni. Commission hishab age-r motoi (`referCommissions`).
- Refer page-er purono "Live Referral Panel" (direct referrals-er balance/cycle) age-r motoi ache, tree tar upore boseche.
- **Team tree = apnar niche join kora shobai.** Upline (apnar upore ke) age-r motoi alada card-e ache.

## 6. Unresolved

Telegram-e pathano screenshot-e ekta `Backend not reachable` error dekhechilam — seta ki apnar phone-er network/app shell-er issue naki kichu onno, janale dekhe nite pari (amar live probe-e API 200 dicche).
