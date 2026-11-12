# Payout Robot tab crash — asol karon (React error #31) — FIXED

Apnar pathano message ta-i thik chilo:

```
Minified React error #31 … args[]=object with keys {accountName, accountNumber}
```

## Mane ki

React ekta **object** ke screen e "lekha" hisebe bosate dey na. Ami je
withdrawal list ta dekhachhilam, sekhane server theke ja ashchilo:

```json
"destination": { "accountName": "Rahim", "accountNumber": "01780240277" }
```

Kintu ami oita dhore `number` hisebe render korchilam → React **crash** →
tab kalo. (Ei karonei **error boundary** ta kaj e laglo ar apni message ta
dekhte pelen — age puro panel kalo hoye jeto.)

## Ki fix korlam (dui dike)

**Server (`/api/admin/payouts`)** — ekhon destination theke **number ta alada
kore ber kora hoy** (`destinationMsisdn()`): `accountNumber` → `number` →
`msisdn` → `mobile` → `account` → `phone`, ar na pele object er **jekono value**
theke `01XXXXXXXXX` khonja hoy. Sathe `destination` label (`Rahim · 017…`) o
pathano hoy.

**Panel (PayoutRobotAdmin)** — sob string/number ekta `str()` guard diye render
hoy: object ashle sei object er theke number/label ber kore dey, kichui na
pele `''`. Tai aro kono din ei dhoroner data panel ke crash korte parbe na.

## Verify

- `tsc --noEmit` clean · `vite build` OK · `payout-queue` test 44/0
- Main API + Admin console duitai **deploy done**
- Live bundle: **`index-C-NRx4pu.js`**

## Apnar kaj

1. Panel e **hard refresh** (`Ctrl+Shift+R`, phone hole app theke ber hoye abar khulun).
2. **Payout Robot** tab khulun — ekhon list ta asha uchit:
   - *Test payout* (wallet, receiver, amount, reference `1`)
   - *Withdrawals waiting for a payout* (user, `$`, BDT, number)
   - *Phones allowed to send payouts*
   - *Queue* (status + log)
3. Kono **lal box** asle abar sei error text ta pathan — kintu ei bar data
   ta ar object na, tai ei crash ta ar hobe na.
