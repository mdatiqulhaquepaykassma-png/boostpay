# "Test payout kaj korche na" — phone ta server e **ekbaro** ashe ni

Ei document ta ekbar porjonto **porjai** — karon ami production e dekhte pelam
phone theke **ektao request ashe ni**.

## Production er asol chobi (read-only)

```
jobs total : 5      (sob QUEUED)
claims     : 0      ← phone kokhono ekta job-o nite ashe ni
auth fails : 0      ← bhul token diyeo kokhono try kora hoy ni
device seen: 2026-11-12T06:15:54Z  ← oi shomoy SMS relay, payout er age
```

Mane hocche:
- **Panel thik ache.** Test payout chaple job database e dhukche (5 ta ache).
- **Phone ta panel ke jiggesh-i korche na** — na thik token diye, na bhul token diye.
  Tai kono `CLAIMED` nei, kono lal `AUTH_FAIL` nei — kichu nei.

Er mane ekta: **app er "Server queue" chalu hoyni** (purono app, token khali, ba
*Start queue* chapa hoyni), othoba oi phone theke server e pouchano jacche na.

---

## Notun tools (ekhon live)

1. **Phone theke connection test — browser e:**
   `https://boostpay.online/api/payout/ping`
   → `{"ok":true, "queued":5, …}` asle phone theke server e pouthachhe.
   (Ei test e token lagbe na.)
2. **Panel → Payout Robot → "Phone check-ins & payout events"** (niche):
   - faka list = phone kokhono ashe ni
   - lal `AUTH_FAIL … token ••••XXXX` = phone ashche kintu **token vul**
   - `CLAIM` = phone job nicche
3. **"New token" button** protita phone row te — notun token banay ar **ekbar-i**
   dekhay (copy kora jay). Purono token sathe sathei bondho hoy.
   → Token hariye gele eita chapun, notun ta app e paste korun.

## Apnar kaj — thik ei order e (10 minute)

**Step 1 — phone theke server test**
Phone er browser e kholun: `https://boostpay.online/api/payout/ping`
- `ok: true` asle Step 2 e jaan.
- Na asle oi phone er internet/data check korun (browser e boostpay.online khule dekhen).

**Step 2 — notun app install (v2.0.1)**
`https://app.boostpay.online/nagadpayout/download`
App ta **uninstall korben na**, upor theke install korlei hobe.

**Step 3 — app e queue setup**
App khulun → niche **4 · Server queue**:
| Field | Ki diben |
|---|---|
| Queue dry run | ✅ tick (prothom bar) |
| server | `https://boostpay.online` |
| device token | `BPX-…` |

Token na thakle: **panel → Payout Robot → Phones → New token** → **Copy** →
app er token box e paste.

**Step 4 — Test button**
App er **Test** button chapun. Ja asha uchit:
- `✓ connected — a job is waiting: PO-…` ← best (job already queue te ache)
- `✓ connected — the queue is empty`
- `✗ This phone is not allowed… → Admin panel → Payout Robot → Phones → New token…`
  mane token ta mittha → Step 3 abar korun.

**Step 5 — Start queue**
**▶ Start queue** chapun. Phone er notification e asha uchit:
**"Queue running — waiting for a job…"**
Ei notification ta na asle app ta queue chalu korte pare ni (notification
permission din: Settings → Apps → BoostPay Payout → Notifications → Allow).

**Step 6 — panel e dekhen**
Payout Robot tab er niche **Phone check-ins** e `CLAIM` line asha uchit, ar
queue te job `QUEUED → CLAIMED → DRYRUN` (dry run e) ba `→ SENT` (live e)।

---

## Jodi Step 4 e "✓ connected" ashe kintu job na pay

- Panel → Payout Robot → **Phones** row te oi phone er **wallet** set korun
  (`nagad`), ar **payout ON** dekhen.
- `wallet = auto` hole phone ta shudhu **TEST** job pay — real withdrawal pay na
  (eta icche kore rakha safety).

## R ekta kotha

`SENT` ar `PAID` alada: `SENT` = phone bolche pathiyeche; **`PAID` = wallet er
"You have sent Tk …" SMS** server e esheche. SMS ta ashte hole oi phone e
**SMS relay app** ta o chalu thakte hobe (ek i device token duitar jonnoi kaj kore).
