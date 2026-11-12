# Panel theke "app live ache kina" dekha (v2.0.2)

## Kothay dekhen

Admin panel → **Payout Robot** tab → sob theke **upore** ekta status strip:

| Ja dekhabe | Mane |
|---|---|
| 🟢 `1 phone connected · 1 LIVE (real money) · Nagad phone app 2.0.2 · seen 3s ago` | App ta server er sathe **connected**, asol taka pathabe |
| 🟡 `1 phone connected · 1 in DRY RUN (test jobs only) · … seen 5s ago` | Connected, kintu **dry run** — panel shudhu TEST job debe |
| 🔴 `App NOT connected. No phone is asking for jobs…` | **Connection nei** — app er section 4 theke *Start queue* chapun |

**Phones** list er protita row te o badge ache:

```
📱 01954681757   [LIVE · 4s]        ← 4 second age check-in koreche
   Nagad · app 2.0.2 · seen just now · last job 2 min ago · relay on
```
- `[LIVE · 4s]` = app cholche, live mode
- `[DRY RUN · 6s]` = app cholche, dry run mode
- `[OFFLINE]` = 90 second dhore kono check-in nei (app bondho / net nei / *Stop* chapa / Android app ta kill koreche)

Nicer `Phone check-ins & payout events` list e protita event:
`CLAIM` (job nicche) · `SENT` · `PAYOUT_PAID` · `AUTH_FAIL` (token vul) · `TEST_QUEUED` etc.

## Kivabe jane — technique

- App **protita 4 second** e `POST /api/payout/next` kore job cheye; oi request tai
  heartbeat.
- Server oi check-in `lastSeenAt` hisebe rakhe (file e 45 second e ekbar likhe,
  jate database er upor chap na pore), sathe **app er version** ar
  **dry-run/live** flag o.
- Panel 90 second er modhye check-in hole phone ke **online** dhore, ar 1 second e
  ekbar "kshon age" text ta update kore.

## Ei muhurte (12:14 UTC) production er obostha

```
jobs queued : 6
device seen : 2026-11-12T06:15:54Z   ← 6 ghonta purono
appVersion  : —                        ← kokhono connect kore ni
```
Mane panel e ekhon **🔴 App NOT connected** dekhben — eta sotti obostha, bug na.
Phone er app theke queue Start korle sathe sathe sobuj hobe.
