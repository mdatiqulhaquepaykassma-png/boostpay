# Payout panel: 3 ta button — ↻ Retry · ✔ Mark paid (TrxID) · ↩ Refund (Job 37)

Commit **b60aac2** (GitHub `main`, pushed 2026-11-13). Ekhono **Dokploy deploy baki** — code push hoise,
server restart na korla live panel e button ashbe na.

## Ki change howeche (ar keno)

Ajker loss-er mul kotha: **`FAILED` manei "taka phiriye din" — ei dharna ta bhul chhilo.**
Phone-er duita polling loop ek-i job claim korechhilo; je loop lock peye **haar gese** sei job-er
`FAILED` report pathaelo → server 3 s pore withdrawal **REJECT + refund** kore dilo → ar je loop
**sotti dial korechhilo** tar `SENT` report server fele dilo (`This job is FAILED, not claimed`) →
**TrxID 76BA500O er receipt-i nosto**. Result: customer Tk 199.64 pelichen **abo** refund-o pelichen.

Ekhon theke:

| Purono nemay | Notun nemay |
|---|---|
| device `FAILED` bollei withdrawal auto-REJECT + refund | **auto-refund nei**. Withdrawal `PENDING` thake + `payoutDecisionAt/Note/Device` mark hoy |
| deriye asha `SENT` report foske jeto | **TrxID thakle deriye asha report-o grahon** (`lateReceipt` flag soho) |
| admin-er hathe matro `retry` + `cancel` chhilo | **3-ta alada action**: ↻ Retry / ✔ Mark paid / ↩ Refund — protita server-side rule diye protected |
| DRYRUN job retry kora jeto na | **DRYRUN-o retry hoy** (kichui jawani hoyni, tai double-pay risk nei; `attempts` o barhe na) |
| panel "SMS: 0" dekhato (bhul store porhexechhilo) | `smsStats` ekhon **`db.smsInbox`** pare (age `db.smsMessages` e chhilo → sob somoy khali) |

## Notun API

```
POST /api/admin/payouts/mark-paid   { jobId } | { withdrawId }, trxId        (super-admin)
POST /api/admin/payouts/refund      { jobId } | { withdrawId }, reason?      (super-admin)
```

**✔ Mark paid**
- `trxId` **boundoboi lagbe** (clean TrxID: `[A-Z0-9_-]`, 3–40) na hole `400`. Karon: je receipt nei
  seike customer dekhte pabe na, ar "amra pathiyechilam" kotha ta proman-hin.
- withdrawal `PENDING` → `reviewWithdrawCore(APPROVE)` → **ledger row + customer notification +
  audit**, thik jemon normal approve hoy. Job → `SENT` + `trxId` + `markedPaidAt/By`.
- withdrawal **already `REJECTED`** (ajer user 67) → refund ta **ache thake**, ami balance chherini;
  shudhu receipt record hoy (`payoutTrxId`, `payoutLateReceipt`) ar ekta
  **`PAYOUT_CLAWBACK_NEEDED`** audit row lekha hoy jate apni TONYE ekta hisabe taka fanay nien.
  (Clawback kokhono auto hoy na — apnar "financial clawbacks confirmed first" nemay.)
- already `PAID`/`CANCELLED`/duplicate-TrxID → `409` with karon.

**↩ Refund**
- `PENDING` chara aar kichute → `409 withdrawal … is COMPLETED/REJECTED — there is nothing to refund`.
- `PENDING` hole: REJECT (refund + notification + `WITHDRAW_REFUND` row) **ar shathe-i** job
  `CANCELLED` — ek-i `withPaymentLock('WDRREVIEW:<id>')` er bhitore, mane **ekta refund AAR ekta payout
  ek-shathe hote parbe na**, ar phone aar kokhono sei job nite parbe na.

**↻ Retry** (`retryBlocker` notun kore lekha)
- `SENT|PAID` → bondho ("already sent — do not send twice")
- `CLAIMED` → bondho (phone ekhon cholche)
- `QUEUED` → "already waiting for a phone" · `CANCELLED` → "queue the withdrawal again instead"
- `job.trxId` thakle bondho ("this job already has a TrxID — nothing to retry")
- withdrawal `PENDING` na hole bondho → **double-pay kokhono possible na**

## Panel e kothay kothay dicche

- **Payout Robot tab → protita job row**: `log` pashapashi **↻ retry** (FAILED/DRYRUN),
  **✔ mark paid** (click korle inline TrxID box khule, `save receipt` → auto-refresh),
  **↩ refund**. Jeta possible na seta grey + title-te karon; aar row er niche "mark paid off: …" lekha dekha jay.
- **FAILED/DRYRUN row-e now no goloti line**: `⚠ no money moved automatically — nothing was refunded.
  Decide: ↻ retry, ✔ mark paid …, or ↩ refund.` + `(withdrawal PENDING)` chip.
- **"Withdrawals waiting for a payout" row**: `Send via robot` er pashe **✔ paid** + **↩ refund**
  (agent/bank/manual payout er jonno-o TrxID niye close kora jabe — apni "duta jaygay" bolechen).
- Hand-recorded receipt dekha jay: `receipt recorded by hand · admin:… · 3 min ago`.

## Check ja ami eliyechi (eta verify kora, anuman noy)

| Check | Result |
|---|---|
| `npx tsx tools/payout-queue.test.ts` | **73 pass / 0 fail** (notun 20 ta: late receipt, TrxID chara resurrect asfol, hand receipt, cancelled job, DRYRUN retry, `cleanTrxId`) |
| `npx tsc -p tsconfig.server.json --noEmit` | **clean** (exit 0) |
| admin-app `npx tsc --noEmit` | **clean** |
| admin-app `npm run build` (vite) | **built in 756 ms**, `app-manifest.json` + `app.html` ok |
| patch kora server boot (port 3999) | `listening` + notun duita route-i **registered** (401 auth wall, 404 noy) |

## Deploy + ajker hisab — apnar 2 ta kaj

1. **Deploy**: `main` = `b60aac2`. Ami `POST :3000/api/application.deploy` korte partam na —
   **Dokploy API key ei sandbox ar nei** (`/tmp/dk.key` snapshot restore e uthe gese).
   Apni chaile Dokploy-te **Deploy** chapun, na hoy key ta din ami deploy + `/api/health` verify kore dei.
   (Admin panel-o ei repo thekei build hoy, tai duita-i ekshathe notun hobe.)
2. **Ajker user 67 clawback** (apni `debit_now` boleyachen): panel e Treasury adjust ache
   (`AdminPortal.tsx` → adjustAmount/adjustNote) ba direct:
   ```
   POST /api/admin/adjust    { "userId": 67, "type": "DEBIT", "amount": 1.6,
     "notes": "WDR-MWF662BX-O2K was actually paid by the robot (TrxID 76BA500O) — refund reversed" }
   ```
   Super-admin + MFA lagbe, tai eta **apnar haat** (ami apnar MFA code chara korte parbo na).
   Balance 106.34 → **104.74** hobe, ekta `ADMIN_DEBIT` ledger row + `SYSTEM_ALERT` notification thakbe.
   (Chow: panel e `✔ mark paid` **age** chaple receipt-ta row-e bocche, tarpor DEBIT — tahole hisab milie jay.)
3. **Wallet top-up**: Nagad payout wallet-e ekhon **Tk 107.35** — 102 BDT-er beshi protita job
   `not enough balance` khaebe. Notun code-o sheta thik kore na.

## Update 2026-11-13 (rate) — D1/D2/D3/D5 shesh, APK 2.1.8 live

- **D1 (app 2.1.8, code 23) — DONE + deployed.** `QueueService.java`:
  - ek-i process-e **ek-i loop** — `AtomicBoolean LOOP` CAS duita `new Thread(this::loop)` site-e
    (`onStartCommand` + `watchDog`); loop shesh hole `LOOP.set(false)` (watchdog notun loop dite pare).
  - **lock haara loop kichui report kore na** — `send()`-er "another run / daily limit / accessibility
    off" tin-ta case ekhon `SKIP` sentinel; loop seta dekhle **server-ke kichui bole na**, job
    `CLAIMED`-i thake (asol owner report korbe, na hole `releaseStale` 3 min-e chhere debe).
  - **D5 self-heal** — protita loop iteration-e `if (Guard.stale()) Guard.forceEnd();` (120 s-er beshi
    atke thaka run lock auto-clear).
  - Build: `BUILD SUCCESSFUL in 50s`; `aapt` → `versionName='2.1.8' versionCode='23'`.
    `/opt/boostpay-apks/`-e SCP + container restart; public link 200 (64,659 / 64,679 B);
    `check.py` **100 pass / 0 fail**; public `/api/health` 200.
- **D2 (server) — DONE.** `POST /api/payout/:id/result`: FAILED report jodi
  `/another run is still in progress|daily limit check refused|accessibility service is off/i`
  match kore **ar** `now − claimedAt < 160_000` hoy, tahole **ignore** (job `CLAIMED`-i thake) +
  `PAYOUT_BOGUS_FAIL_IGNORED` audit. Defense-in-depth — app ekhon pathay-i na.
- **D3 (server) — DONE.** Late SENT+TrxID accept hole **`PAYOUT_LATE_RECEIPT`** audit row (clawback
  DEBIT-er kotha soho). `tsc` clean, `tools/payout-queue.test.ts` **73/0**.

## Ja EKHONO baki (apnar hat-e)

- **Deploy** (server + admin panel) — `main` ekhon ei commit soho. Dokploy API key lagbe
  (sandbox-e nei) — apni key din ba Dokploy-te Deploy chapun.
- **Ajker clawback** — user 67: `POST /api/admin/adjust {userId:67, type:'DEBIT', amount:1.6}`
  (super-admin + MFA). Age panel-e `✔ Mark paid` → `76BA500O`, tarpor DEBIT.
- **Wallet top-up** — Nagad payout wallet **Tk 107.35**; 102 BDT-er upor-er job FAIL korbe.
- **D4 · SMS relay** — payout phone-e relay app chalu korle debit SMS server-e ashbe →
  auto-verify + `matchDebit()` + apnar kache swadhin proman thakbe. Ekhon `smsInbox` = 1 row (self-test).
- Ekhonkar customer (`WDR-MWF662BX-O2K`) **notun withdrawal** ekhoni korbe? **Na** — age deploy,
  nahole notun job abar oi race-e pore ar withdrawal abar PENDING-i thakbe (ekhon onno kichu hobe na).

## Update 2026-11-13 (rate 2) — Balance verification (commit 05a301e)

**Protita bKash/Nagad transaction-er por automatic balance check.**

- **SMS balance parsing** (`sms-parse.ts`): protita SMS theke `balance` extract hoy —
  "Your current balance is Tk X" / "Balance: Tk X" / "ব্যালেন্স: X" pattern.
- **Balance tracking** (`server.ts`): protita SMS device-er jonno `lastBalanceBdt` track hoy.
- **Verification** (`verifyBalance()`):
  - **CREDIT** (deposit): `lastBalance + amount == smsBalance`? → thik thakle auto-confirm.
  - **DEBIT** (withdrawal): `lastBalance - amount == smsBalance`? → thik thakle auto-confirm.
  - 1 BDT tolerance (rounding/fee-er jonno).
  - Prothom SMS → baseline set hoy.
  - **Mismatch** → `BALANCE_MISMATCH` audit row + device flag + deposit-e `smsFlag`.
- **Admin panel**: device list-e `lastBalanceBdt`, `balanceVerified`, `balanceMismatch` dekha jay.

**Kaj korar jonno**: SMS relay **ON** thakte hobe (D4). Relay chara SMS ashbe na, balance verify hobe na.
Payout phone-e relay app chalu korun → protita transaction auto-verify hobe.
