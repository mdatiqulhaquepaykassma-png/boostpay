# REPORT 68 — Global Currency Selection System — Banglish

**Date:** 2026-11-08
**Commit:** `95b2518`
**Live:** `v1.2.1794336149` · user app bundle `assets/index-CqS4ZPq4.js`
**Test:** journey **375 pass / 0 fail** (§30 — 19 notun check) · regression 42/0 · system-check clean · sob build clean

---

## 1. Ki hoyeche (apnar 8 point dhore)

| Apnar point | Ki korechi |
|---|---|
| 1. Currency selection | **150 currency** (ISO 4217) — প্রতিটিতে **flag + country + name + code + symbol**; **searchable** dropdown (code / name / country / symbol diye khōja) |
| 2. User + Agent (+ Admin) | User ar Agent duijonei nijer account theke select/change korte parbe — **ekjoner change onnojon ke affect kore na** (alada field) |
| 3. Balance card e position | User app: balance card e **ID chip er thik opore** selector; Agent app: agent er balance card e ekoi jaygay |
| 4. Display system | Balance card, transaction list (recent + full history), boost strip er day-row, send modal — sob selected currency te (`≈ ৳1,028.16`) |
| 5. Financial logic | Wallet / ledger / transaction **USD e fixed**; conversion shudhu **server side**, cache kora rate diye; **rate + last updated time** dekha jay |
| 6. Persistence | `user.currency` / `agent.currency` / `admin.currency` DB te save; logout-login, notun device — sob jaygay same preference load |
| 7. Admin control | Admin panel e **notun "Currency" tab**: currency enable/disable, default currency, rate provider URL, refresh interval, "Refresh rates now", live status (fresh / last known) |
| 8. Security | ISO code server validate kore (XXX → 400), disabled currency → 400; **client er pathano converted amount kokhono worldas hoy na** — amount + code pathale server nijer rate diye USD kore; rate API fail hole **last known rate + timestamp** (stale mark) |

## 2. Live verify (production)

```
GET /api/currency/options → base USD · 150 currencies · stale=false · age 2 min
  🇧🇩 Bangladesh BDT ৳ 124.258644
  🇪🇺 Eurozone   EUR € 0.892449
  🇬🇧 UK         GBP £ 0.744696
  🇮🇳 India      INR ₹ 93.929192
  🇸🇦 Saudi      SAR ﷼ 3.75
  🇦🇪 UAE        AED د.إ 3.6725
GET /api/admin/currency/config → 401 (route ache, superadmin only)
```
Rate gulo **open.er-api.com** theke (free, key lage na), 60 min cache, boot e ekbar warm hoy.

## 3. Entry o selected currency te (apnar choice — option B)

User BDT select korle send/agent-pay er input **BDT te** type korte parbe:

- Client pathay `{amount: 100, currency: 'BDT'}`
- Server nijer rate diye **USD** kore (`$1.00`) — client er kono figure worldas hoy na
- Min/max limit **USD te** thake; converted amount minimum er niche hole: *"That is $0.01 — the minimum transfer is $0.10."*
- Saved currency er sathe mismatch (jemon pref BDT, pathalo EUR) → **400**
- Test proof: `100 BDT @ 100 = $1.00` sender er balance theke thik $1 gelo

## 4. API (notun)

```
GET  /api/currency/options                 (public + optional auth) — list, rates, freshness
POST /api/user/currency   {code}
POST /api/agent/currency  {code}
POST /api/admin/currency  {code}
GET  /api/admin/currency/config            — enable/disable, default, provider, interval, status
POST /api/admin/currency/config            — save (audited: CURRENCY_CONFIG_CHANGED)
POST /api/admin/currency/refresh           — force fetch
```

## 5. Test (§30, 19 check — sob pass)

List + symbol + flag · USD rate = 1 · rate freshness reported · manual rate set · user switch · **wallet ek taka o bodlay na** · preference next login e firse ashe · XXX → 400 · onno user unaffected · disabled currency list theke jay · disabled select → 400 · **BDT 100 → $1.00** · mismatch → 400 · sub-cent → 400 · agent er alada preference · agent change user ke touch kore na · normal user config change korte pare na (401) · refresh endpoint freshness dey।

## 6. Sotota (ja ekhono baki)

- **Leaderboard / Referral tree / Inbox / chat / agent pay screen** — ei jaygagulo ekhono `$` (USD) te dekhabe; balance card + transaction history + boost strip converted. Chaile porer dhape ei gulo o ek e formatter e niye ashi (kichu ghontar kaj, sob same server rate).
- **Admin panel** apnar uttor onujayi **USD e** (hisab milanor jonno) — kintu admin er nijer currency preference API ache.
- **Android APK**: UI APK te bundled, tai notun APK build korle hi phone er app e selector ashbe (PWA/browser e ekhon e ache).
- Promotion console (`promotion.boostpay.online`) — ekhon o USD; chaile setha o same system e ana jabe.

## 7. Revert

`git revert 95b2518` — sob route ar UI selector chole jabe; `db.currencyConfig` / preference field gulo data te pore thakbe kintu kichu effect korbe na (display USD e fire jabe)।
