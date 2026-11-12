# v1.7.0 — Amount ar PIN ekhon **alada alada box**

Apnar kotha moto: app er screen e **amount er ekta box, PIN er alada box** —
duita r kono hisebe mishte parbe na.

## Notun layout (upor theke niche)

```
1 · Receiver number          [ 01XXXXXXXXX ]            ← kake taka jabe
    receiver: 01780240277
    [ Save receiver number ]

2 · Amount (BDT)             [ 100 ]                   ← koto taka
    amount: 100 BDT
    [ Save amount ]

3 · PIN (4 digits)           [ •••• ]                  ← SIM er PIN
    PIN on this phone: saved (encrypted)   ← sobuj lekha
    [ ] Show digits while typing
    [ Save PIN on this phone ]
    [ Clear saved PIN ]
```

- **Protita box er nijer Save button** — ekta save korle onno gulo
  poriborton hoy na. (Age sob field ek sathe save hoto; ekhon `Save amount`
  chaplei shudhu amount save hoy.)
- **Protita box er niche status line** — `receiver: …`, `amount: … BDT`,
  `PIN on this phone: saved / not saved` — tai run korar agei bujha jabe
  kono ta khali.
- **Amount box** ekhon decimal ney (`500.50`), kintu `Tk`, comma, space
  khulo hoye jay ar `100` er niche/`0` hole save-i hoy na.
- **PIN box**: `Show digits while typing` check korle type korar somoy
  digit dekha jay (phone e vul type dhora jay); save korle box khali hoye jay
  ar PIN **Keystore e encrypted** thake — log e kokhono plain ashe na.
  Digit chara kichu dile save-i hoy na, ar 4/5 digit na mile warning dey
  (Nagad 4, bKash 5).
- **Clear saved PIN** — ek chapei PIN muche jay.

## Run korar somoy

Amount validation, PIN validation, confirm-screen handling, one-time value
sending — sob v1.6 er motoi ache:

- Confirm screen (`1. Confirm 2. Cancel`) ⇒ `1` jay, taka na.
- Number/amount/PIN protita **ekbar-i** jay.
- Type korar por box er **asol text** check hoy (`field now: "100"`),
  na mille Send hoy na, retry hoy.

## Live

| File | Size | SHA-256 (first 16) | Version |
|---|---|---|---|
| `boostpay-ussd-nagad.apk` | 43,119 B | `31d1c00aeca3e869` | 1.7.0 (code 8) |
| `boostpay-ussd-payout.apk` | 43,139 B | `351e405c55172cb2` | 1.7.0 (code 8) |

`check.py` **100 pass / 0 fail** · `PlanTest` 45 pass / 0 fail (plan logic unchanged)

## Test

1. App update (uninstall lagbe na).
2. Box 1 e number → `Save receiver number`.
3. Box 2 e `100` → `Save amount`.
4. Box 3 e PIN → `Save PIN on this phone` (status sobuj hobe: *saved*).
5. **DRY RUN ON** → START → log: `⇨ 2` → `field now: "017…"` → `⇨ 100`
   → `field now: "100"` → `⏸ DRY RUN: PIN`.
6. Dry run thik hole DRY RUN off → 10–20 TK asol test.
