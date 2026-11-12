# Panel er test payout "kaj korche na" — asol karon + fix (v2.0.0)

## Dorar age: panel thik-i kaj korche

Production database check kore dekhlam (read-only):

```
jobs: 2   →  PO-…-C39 TEST nagad 20 BDT  QUEUED
             PO-…-M3H TEST nagad 20 BDT  QUEUED
device "01954681757" → lastSeen 2026-11-12T06:15:54Z   ← 5 ghonta age
payoutProvider: (auto)
```

Mane:
- **Test payout button kaj korche** — dui ta job database e dhukche (11:32 ar 11:36 UTC,
  mane apnar 17:32/17:36).
- Kintu **phone ta kono din job chaite asheni** — device er `lastSeen` 5 ghonta purono.
  Tai job gulo `QUEUED` theke sore na, ar kichu hoy na.

## Phone job chaite asheni kano — dui ta karon

1. **Purono app e server-queue chilo na** (v1.8 er niche), othoba section 4 e
   *Start* chapa hoyni / token vul chilo.
2. **Asolei boro karon:** v1.9.x e queue ta **Activity er bhitore** poll korto.
   Phone er **screen lock** hole Android Activity ke thondrokore dey → polling theme jay,
   job `QUEUED` e boshe thake. Ekbar screen off mane ar kono job jay na.

## Fix (v2.0.0 — ekhon live)

**Queue ta ekhon ekta Foreground Service** (`QueueService`):
- Notification dekhabe: *"Queue running — waiting for a job…"* → mane seta cholche.
- **Screen off / app bondho** korleo job nite ar pathate parbe.
- `WAKE_LOCK` (partial) — Doze e ghumabe na.
- Phone restart korleo service abar uthbe (`START_STICKY`).
- Job chalte chalte `⛔ STOP` chaple USSD dialog bondho hoy ar service theme jay.
- App e **Test** button — ek chape bole dey: panel er sathe kotha holo kina,
  token thik ache kina, ar queue te kono job wait korche kina.
- **"Queue dry run"** checkbox — tick thakle panel shudhu **TEST** job dey
  (kono asol taka jay na).

Panel dike o bodlalam:
- Jodi kono phone 3 minute dhore check-in na kore ar queue te job wait kore, tahole
  upore **holud warning** ashe: *"No phone is asking for jobs"* + last check-in time +
  ki korte hobe. Ar `payoutProvider` faka thakle phone shudhu TEST job pabe
  (icche kore rakha safety) — panel er *Phones* row te wallet ta set kore din.

## Apnar kaj (5 minute)

1. **Phone e notun app install korun** — v2.0.0:
   `https://app.boostpay.online/nagadpayout/download` (ba `/ussdpayout`)
2. App → **4 · Server queue**:
   - Server: `https://boostpay.online`
   - Device token: SMS Bridge e je `BPX-…` peyechilen (na thakle panel → SMS Bridge →
     *Add a phone*, token **ekbar-i** dekhabe)
   - **Queue dry run** tick rakhen (prothom bar)
   - **Test** chapun → *"✓ connected — the queue is empty"* asha uchit
   - **▶ Start queue** → notification ashe: *Queue running*
3. Panel → **Payout Robot** → *Phones* row te oi phone er **wallet = nagad** set korun
   (`auto` thakle real withdrawal pabe na), ar **payout ON**.
4. Panel → **Test payout** → `20` BDT → **Queue test payout**.
   Queue te 5 s e status uthbe: `QUEUED → CLAIMED → DRYRUN` (dry run e).
5. Sob thik hole phone e **Queue dry run un-tick** → *Stop* → *Start* → ebar LIVE.
   Same test abar din → `SENT`, ar wallet er SMS asle **PAID**.

## Choto note

`SENT` ar `PAID` er modhye tafat: `SENT` mane phone bolche "pathiye diyechi";
`PAID` mane wallet er **"You have sent Tk …" SMS** server e esheche. Tai SMS relay app
ta oi phone e chalu rakhte hobe (ek i device token duitar jonnoi kaj kore).
