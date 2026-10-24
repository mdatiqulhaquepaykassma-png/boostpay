# REPORT 22 — শুধু boost করা ডলার agent দিয়ে withdraw (Pay an Agent cap)

**Date:** 2026-10-24
**Rule (owner):** user app থেকে **শুধু boost করা ডলার** agent-এর মাধ্যমে pay / withdraw করা যাবে।
"Pay an Agent" খুললে **Available Boosted Withdraw** দেখাবে, আর তার **বেশি** agent-কে pay করা যাবে না।

---

## 1. "Boosted withdraw amount" কীভাবে হিসাব হয়

```
available_boosted_withdraw = min( current balance , lifetimeProfit − boostProfitWithdrawn )
```

- `lifetimeProfit` শুধু **boost reward** + **referral commission (boost yield-এর উপর)** থেকে বাড়ে — তাই
  agent দিয়ে জমা করা معمولی deposit **boost না করা পর্যন্ত withdraw করা যাবে না**।
- `boostProfitWithdrawn` = নতুন counter, যতটুকু profit ইতিমধ্যে agent-কে দেওয়া হয়েছে।
  এটা ছাড়া বারবার একই profit withdraw করা যেত।
- দুই-দশমিকের নিচে **floor** করা হয়, যাতে rounding-এ cap কখনো এক পয়সাও না ছাড়ায়।
- fee (2%) **cap-এর বাইরে**, সেটা balance থেকে যায় — owner decision.

## 2. কী কী বদলেছে

### server.ts
| জায়গা | পরিবর্তন |
|---|---|
| `boostWithdrawable()` (নতুন helper, `ensureAgentPayouts`-এর পরে) | cap হিসাব + `floor2` |
| `holdBoostProfit()` / `releaseBoostProfit()` | payout বানানোর সময় profit hold, cancel/expire-এ release |
| `POST /api/user/send-to-agent` | balance check-এর **পরে** cap check → `400 Only boosted dollars can be withdrawn through an agent…` + `maxWithdrawable` |
| payout create | `holdBoostProfit(user, amount)` — দুইটা pending claim code একই profit দুইবার নিতে পারবে না |
| `POST /api/user/agent-payouts/:id/cancel` | `releaseBoostProfit()` |
| `expireAgentPayouts()` (৩০ মিনিট TTL) | `releaseBoostProfit()` — expired code-এর টাকা ফেরার সাথে সাথে cap-ও ফেরে |
| `GET /api/agents` | নতুন field: `maxWithdraw`, `balance` |

### src/components/AgentPayModal.tsx
- Amount box-এর **উপরে** সবুজ কার্ড: **"Available Boosted Withdraw — $X.XX"** + `Max` বাটন।
- নিচে ছোট লেখা: শুধু boost profit withdraw করা যাবে + wallet balance।
- cap 0 হলে: "Nothing withdrawable yet — start a boosting cycle to earn boosted dollars first."
- submit-এ client-side check (server-ই আসল guard), cancel-এর পরে cap auto-refresh।

## 3. যা **বদলায়নি** (owner decision)
- **P2P (user→user transfer) আগের মতোই খোলা** আছে — এই cap শুধু agent payout-এ।
- boost **active** থাকলে agent-কে pay করা আগের মতোই বন্ধ (pause করতে হয়)।
- claim code ৩০ মিনিট, single-use, expire/cancel-এ full refund — অপরিবর্তিত।

## 4. Test result (লোকাল হারনেস, আলাদা data copy — production ছোঁয়া হয়নি)

| # | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | balance 100, profit 10, used 0 | cap = 10 | 10 | PASS |
| 2 | pay 12 (cap-এর বেশি) | 400 + Bengali/English message | 400, `maxWithdrawable: 10` | PASS |
| 3 | pay 4 (cap-এর ভিতরে) | success, fee 0.08, balance 95.92 | হুবহু | PASS |
| 4 | payout pending থাকা অবস্থায় cap | 6 | 6 | PASS |
| 5 | user cancel | refund 4.08, cap 10 | হুবহু | PASS |
| 6 | claim code expire (TTL) | refund + cap 10, `boostProfitWithdrawn` 0 | হুবহু | PASS |
| 7 | deposit only: balance 50, profit 0 | cap 0, pay 1 → 400 | হুবহু | PASS |
| 8 | balance 5 < profit 10 | cap 5, balance-check আগে ধরে | `Insufficient balance…` | PASS |
| 9 | profit 10, ইতিমধ্যে 4 withdrawn | cap 6 | 6 | PASS |

`tsc --noEmit` clean ✅ · `vite build` OK ✅

## 5. Note
- পুরনো user-দের `boostProfitWithdrawn` field নেই → `0` ধরা হয়, তাই কারো কিছু "হারায়" না।
- admin panel থেকে `lifetimeProfit` কমালে cap নিজেই `max(0, …)`-এ clamp হয়।
- `boostProfitWithdrawn` এখনো single-document JSONB-তে থাকে — durability সংক্রান্ত audit finding F-06 এই field-এর উপরেও প্রযোজ্য।
