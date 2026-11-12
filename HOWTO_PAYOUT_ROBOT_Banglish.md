# Payout Robot — admin panel theke bKash/Nagad payout (v1.9.0)

Ei document ta bole: **panel theke job deoa → phone pathano → wallet er SMS diye
confirm → user "Paid"** — puro chain ta.

---

## 1. Ekbarer setup (3 jinis)

### (a) Phone ta panel e register kora

Admin panel → **SMS Bridge** → *Add a phone*. Ei device the token ta
**ekbar-i** dekhabe (`BPX-…`). Copy kore rakhen.

> SMS Bridge ar Payout Robot **ek i device registry** use kore — ek i token,
> ek i pause switch. Phone ta SMS relay er kaj o korte pare, payout o.

Tarpor panel er notun tab **Payout Robot** e giye oi phone er row te:
- **wallet** = `nagad` (ba `bkash`) — na dile phone ta shudhu TEST job pabe,
  asol withdrawal pabe na (eta icche kore rakha safety).
- **payout ON** — off korle oi phone payout nibe na.

### (b) App e server queue chalu kora

App (v1.9.0) → **4 · Server queue (admin panel)** box:
| Field | Ki diben |
|---|---|
| Server queue mode | tick |
| server | `https://boostpay.online` |
| device token | `BPX-…` (SMS Bridge e je ta peyechhen) |

Tarpor **▶ Start picking jobs from the panel**.

App ekbar e ek ta job ney, ferot dio dey. `⛔ STOP` sob somoy kaj kore.

### (c) SMS relay phone ta chalu thakbe

Payout confirm ta ashe **"You have sent Tk … to 01X… TrxID …"** SMS diye —
sei SMS ta SMS relay app diye server e pouchate hobe. Tai je phone ta payout
korche, sei phone e relay app o chalu rakhen (ek i device, ek i token).

---

## 2. Test payout (nirapod)

Panel → **Payout Robot** → *Test payout*: wallet, receiver (`01XXXXXXXXX`),
amount (jemon `20`), reference (`1`) → **Queue test payout**.

- Ei job e **kono user ba withdrawal attach kora thake na** — bhul holeo karo
  balance e kichu hobe na.
- Phone **DRY RUN** e thakle server take **shudhu TEST job** dey, ar app
  `DRYRUN` report kore — taka ber hoy na.
- Phone **LIVE** e thakle asol taka jay, ar wallet er SMS asle job **PAID** hoy.

Queue list e protita job er **status + log** (phone ki ki screen dekheche,
ki type koreche) dekha jay. 5 second e ekbar nijei refresh hoy.

---

## 3. Asol withdrawal

1. User app theke withdraw korle → Admin panel e **PaymentRequests/Withdrawals**
   e `PENDING` ashe.
2. **Payout Robot** tab er *Withdrawals waiting for a payout* list e oi ta dekha jay
   (`$X · BDT amount · number`).
3. **Send via robot** chapun → job queue te jay.
4. Phone USSD kore pathay → **SMS** ashe → job **PAID** → withdrawal
   `COMPLETED`, user notification `WITHDRAWAL PAID` + TrxID.

### Bhul hole ki hoy

| Obostha | Ki hoy |
|---|---|
| Phone `FAILED` report kore (jemon network "Invalid account number") | withdrawal **refund** hoy, user ke notify, balance ferot |
| Admin **cancel** kore | queued job cancel + refund |
| Phone 3 minute report na kore | claim expire → job abar queue te (onno phone nite pare) |
| SMS na ashe (job `SENT` e atke) | admin cancel korte parbe na — *"wait for the SMS or refund by hand"*; SMS ta asle nijei PAID hoy |

> `SENT` mane taka ber hoi ni porjonto confirm na — tai oi obosthay manual
> refund korle doubar taka jete pare. SMS ashar por sotti `PAID`.

---

## 4. Security

- Token **hash** kore rakha hoy (plain na), panel e shudhu `••••last4` dekha jay.
- Token **payout** ebong **SMS** duitar jonnoi — ek jaygay revoke korle duitai bondho.
- App shudhu `https://` e kotha bole (`usesCleartextTraffic=false`).
- Job claim, result, refund — sob **audit log** e (`PAYOUT_CLAIM`, `PAYOUT_SENT`,
  `PAYOUT_FAILED`, `PAYOUT_DRYRUN`, `PAYOUT_PAID`, `PAYOUT_CANCEL`).
- Phone er app log e PIN kokhono plain ashe na (`••••`).

## 5. Test result (automated)

- `tools/payout-queue.test.ts` — **44 pass / 0 fail**:
  claim ekaadik phone e na jay, dry-run phone real withdrawal pay na,
  bhul amount/number er SMS job pay kore na, cancelled job ar claim hoy na,
  stale claim 3 min por release hoy, etc.
- `apk-portal/check.py` — 100 pass / 0 fail · `PlanTest` 50 pass / 0 fail
