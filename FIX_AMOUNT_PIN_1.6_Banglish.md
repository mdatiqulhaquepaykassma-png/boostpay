# v1.6.0 — Amount ar PIN alada alada, ekbar ekbar kore pathano

v1.5 e double-typing bondho holo, kintu **asol run** e apnar kache amount ar PIN
dhora porche na. Code poriye dekhe **char ta karon** pelam — sob gulo ekhon bondho.

---

## 1. "Send Tk 100 to 01X…? 1. Confirm 2. Cancel" screen e amount abar jacchilo

Ei confirmation screen e **amount ar number dutoi lekha thake**. Purono reader
keyword dekhe bhabto — "amount" ache, tai amount-i pathai. Mane je screen e
Confirm chapar kotha, sekhanei abar `100` jeto → network **"Invalid"** bole
session bondho kore dito. PIN porjonto pouchai na.

**Ekhon:** confirm screen (Confirm/Cancel, "Are you sure") dhora pore, ar
sethay **Confirm option** (1) pathano hoy — kono taka/number na. Ar
"Enter your PIN to confirm" mto line ke bhul kore confirm screen dhorbe na.

## 2. Summary screen e typing

Je screen shudhu **dekhabe** ("Amount: 100", "To: 01X…") — seta question na.
Purono code sekhaneo type kore dito. Ekhon prottek prompt e check hoy screen
**asole chaitese kina** — `Enter…`, `Type…`, `লিখুন`, `দিন`, `প্রদান` —
na thakle app **chup kore opekkha kore**, kichu type kore na.

## 3. Amount ar PIN **duibar** jeto

Ek i value duibar gele Nagad "Invalid PIN" / "Invalid amount" dey. Ekhon
protita value ekbar-i jay — `Plan` মনে রাখে `numberSent`, `amountSent`,
`pinSent`. Eki prompt abar asle (`amount already sent — waiting…`) app
**wait** kore, abar type kore na. PIN pathanor por ar kono input e hath dey na.

## 4. Reply box e text asole dhukche kina check kora hoy na

`ACTION_SET_TEXT` fail korleo app "hoy geche" dhore Send chhere dito → **khali
box** jeto → network "Invalid". Ekhon:

- box clear → focus → text set → **abar set** (box lag korle),
- box er **asol text pora hoy**, `field now: "100"` log e ashe,
- text match na korle Send **chapano hoy na**, app **retry** kore
  (`reply box not ready, retry 1/3`), 3 bar fail korle run theme jay ar
  screen ta log e diye dey.
- PIN kokhono log e plain ashe na — `field now: "••••"` (masked).

## 5. App theke dial korar age validation

- **Amount:** khali / `1,000` / `Tk 500` / `0` hole app **dial-i kore na** —
  comma, `Tk`, space auto bad jay, `0` er cheye boro hote hobe.
- **PIN:** digit chara kichu thakle (space, letter) app theme jay ar bole
  "save it again in SIM settings".
- Nagad PIN 4 digit / bKash 5 digit — na mile **warning** log e ashe
  (`! PIN has 5 digits, Nagad usually uses 4`).

---

## Live

| File | Size | SHA-256 (first 16) | Version |
|---|---|---|---|
| `boostpay-ussd-nagad.apk` | 41,443 B | `7e067373da5fc585` | 1.6.0 (code 7) |
| `boostpay-ussd-payout.apk` | 41,463 B | `8e54f406a3bc8225` | 1.6.0 (code 7) |

`PlanTest` **45 pass / 0 fail** · `check.py` **100 pass / 0 fail**

## Test korar niyom

1. App update korun (uninstall lagbe na).
2. Number + amount din (shudhu digit, jemon `100`).
3. **DRY RUN ON** → START → log e ei dharon:
   ```
   ⇨ 2                       · menu: picked that option
   ⇨ 017XXXXXXXX             · receiver prompt
     field now: "017XXXXXXXX"
   ⇨ 100                     · amount prompt
     field now: "100"
   ⏸ DRY RUN: this screen asks for the PIN
   ```
4. Dry run thik hole DRY RUN off → chhoto amount (10-20 TK) → asol test.
   Log e `field now: "••••"` ar tarpor `PIN sent` asha uchit.
5. Fail korle **puro log** ta pathan — koto number line e atkeche seta theke
   ami exact screen ta dhore nite parbo.
