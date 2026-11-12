# Payout Robot tab khali/kalo screen — ki korechi

## Ki hocchilo

React e kono ekta screen er **render e error** hole (jemon: API theke asha
data te ekta field nei, ba kono icon undefined) React puro app ta **unmount**
kore dey — ar page er background `#09090b` (kalo), tai **puro screen kalo**
hoye jay, kono message ashe na. Eta "page crash" er chinnho, "page slow" na.

Ei karonei ami:

1. **Protita tab er charpase ekta Error Boundary** (`TabBoundary`) boshiyechi.
   Ekhon kono tab crash korle puro console kalo hoy na — oi jaygay ekta **lal
   box** ashe jekhane **exact error message + stack** lekha thake, ar pashe
   *Try again* button. Console er baki tab gulo kaj korte thake.
2. **Payout Robot screen ta fully defensive** korechi:
   - `jobs`, `pending`, `devices`, `stats` — kono tai array/object na hole o
     crash hobe na (`asArray`, `num()` diye sob number guard kora).
   - `BoostPayStore.adminAuthHeaders()` try/catch e — session nosto hole o
     screen render hobe.
   - API jawab na dile **"Loading the queue…"** + HTTP status dekhabe,
     faka kalo screen na.

## Apnar kaj (30 second)

1. Admin panel e giye **hard refresh** korun:
   - Phone/APK: app theke ber hoye abar khulun (ba pull-to-refresh)
   - Desktop: `Ctrl+Shift+R` (Mac: `Cmd+Shift+R`)
   Ei step ta dorkar karon panel ta PWA — service worker purono bundle
   cache kore rakhte pare. Notun bundle er naam: `index-Clb1Yz6D.js`.
2. **Payout Robot** tab e jaan.
3. Ekhon 3 ta jinis er ekta hobe:
   - **List ashe** (Test payout, withdrawals, phones, queue) → thik, test korte paren.
   - **Lal box ashe** → tar modhhe je **error message** ache, seta amake pathan
     (screenshot ba text) — ami exact oita fix korbo.
   - **Ekhono kalo** → browser er **Console** (F12 → Console) er screenshot
     pathan; othoba phone hole: Chrome → ⋮ → Settings → Site settings →
     `admin.boostpay.binanceusdtpay.io` → **Clear & reset**.

## Choto ekta mone rakhar kotha

`/api/admin/payouts` endpoint ta ekhon **401** dey jodi admin token na thake —
panel e login kora thakle eta automatic hoy. Tai tab ta kholar somoy login
session ta thaka dorkar (MFA unlock dorkar nei ei screen er jonno).
