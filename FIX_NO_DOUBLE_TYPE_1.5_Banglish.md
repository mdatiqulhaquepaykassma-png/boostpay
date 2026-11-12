# v1.5.0 — Double-typing bondho, "USSD code running…" e typing bondho

Apnar 14:09–14:11 er log theke **dui ta notun bug** dhora poreche. Duita e fix, donita ekhon live.

---

## Bug 1 — "USSD code running…" screen e `1` ar number type hoye gechhilo

**Ki hoyechhilo:** `*167#` dial korar sathe sathe network je placeholder screen dey —
`Initiated USSD session · USSD code running…` — seta menu na, kintu app take
chinte parenai. Tai app fallback hisebe CSV step list dhore `1` ar receiver number
**oi running screen er reply box e** type kore diyechhilo. Mane session ta **prothom
second theke** noshto hoye gechhilo. Erpor jei asol menu ashto, seta ar thik moto
porjai na.

**Fix (v1.5):**
- Notun `Plan.isWaitingScreen()` — `USSD code running`, `Initiated USSD`,
  `Please wait`, `Requesting`, `Processing`, `Sending your`, `Loading`,
  `Do not close`, `অপেক্ষা`, `প্রক্রিয়া চলছে` — ei screen gulo **kebol log** hoy,
  **kono key type hoy na**.
- **Fallback step list puropuri bad.** Adaptive mode e na-china screen asle app
  ekhon **chup kore opekkha kore** (`Key.wait`), kichu type kore na. Purono
  v1.4 er "unrecognised screen ⇒ list er next step" niyom ta ekhon nei — oita e
  notun bug er karon chhilo.
- `UssdApiEngine` (purono path) o eki guard peyeche.

## Bug 2 — Ek e menu 5 bar ashchilo, app `2` paanch bar type korechilo

**Ki hoyechhilo:** log e dekha jay — `1. Cash Out 2. Send Money …` menu ta
**paanch bar** eshechhe, ar app **paanch bar e `2`** pathiyechhe. Number ta
bar bar pathanor fole Nagad er dike session ta abal hoye jawar kotha,
ar tarpor ashe — **"Invalid account number."** — ar run theme jay.

**Fix (v1.5):**
- Ek e screen (hুবহু identical text) **duti bar** asle app r key pathay na,
  shudhu `repeats` baray. Ditiyo bar er pore 3 second opekkha kore, tarpor o
  kichu na hole run **porishkar message diye bondho** hoy:
  `the network showed the same screen 3 times and nothing advanced: …`
- Notun/different screen asle **ek bar e ek answer**, tarpor 600 ms wait —
  tar agei fire asa screen gulo ar answer pay na.
- `recheck()` (jokhon typing er por kono event ashe na) ekhon direct `handle()`
  e jay na, `consider()` diye eki guard diye jay — tai re-read theke double
  typing hote pare na.
- PIN pathanor por (kono screen e) app `finish(true)` kore dey — ar kichu type
  kore na, confirmation / SMS er jonno opekkha kore.
- Protita key pathanor age reply box **clear** hoy (`""` set kore), tarpor
  focus + duibar text set, ar log e `field now: "<text>"` — jate apnar log
  theke e e bujha jay box e asole ki chhilo.
- Duita key er majhe gap ekhon `max(1200, provider.stepDelayMs)` — Nagad e
  1600 ms, tai network er nijer screen update ar amader typing er modhye
  dhakka lagbe na.

## Bonus: receiver number validation

Dial korar **age** number ta clean + check hoy: space/dash bad jay,
`8801XXXXXXXXX` → `01XXXXXXXXX`, ar 11 digit / `01` diye shuru na hole app
**dial korei na**, bole: `receiver number ... is not a valid 11-digit 01XXXXXXXXX number`.

**Jodi `Invalid account number` abar ashe** — tahole number format ta
Nagad er dike problem. Amake ei duita jinis pathan:
1. jei number diye test korchen (DRY RUN e hobe), ar
2. oi number diye **hate** `*167#` → Send Money kore dekhle ki hoy.

Erpor ami number normalization (ba Nagad er "Send Money to Nagad account"
er exact prompt) onujayi adjust korbo.

---

## Ki ache ekhon live

| File | Size | SHA-256 (first 16) | Version |
|---|---|---|---|
| `boostpay-ussd-nagad.apk` | 40,083 B | `754ce8daf5a9d315` | 1.5.0 (code 6) |
| `boostpay-ussd-payout.apk` | 40,099 B | `af80359991fb0056` | 1.5.0 (code 6) |

- Portal: `version 1.5` · `check.py` — **100 pass / 0 fail**.
- `PlanTest` — **41 pass / 0 fail** (notun test: waiting screen ⇒ wait,
  same screen ⇒ eki single key, `Invalid account number` ⇒ rejection,
  unknown screen ⇒ wait/no typing).

## Apnar kaj — step by step

1. Purono app **uninstall** korben na, upor theke install korlei hobe
   (versionCode 6, signature same).
2. App khulun → number din → **DRY RUN ON** → **START**.
3. Log e ei dharon ta dekha uchit:
   ```
   ⇦ Initiated USSD session · USSD code running…   (waiting — nothing typed)
   ⇦ 1. Cash Out  2. Send Money  3. …
   ⇨ 2   · menu: Send Money
   ⇦ Enter Receiver Account Number: · Cancel · Send
   ⇨ 019XXXXXXXX   · receiver number
   ...
   ⏸ DRY RUN: PIN prompt …
   ```
   Mane: running screen e **kichu type hoy ni**, menu **ek bar** e `2` peyeche,
   number ta thik prompt e giyeche.
4. DRY RUN thik hole DRY RUN **OFF** kore ekbar asol test — chhoto amount diye.
5. Log ta (ba screenshot) amake pathan — seta dekhe porer step (queue wiring) e jabo.

Bhalo kichu na hole `STOP` button jekono shomoy chapben — run sathe sathe theme jabe.
