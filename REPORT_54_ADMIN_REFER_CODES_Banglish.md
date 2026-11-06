# REPORT 54 — Admin panel theke refer code-er sob setting (manual control)

**Commit:** `6f83f6e` · **API live:** `v1.2.1794008156` · **Admin live:** `https://admin.boostpay.online` · **Tarikh:** 7 Nov 2026

## 1. Apnar chaoa
> "admin e sob golo setting diye dan jate ami admin panel theke manually sob korte pari."

Refer code-er puro control ekhon admin panel-e — **Admin → Referral → Refer codes**। User app-er kono code/limit manual-e edit na kore, ekhane thekei sob।

## 2. Panel-e ki ache

```
┌ REFER CODES ─────────────────────────────────────────────┐
│ CUSTOM CODES 6 | USERS WITH A CODE 3 | WITHOUT 11 | OVER LIMIT 0 │
└──────────────────────────────────────────────────────────┘

┌ GLOBAL SETTINGS ────────────────────────────────────────┐
│ Codes per user (lifetime) [ 3 ]   [⚡ Custom codes ON]  [Save] │
│ 0 = only number id · OFF = claiming bondho, purono link thik │
└──────────────────────────────────────────────────────────┘

┌ SET A CODE FOR A USER ──────┐ ┌ GRANT EXTRA CLAIMS ────────┐
│ User id [ 12 ] Code [MRBEAST]│ │ User id [ 12 ] Extra [ 2 ] │
│            [ Set ]           │ │            [ Grant ]       │
└──────────────────────────────┘ └────────────────────────────┘

CLAIMED CODES                          [code or user id] [Search]
MRBEAST    PRIMARY  #U1  $89.80  3 ref  just now        [🗑]
TECHGURU   PRIMARY +3 grant  #U2  $17.00  0 ref  just now [🗑]
ADMIN821   +3 grant  #U2  $17.00  0 ref  1m ago       [☆][🗑]
CAP0821    #U3  $0.00  1 ref  1m ago                   [☆][🗑]
NEXT7821   PRIMARY  #U3  $0.00  1 ref  1m ago             [🗑]
```

## 3. Kon kaj ta ki kore

| Control | Kaj |
|---|---|
| **Codes per user (lifetime)** | global limit (0–50)। 0 dile user shudhu number ID pabe |
| **Custom codes ON/OFF** | OFF ⇒ notun claim bondho (403), kintu **purono code/file link sob thik cholbe** |
| **Set a code for a user** | jekono user-ke jekono code (claim limit bypass — youtuber deal er jonno). Taken code age tar owner theke remove korte hobe (409) |
| **Grant extra claims** | ekjon user-er limit barai (global limit + grant), 0 dile normal-e fire |
| **☆ make primary** | oi alias-ke share link-er primary code banai (purono gulo alias hisebe cholte thake) |
| **🗑 remove** | code-ta puro muchে fela — sathe sathe resolve kora bondho (404/`resolves:false`) |
| **Search** | code ba user ID diye (id only — kono email/name na) |

Stats: total codes, koy jon user-er code ache, koy jon er nei, ar **over the limit** (jodi limit komano hoye karo beshi code theke jay)।

## 4. API (sob `SUPERADMIN` + audit-logged)

| Method | Path | Kaj |
|---|---|---|
| `GET` | `/api/admin/refer-codes?q=` | settings + stats + list |
| `POST` | `/api/admin/refer-codes/settings` `{limit, enabled}` | global settings |
| `POST` | `/api/admin/refer-codes/set` `{userId, code}` | manual set/replace |
| `POST` | `/api/admin/refer-codes/remove` `{code}` | code much |
| `POST` | `/api/admin/refer-codes/primary` `{code}` | primary switch |
| `POST` | `/api/admin/refer-codes/grant` `{userId, extra}` | extra claim |

Audit: `REFERRAL_CODE_SETTINGS`, `REFERRAL_CODE_SET_BY_ADMIN`, `REFERRAL_CODE_REMOVED_BY_ADMIN`, `REFERRAL_CODE_PRIMARY_BY_ADMIN`, `REFERRAL_CODE_GRANT`।

## 5. Safety
- Non-admin/user token ⇒ **401/403**; anonymous ⇒ 401 (test-e proof)
- List-e **email/name nei** — shudhu `#id`, balance, referral count
- Reserved word (`ADMIN`…) admin-o set korte parbe na (400)
- Ek code dui jonke deya jabe na (409)
- Limit komano hole purono code **muchi jay na**, shudhu notun claim bondho
- Sob switch **reversible** — test sheshe limit 3 ar ON-e fire

## 6. Test
| Suite | Result |
|---|---|
| `tools/user-journey.py` | **168 / 168** (+20; section 16 = admin controls) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc` (main + admin) + `vite build` (duitoi) | clean |
| Admin browser (1400×1000) | login → Referral → panel render, stats 6/3/11/0, code list PRIMARY/+grant badge soho, page error nei |
| Live | API `v1.2.1794008156`; `admin.boostpay.online` bundle `index-DiC3w5TO.js`-e panel ache; `/api/admin/refer-codes` unauthenticated ⇒ **401** |

Screenshot: `report-assets/admin-refer-codes.png`

## 7. Note
- Live-e **`management.boostpay.online` purono bundle** dekhacche (`index-8M2JNX-G.js`) — oi host-er deploy ekhono chaleni। `admin.boostpay.online` ekhon-i update hoye geche, oi khanei panel-ta pachhen। Management host-o update korte hole bolo, ami deploy trigger/verify kore debo।
