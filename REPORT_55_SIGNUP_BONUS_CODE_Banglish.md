# REPORT 55 — Refer code diye join korle dollar bonus (admin controlled)

**Commit:** `507212c` · **API live:** `v1.2.1794088416` · **Admin live:** `admin.boostpay.online` · **Tarikh:** 8 Nov 2026

## 1. Apnar chaoa
> "admin er refer code deye join korle dollar bonus pabe. admin code and amount set korte parbe, admin proti ta refer code er jonno koto bonus pabe, koto jon nite parbe seta korte parbe. refer code er bonus amount transfer korte parbe kina seta-o set kore dite parbe."

Chari tai hoye geche — **bonus code** ekhon ekta alada jinish, jeta admin panel theke pura control hoy।

## 2. Admin panel → Referral → SIGNUP BONUS CODES

```
┌ SIGNUP BONUS CODES              2 active · 3 joined · $13.00 paid · 2 boost-only ┐
│ Code      Bonus $   How many people                                             │
│ [YT2026]  [ 5 ]     [ 100 ]   [Transferable]  [ON]  [Create]                     │
│ note (internal, e.g. 'TechGuru collab Nov')                                     │
│                                                                                 │
│ FBREELS   $2.00  transferable  ACTIVE  0/50 used  $0 paid  collab       [☆][🗑]  │
│ YT2026    $5.00  boost only    ACTIVE  0/100 used $0 paid  collab       [☆][🗑]  │
│ BONUST698 $4.00  transferable  OFF     1/1 used   $3.00 paid            [☆][🗑]  │
│           #15 $3.00                                                             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| Field | Mane |
|---|---|
| **Code** | je code diye join korbe (`YT2026`); nijer moto set korte parben |
| **Bonus $** | oi code diye join korle area wallet-e sathe sathe eto taka |
| **How many people** | koy jon **manush** ei bonus nite parbe (dollar na, manush) — sesh hole code bonus deya bondho |
| **Transferable / Boost only** | bonus taka transfer korte parbe kina (niche detail) |
| **ON/OFF** | code-er bonus chalu/bondho (purono je pay koreche tader taka thake) |
| **✎ (star) / 🗑** | edit / remove (remove korle notun ke pay na, purono taka thake) |
| Usage line | `1/1 used`, `$3.00 paid`, ar `#15 $3.00` — ke ke niyeche (id only) |

## 3. "Transferable" na "Boost only" — ei setting ta ki kore

- **Transferable (default)** → bonus taka normal balance; send, agent pay, withdraw — sob korte parbe।
- **Boost only** → taka wallet-e thake, **compound kore** (boost chole), kintu **ber kora jay na** — send/agent/withdraw bondho। Kintu **oi taka diye ja profit hobe seta spendable** — mane $5 boost-only bonus + $0.30 profit ⇒ $0.30 send korte parbe।
  **Keno ei option:** youtuber bonus ta jeno cash-out na kore boost kore — abuse bondho, kintu join kora user-ke baron kora hoy na।
- Boost-only thakle wallet-e chip dekhabe: **🎁 $5.00 boost only** (tap korle tooltip-e puro byakha)
- Send korar chesta korle sotti kotha bole: **"Your $5.00 signup bonus can only be boosted — it cannot be sent, paid to an agent or withdrawn. Boost it and the profit you earn on top becomes sendable."** (age eta "admin hold" bole bhul message dito — thik kora hoyeche)

## 4. Signup screen
`https://boostpay.online/?ref=YT2026` →
```
Referral Code (optional)
🎁 Code YT2026 gives a $5.00 signup bonus (boost only)
```
Ba jodi oi code kono user-er personal code hoy, sathe `✓ Code … is valid — linked to User #12` o dekhabe (dutoi eksathe hoy)।

## 5. API
| Method | Path | Kaj |
|---|---|---|
| `GET` | `/api/admin/bonus-codes` | list + stats + claimants |
| `POST` | `/api/admin/bonus-codes/save` `{code, amount, maxClaims, transferable, enabled, note}` | create/edit |
| `POST` | `/api/admin/bonus-codes/remove` `{id|code}` | retire |
| `GET` | `/api/refer/check-code?code=` | public: `bonus:{amount, transferable, remaining, active}` |

Signup response-e notun `bonus: { code, paid, locked, remainingAfter }` field।
Ledger: `type:'SIGNUP_BONUS'` transaction + `SIGNUP_BONUS_PAID` audit log + user-ke notification। Day-by-day lifetime ledger-e bonus ta "money in" hisebe dhukbe।

## 6. Safety (sob test kora)
- Bonus **ekbar-i** dey; `used` counter atomic (join with success holei barbe)
- Cap sesh ⇒ notun ke taka na, code `active:false` (signup atke na)
- **Cap komano jabe na** jodi already eto jon niye fele (400)
- Negative amount / negative cap ⇒ 400; amount max $100,000
- User token diye bonus banano jabe na (401) — **taka mint** prottek admin-only + audit
- Code jodi kono user-er personal refer code hoy ⇒ 409 (misuse bondho), take "use that user's code and set the bonus here" message
- Retired code ar bonus dey na, kintu jara niyeche tader taka thake

## 7. Test
| Suite | Result |
|---|---|
| `tools/user-journey.py` | **189 / 189** (+21; section 17 = bonus codes) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc` (main + admin) + `vite build` | clean |
| Browser | admin panel (1400) bonus card + list render; signup (`?ref=YT2026`) bonus line; wallet chip 🎁 $5.00 boost only; 403 refusal message |
| Live | API `v1.2.1794088416`; user bundle-e "boost only"; `check-code` live `bonus` field; `admin.boostpay.online` bundle `index-DKuStzmi.js`-e panel ache; `/api/admin/bonus-codes` ⇒ **401** unauthenticated |

Screenshot: `report-assets/admin-bonus-codes.png` · `report-assets/signup-bonus.png` · `report-assets/wallet-boost-only.png`

## 8. Note
`management.boostpay.online` ekhono purono bundle (`index-8M2JNX-G.js`) — oi host-er deploy chaleni। `admin.boostpay.online` update hoye geche।
