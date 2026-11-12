# v1.8.0 — "Enter Reference:" e `1` jay, ar "same screen 3 times" bondho

Apnar 16:15 er log ta khub useful chilo. Run ta **Reference screen** e theme
gechilo — ar `Reference number 1 হবে` — ekhon eita automatic.

## Ki hoyechilo (log theke)

```
16:15:38    field now: "20"                 ← amount thik giyeche
16:15:40  ■ stopped: the network showed the same screen 3 times …
              … Carrier info · Enter Reference: · Cancel · Send
```

Lokkho korun — **Reference screen er `⇦` line-i nei**. Mane app screen ta
dekhei ni, `1` pathano to durer kotha. Karon:

1. USSD dialog nijer text **bar bar abar announce** kore, ar majhe majhe
   **shobdo ulta palta kore** pathay (`Carrier info · Enter Reference:` vs
   `Enter Reference: · Carrier info`).
2. Purono code protita announcement ke **notun screen** dhore ager scheduled
   key ta **cancel** kore ditо. Announcement gulo 700 ms er cheye druto
   ashto, tai protibar cancel → kono key kokhono beroto na.
3. Ar "same screen 3 bar" counter ta ekhon sathe sathe stop kore ditо —
   tai `■ stopped` ashto, `⇨ 1` na.

## Ki bodlalo

- **Screen compare ekhon canonical** — shobdo chhoto hater, "carrier info"
  bad, shobdo **sort** kora. Tai "Carrier info · Enter Reference:" ar
  "Enter Reference: · Carrier info" **ek i screen**.
- **Ek screen ekbar-i answer pay** (`answered` set). Re-announce korle
  key ta ar cancel hoy na, abar type-o hoy na.
- **Pending key cancel hoy na** — 700 ms por app nijei **live window** porে
  text ney, tarpor `decide()` chale. Tai dialog jodi majhkhane shobdo
  bodlay, tabuo thik value-i jay.
- **"same screen 3 times" counter bad** — tar jaygay **stall watchdog**:
  12 second kono notun screen na asle run theme jay ar bole
  `nothing advanced for 12s — the last screen was: …`. Ei 12 second er
  modhye Reference/PIN er moto screen thik moto answer pay.
- **Reference** er default `1` — `Enter Reference:` screen e ekbar-i `1` jay
  (apnar kotha moto).

## Log noise komlo

- `field now: ""` → `retry 1/3` chilo karon box kichhukhhon khali dekhay.
  Ekhon text set korar por **400 ms** opekkha kore **abar porা** hoy; box
  dhore rakhle `field now: "20"` ekbar-i ashe, Send chole.
- Password box bullet (`••••`) dekhale **length** diye check hoy — PIN kokhono
  plain log e jay na.

## Chhoto ekta bhalo khabar

Apnar log e `! PIN has 4 digits, bKash usually uses 5` chilo — karon apni
**bKash build** (`ussdpayout`) chalachhen kintu SIM ta **Nagad**. Ekhon:

- wallet ta **screen theke** dhora hoy (`Carrier info · Nagad`) → key timing
  **1600 ms** (Nagad er moto), bKash hisebe 900 ms na.
- PIN length warning ta SIM er **configured wallet** onujayi ashe.

## Live

| File | Size | SHA-256 (first 16) | Version |
|---|---|---|---|
| `boostpay-ussd-nagad.apk` | 43,583 B | `05e9e2b422a40e9c` | 1.8.0 (code 9) |
| `boostpay-ussd-payout.apk` | 43,603 B | `fcd13c3f254442a4` | 1.8.0 (code 9) |

`PlanTest` **50 pass / 0 fail** (notun: Reference ⇒ `1`, canonical screen,
puro walk `2 · number · amount · 1 · PIN`) · `check.py` **100 pass / 0 fail**

## Ebar test

Log e ei dharon ta asha uchit:

```
⇦ Carrier info · Nagad … 1. Cash Out 2. Send Money …
⇨ 2                    · menu: picked that option
  field now: "2"
⇦ Carrier info · Enter Receiver Account Number: …
⇨ 01780240277          · receiver prompt
  field now: "01780240277"
⇦ Carrier info · Enter Amount: …
⇨ 20                   · amount prompt
  field now: "20"
⇦ Carrier info · Enter Reference: …
⇨ 1                    · reference prompt          ← NOTUN
  field now: "1"
⏸ DRY RUN: this screen asks for the PIN   ← (DRY RUN e)
```

DRY RUN e PIN porjonto pouchale **DRY RUN OFF** kore 10–20 TK diye asol test.
Log e `field now: "••••"` ar `PIN sent` asha uchit, ar sathe **SMS**.
