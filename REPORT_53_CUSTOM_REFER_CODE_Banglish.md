# REPORT 53 — Custom (vanity) refer code

**Commit:** `cebf714` · **Live:** `v1.2.1794006694` · **Tarikh:** 7 Nov 2026

## 1. Apnar chaoa
> "refer e refer code generate korte parbe, nijer moto custom refer code banate parbe, jate signup e refer code use korte pare — jemon bivinno youtuber nijeder channel er nam e refer code banay proposition er jonno."

Hoye geche। Ekhon prottek user nijer moto code banate parbe (jemon `MRBEAST`, `TECH_GURU`), ar oi code diye signup korle referral link-tai thik thake.

## 2. User kivabe code banabe (Refer page)
```
┌ CUSTOM CODE                             0/3 used ┐
│ 4–16 characters, letters/numbers/_. Great for a  │
│ channel name (e.g. MRBEAST). Your older codes    │
│ keep working, so old links still pay you.        │
│                                                  │
│ [ TECHGURU            ]  [ Save ]                │
│ ✓ TECHGURU is available                          │
│ [ Cancel ]                                       │
└──────────────────────────────────────────────────┘
```
Save korle:
- `#U2` er jaygay **`#TECHGURU`** hoye jay (share link-o bodlay)
- niche chip-e dekhabe: `TECHGURU · active` `#U2` — mane purono code-o **cholche**
- `1/3 used` — total 3 ta code claim (1 prothom + 2 change) lifetime-e

Typing er shathe shathe check hoy:
| Type korle | Dekhabe |
|---|---|
| `JRNEY` | ✕ Code must be at least 4 characters. |
| `U3` (onno karor) | ✕ U3 is already taken |
| `ADMIN` | ✕ That code is reserved — pick another one. |
| `12345` | ✕ Use letters, numbers and _ only, and start with a letter. |
| `TECHGURU` | ✓ TECHGURU is available |

## 3. Signup-e code use
`https://boostpay.online/?ref=TECHGURU` / `#/join-ref/TECHGURU` — form-e code auto bhoshe, ar sathe sathe validate hoy:
- ✓ `Code TECHGURU is valid — linked to User #U2`
- ✕ `No user has the code NOSUCHCODE — you can still sign up, but no referrer will be linked.`

Bhul code signup **atkay na** (account khulbe), kintu response-e bole dey:
```json
"referral": { "applied": false, "usedCode": "NOSUCHCODE", "via": null,
              "referrerId": null, "note": "Refer code NOSUCHCODE was not found …" }
```
Thik code hole: `{"applied": true, "usedCode": "TECHGURU", "via": "custom", "referrerId": "U2"}`

## 4. Rules (guruttopurno)
- **4–16 character**, `A–Z 0–9 _`, prothom ta letter hote hobe
- **Shudhu number** code neya hoy na (user ID-r sathe conflict)
- **Reserved**: ADMIN, AGENT, SUPPORT, SYSTEM, OWNER, BOOSTPAY, OFFICIAL, MANAGEMENT, TEST, DEMO, HELP, REF, JOIN, WALLET, BONUS …
- **Purono code kokhono more na** — rename korleo `U2` ba purono vanity code kaj korte thake (alias), tai je link video te ache seta bondho hoy na
- **Cap: 3 claim** per account (spam protection); cap sesh hole error + support-e bolo
- Onno user-er code **churi kora jay na** (409), ar code **kono email/name leak kore na** — shudhu `referrerId`
- Claim/rename sob **audit log**-e (`REFERRAL_CODE_CLAIMED`)

## 5. API
| Method | Path | Kaj |
|---|---|---|
| `GET` | `/api/refer/check-code?code=X` | public: format ok? taken? available? kon user-er? |
| `POST` | `/api/refer/custom-code` `{code}` | claim / rename (auth, 10/min) |
| `GET` | `/api/refer/my` | + `customCode`, `codes[]` (alias list), `codeClaimsLeft`, `claimsUsed`, `referLink` |
| `GET` | `/api/refer/code` | + same fields |
| `POST` | `/api/users/register` | `referralCode` ekhon vanity code-o chole + `referral{}` result |
| `POST` | `/api/refer/apply` | vanity code-o chole |

## 6. ⚠️ Ekta bug dhora poreche (ar thik kora hoyeche)
Custom code banate giye ekta bhul hook nesting hoye gechilo — app-er **puro screen white** hoye jeto (React error #321), kintu API test shob pass korto। Browser-e dhora poreche, thik kora hoyeche। Er jonno ekta notun guard add kora hoyeche: **`tools/ui-smoke.py`** — build kora app real browser-e khule, kono page-error hole fail kore। Ei guard ekhon live bundle-eo chokh rakhe।

## 7. Test
| Suite | Result |
|---|---|
| `tools/user-journey.py` | **148 / 148** (+19: section 15 = custom codes) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tools/ui-smoke.py` | UI smoke OK — no page errors |
| `tsc --noEmit` + `vite build` | clean |
| Browser (390×844) | claim form, live availability, save, signup-e ✓/✕ — sob dekha geche |
| Live | `/api/refer/check-code` live-e 200; bundle `index-CR8MjNJx.js` + `ReferView-D3cxeymO.js`-e "MRBEAST"/custom code confirm |

Screenshot: `report-assets/refer-custom-code.png` · `report-assets/refer-custom-code-saved.png` · `report-assets/signup-ref-valid.png` · `report-assets/signup-ref-bad.png`
