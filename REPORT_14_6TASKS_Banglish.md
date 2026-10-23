# BoostPay — 6 Fix Report (Banglish)

**Date:** 2026-10-23
**Commit:** `cd8a9be`
**Deploy:** BoostPay (user app), BoostPay Agent, BoostPay Management — sob three e deploy done, health OK.

---

## 1. Gmail rule — Agent + Management e apply

- User app er moto ekhon Agent ebong Management login **shudhu @gmail.com** diye hobe.
- Input e sudhu local part type korben (`mgrname`), pashe fixed `@gmail.com` suffix dekhabe.
- Server side strict check: `@yahoo.com` / `@outlook.com` dile **400** — domain auto-convert kore na.
- Login e local part o full `@gmail.com` — dutoi accept hoy (age jemon chilo).

## 2. Transaction history — click korle full details

**Agent app**
- History e search box + protita row e tap korle bottom-sheet:
  status, date, reference/TX ID, type, user ID, actor, amount, user fee, commission, balance after, note.

**Management app**
- Wallet ledger ebong Network ledger — duitor row e tap korlei detail sheet:
  date, reference, agent ID, user ID, amount, fee, agent commission, balance after, note.

**User app:** pay-an-agent receipt e claim code + countdown + pending list details (niche point 5).

## 3. Chat — user er chat er shob feature Agent + Management e

Shared `ChatKit` component (dui app e same) — ekhon sob jaygay same rule:

- **Text + Photo + Voice note** (photo max size limit, non-image reject)
- **Reply** — je kono message e reply, quote strip dekhabe
- **Seen / read tick** — peer pore porle tick update
- **Typing indicator** — dui dik theke
- **Unread badge** — tab e count + thread list e per-agent count
- **Day separator**, time, 6-second polling
- Agent ↔ User thread, Agent ↔ Management thread, Management ↔ Agent thread — sob same feature.

Chat media rule: photo + voice only (no file/document/poll/sticker) — user chat er sathe 100% same.

## 4. Password change + forget password (Agent + Management)

- **Profile → Change password**: current password + new password + confirm (`/api/agent/change-password`, `/api/management/change-password`).
- **Forgot password?** (login screen): Gmail e **6-digit code** pathano hoy → code + new password diye reset.
- Admin panel theke o reset kora jay (owner decision onujayi duita option ekhon live).

## 5. User → Agent payment: 4-digit claim code (digit + alphabet mix)

**Flow (live):**
1. User "Pay an Agent" e amount diye pathale taka **hold** thake (agent e sathe sathe jay na).
2. Screen e boro kore **4-character code** dekhabe (example `H68D`, look-alike okhor baad) + copy button + **30:00 countdown**.
3. Agent "Receive" tab e `Claim a user payment` card e code ta input korle taka + commission agent er balance e chole jay (code single-use, case-insensitive).
4. **User jekono somoy cancel** korte parbe — puro amount + fee sathe sathe refund.
5. **30 minute** e code expire hole **auto refund** — kono taka atke thake na. Agent er wrong code try limit: 15 minute e 10 bar.

User app er Pay-an-Agent modal e **"Waiting for an agent"** list o ache — sob pending code, countdown ar Cancel button ek jaygay.

## 6. Management theke Config remove

- Config tab, nav entry, "Edit configuration" button — sob remove.
- Management er bundle e ar kono `/api/management/config` call nei.
- Commission/fee settings ekhon shudhu **admin panel** theke kontrol hobe.

---

## Verification

| Test | Result |
| --- | --- |
| Parity suite (`test_agent_parity.mjs`) — 50+ assertions | **ALL PASSED** |
| Gmail reject (non-gmail 400), local-part login | PASS |
| Change / forgot / reset password (agent + management) | PASS |
| Claim code `84Z9`: hold → redeem → agent balance, replay block | PASS |
| Cancel + expiry refund (`AGENT_PAYOUT_REFUND`) | PASS |
| Photo / voice / reply / seen / typing / media preview | PASS |
| TypeScript typecheck — user app, agent app, management app | Clean |
| `vite build` × 3 apps | Clean |
| Live health — boostpay.online, agent.boostpay.online, management.agent.boostpay.online | OK (same version) |
| Live route check — redeem / change-password / forgot-password / typing / agent-payouts | 401/400 (present) |
| Live bundle check — "Claim code", "Change password", "Transaction details", no "Config" | Verified |
