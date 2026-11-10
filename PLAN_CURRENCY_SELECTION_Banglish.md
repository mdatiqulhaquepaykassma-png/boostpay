# PLAN — Global Currency Selection System (BoostPay) — Banglish

**Status:** design only — kono code lekha hoy nai, apnar approval er por ek dhape (code + test + deploy) hobe.

---

## 1. Mul niti (sobcheye guruttopurno)

| Jinis | Thakbe |
|---|---|
| **Wallet / ledger / transaction** | **USD e fixed** (jemon ache) — kokhono bodlabe na |
| **Currency selector** | shudhu **display conversion** — rate diye gun kore dekhabe, `≈` chinho soho |
| **Balance change** | conversion er karone **kokhono** hobe na (0 ledger write) |
| **Client er pathano converted amount** | kokhono worldas hobe na — sob hishab **server side** |

Mane: user BDT select korle $8.40 er jaygay `≈ ৳1,028.16 BDT` dekhabe, kintu DB te balance $8.40 e thakbe, send/withdraw/boost sob USD te hobe.

## 2. Currency list (ISO 4217)

- ~180 ta currency: **Flag + Country/Zone name + Code + Symbol** (🇧🇩 Bangladesh – BDT ৳)
- **Searchable dropdown** (code / name / symbol diye khōja)
- Static list repo te (offline o cholbe), server theke enable/disable
- Symbol na thakle code dekhabe; Android e flag na render hole country code fallback

## 3. Kothay selector thakbe

| App | Jায়ga |
|---|---|
| **User app** | Balance card e **ID chip er thik opore** (Available Balance label er niche) — tap korle searchable dropdown |
| **Agent app** | Agent er balance card e same jায়ga |
| **Admin** | Header e choto selector (admin er nijer preference) |

## 4. Preference save (per-entity, alada)

- `user.currency`, `agent.currency`, `admin.currency` — ISO code, server validate kore **enabled list** er birudhe
- Ekjon user bodlale onno user/agent er ta **bodlabe na**
- Logout/login, notun device — sob jায়gay same preference load hobe
- Preference change audit log e (`CURRENCY_PREF_CHANGED`)

## 5. Exchange rate engine

```
provider → server cache (db.fxCache) → client
{ base: "USD", rates: {BDT: 122.4, EUR: 0.92, ...}, fetchedAt, source, stale }
```

- **Provider:** default free no-key API (open.er-api.com), admin panel theke URL/interval bodlano jabe; chaile **manual rate table** o set kora jabe
- **Refresh:** admin-configurable (default 60 min), admin er "Refresh now" button
- **Fallback:** API fail hole **last known valid rate** + `stale: true` + timestamp dekhabe; rate ekebare na thakle USD e dekhabe + notice
- **Cache:** sob request e API call hobe na — server cache theke serve

## 6. Display

- Balance, transaction list, boost plan strip, send/receive preview, promotion/bonus, chat e taka — sob ek e **money formatter** diye
- Format: `≈ ৳1,028.16` + niche choto: `rate 1 USD = 122.40 BDT · updated 12 min ago`
- Decimals: currency onujayi (JPY 0, BDT 2, USD 2-4 — boost er 8 decimal shudhu USD e)
- **Entry (type kora) field:** USD te thakbe (Q2 — apnar decision)

## 7. Admin panel (notun "Currency" tab)

- Supported currency **enable/disable**, ek click e sob
- **Default currency** set (notun user er jonno)
- **Rate provider** config: URL, refresh minutes, manual rates, "Refresh now", last update + status (OK / stale / failed)
- Base currency = USD (read-only, karon ledger USD)

## 8. API (notun)

```
GET  /api/currency/options                 → enabled list + symbols + flags + default + rates + fetchedAt
POST /api/user/currency   {code}           → user preference
POST /api/agent/currency  {code}           → agent preference
POST /api/admin/currency  {code}           → admin preference
GET  /api/admin/currency/config            → provider/interval/enabled/default/status
POST /api/admin/currency/config            → save (audited)
POST /api/admin/currency/refresh           → force fetch
```
Sob rate **server** theke; kono endpoint client er converted balance ney na.

## 9. Test plan (journey §30, ~14 check)

1. Options list e ISO code + symbol + flag ache, enabled filter kaj kore
2. Invalid code (XXX, "" ) → 400; disabled currency → 400
3. User preference save + **notun login/device e same** (+ agent er ta alada, admin er ta alada)
4. Ekjon user bodlale onno user er preference **bodlabe na**
5. Currency change e **balance/ledger/transaction ek taka o bodlay na** (before/after diff = 0)
6. Rate cache server side; client theke converted amount pathale reject/ignore
7. Provider fail simulate → last known rate + `stale: true` + timestamp
8. Admin enable/disable + default + interval save + audit
9. Send/withdraw amount USD te e thake (Q2 onujayi)

## 10. Kaj er dhap (ek dhape sob, kintu commit e bhag kora)

1. Backend: currency list, config, pref, rate cache+fallback, API, audit
2. User app: balance card selector + money formatter sob jায়gay
3. Agent app: balance card selector + formatter
4. Admin + promo console: "Currency" tab + header selector
5. Journey §30 + regression + system-check → deploy → live verify

## 11. Risk & nirapotta

- Rate API down → display purono rate e (stale mark), taka te kono effect nai
- Rounding: display only, tai 0.01 er difference o ledger e dhukbe na
- Fraud: kono user preference diye tader send limit/boost hishab bodlate parbe na
- Revert: `git revert` — preference field add kora hoy, purono data touch hobe na
- Purono APK: preference na thakle USD default (break hobe na)

---

## Apnar 4 ta decision dorkar (nicher question gulo)

1. **Rate provider** — free no-key API (recommend) / paid key / sudhu manual rate
2. **Entry field** — send/withdraw/boost er amount USD te type hobe (recommend) naki selected currency te type kore auto USD convert
3. **Admin panel** — sob taka USD te thakbe (hisaber accuracy, recommend) naki admin o nijer currency te dekhbe
4. **Base ledger** — USD fixed (recommend, karon payment webhook USD) — confirm
