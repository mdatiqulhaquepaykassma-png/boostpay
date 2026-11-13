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

## Ja EKHONO kora hoyni (baki kaj)

- **App 2.1.8 (D1)** — lock haara loop jeno **kichui report na kore** (`skip silently`) ar
  ek-i shomoy ek-i loop (`AtomicBoolean` guard, `onStartCommand:120` + `watchDog:161` duita-i
  `new Thread(this::loop)`), ar queue `if (Guard.stale()) Guard.forceEnd();`.
  Ekhonkar server-fix er por eta **money-safe** dik theka ar jaruri noy — kintu double log/ar
  arogulo bar bar hobe. Bolle build+publish kore dei (toolchain: `sh /home/user/fix_tools.sh`).
- **D4 · SMS relay** — payout phone-e relay app chalu korle debit SMS server-e ashbe →
  auto-verify + `matchDebit()` + apnar kache swadhin proman thakbe. Ekhon `smsInbox` = 1 row (self-test).
- Ekhonkar customer (`WDR-MWF662BX-O2K`) **notun withdrawal** ekhoni korbe? **Na** — age deploy,
  nahole notun job abar oi race-e pore ar withdrawal abar PENDING-i thakbe (ekhon onno kichu hobe na).
