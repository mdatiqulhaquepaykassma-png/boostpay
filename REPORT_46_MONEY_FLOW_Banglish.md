# REPORT 46 — Admin Money Flow: tk kar theke kar kache gelo, ekhon kar kache ache

**Commit:** `1ee554b` · **Tarikh:** 2 Nov 2026 · **App:** Admin console (`admin.boostpay.online`) — notun tab **Money Flow**

## 1. Apnar chaoa

> "admin panel e tk kivabe galo sei tree lagbe, UI te visible tree lagbe — tk kar theke kar kache kivabe galo, jate track korte pari, ar fund ekhon kar kache ache."

## 2. Ki banaisi

Admin console-e notun tab: **Money Flow** (Agents & Management-er pashe).

### (a) Ekhon kar kache koto ache — upor-e 4 ta card
| In user wallets | In agent wallets | In management wallets | In transit |
|---|---|---|---|
| $141.60 · 24 users · 1 boosting | $30.20 · 1 agent | $0 · 0 | $0 · unclaimed claim codes |

Tarpor chips: **Total at rest** · Minted by boost · Referral commissions · P2P volume · Paid to agents · Admin credits · Admin debits · System delta.

### (b) Taka kivabe ghurছে — ekta account theke trail
Search box-e user ID (`U1`), agent (`AGT-1`) ba management (`MGT-101`) likhe **Trace**, ba quick-open chip-e tap:

```
USER  User #U1                          Balance now  $65.60
Received all-time $0   Sent all-time $5,334   Net -$5,334   Movements 5314

Came IN from                        Went OUT to
(no incoming money recorded)        UNKNOWN      user→user   $5,300  (5300×)
                                    AGT-1        user→agent    $20.00 4× · fee $0.40   ›
                                    U2           user→user     $14.00 10×             ›

Last 60 movements
  2h ago  #U1 → #AGT-1   user→agent   $5.00   CLAIMED
  ...
```

- prottek row ekta **door** — tap korlei oi account-er trail khule (breadcrumb: `Flow › #U1 › AGT-1`), joto dokhon chaan
- row-e dekhay: counterparty type (USER/AGENT/MANAGEMENT/SYSTEM), koto taka, koto bar, sesh kobe, agent fee, claim-code status (`PENDING`/`CLAIMED`)
- **In transit** box: je taka user theke beriye geche kintu agent claim koreni (claim code, expire time) — asol "taka ekhon kothay" gap
- agent wallet-er dike-o kaj kore: AGT-1-er **Came IN from** = U1 $20 (4× , fee $0.40)

## 3. Notun endpoint (dutoi admin-only, read-only)

**`GET /api/admin/money-tree/summary`** → holdings (users/agents/management/in-transit), lifetime totals, top users, recon.
**`GET /api/admin/money-tree?node=<id>`** → oi account-er `in[]`, `out[]`, `inTransit`, `totals`, ar sesh 60 movement.

Kotha theke data:
- `transactions`: `TRANSFER_SENT` (user→user), `AGENT_TRANSFER_SENT` (user→agent, fee shoho), `REWARD` (boost engine→user), `REFERRAL_COMMISSION` (referred user→referrer), `ADMIN_CREDIT/DEBIT`
- `agentLedger`: `MGMT_CREDIT` (management→agent), `MGMT_DEBIT` (agent→management)
- `managementLedger`: admin↔management
- `agentPayouts`: `PENDING` = in-transit

**Security:** `requireAdmin` (user token / agent token / anonymous → 401-403), kono write nei, `no-store`.

## 4. Sodhonota (UI-te-o lekha)

Wallet balance ekta single number — tai "ei dollar ta user 7 theke eshechhe" bole kono database bolte pare na. Ja bola jay: **ke kake koto diyechhe** ar **taka ekhon kar kache ache** — ei duita-i ei view-e ache. Recon delta shob somoy 0 hobe na (legacy/seed/imported row thakle), tai seta "hint, audit total na" bole UI-te lekha.

## 5. Test

| Suite | Result |
|---|---|
| `tools/user-journey.py` | **95 / 95** (age 83; +12 notun money-tree check) |
| `tools/regression.cjs` | 42 / 42 |
| `tools/system-check.py` | no problems |
| `tsc --noEmit` (main + admin) | clean |
| `vite build` (main + admin) | clean |

Notun 12 ta check: summary load · 4 ta account type-i ache · **at-rest total = 4 ta holding-er jog** · account trail khule · balance dekhay · prottek edge-e counterparty+amount+kind · agent wallet-o trace hoy · anon 401 · user token 401 · agent token 401 · unknown account 404.

Browser-e (Playwright, 1440×1000): admin login → Money Flow → `U1` trace → `Went OUT to` theke `AGT-1` khule → agent-er `Came IN from` U1 $20. Kono console error nei, kono 4xx nei.

Ekta bug dhora porlo-o fix korechi: purono API build-er sathe page blank hoye jeto (`summary.topUsers.slice` undefined) — ekhon prottek list defensive fallback kore, tai UI kokhono faka thake na.

## 6. Screenshot

- `report-assets/money-flow-summary.png` — holdings + chips + search
- `report-assets/money-flow-node.png` — User #U1-er trail (in/out + last movements)
- `report-assets/money-flow-agent.png` — AGT-1 wallet

## 7. Note

Ei feature **shudhu porar jonno** — kono balance, ledger ba payout logic bodlano hoyni. Admin console `admin.boostpay.online`-e Dokploy-redeploy hole tab ta eshe jabe (main API deploy er sathe sathe).
