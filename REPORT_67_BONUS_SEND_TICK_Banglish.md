# REPORT 67 — Bonus er taka ke send korte parbe (tick) — Banglish

**Date:** 2026-11-08
**Commits:** `61d1004` (tick) · `2ce1bac` (welcome default = boost only)
**Live:** `v1.2.1794176743` · user app `index-DVM9WHW8.js` · promo console `index-Cb39HNBm.js`
**Test:** journey **356 pass / 0 fail** · regression 42/0 · system-check clean

---

## 1. Notun tick: "Bonus money can be sent to"

Campaign editor e (WELCOME + code campaign duitatei) ekta notun select:

| Option | Mane |
|---|---|
| **Nobody — boost only** | bonus taka send hobe na, sudhu boost (ar withdraw jodi lock na thake) |
| **Their direct referrer only** | je amake refer korse (upline L1) tar kache pathate parbe |
| **Their own team members only (downline)** | nijer niche jara, jekono depth |
| **Their referrer + own team (whole downline)** | upline + pura downline ← *recommended* |
| **Anyone** | kono restriction nai |

Campaign card e choto pill dekhabe: `send: boost only` / `send: referrer only` / `send: team below` / `send: team` / `send: anyone`.

## 2. Ekhon live ki hocche

WELCOME campaign (`$1`) e tick set kora chilo na, tai **default = "Nobody — boost only"** holo. Live check:

```
GET /api/promo/welcome → bonusSend: "NONE",
                          bonusSendLabel: "boost only — it cannot be sent to anyone"
```

Mane: **184 jon user er $1 ekhon send kora jabe na** — boost korte parbe (ar lock 0 tai withdraw path khulo ache jemon age chilo)। Apni console theke jekono shomoy "referrer only" / "team" / "anyone" kore dite parben.

## 3. Rule kivabe kaj kore (guruttopurno)

Bonus ta main balance er taka, tai rule ta **unspent bonus er upor** projojyo hoy:

- User er balance e jodi $3 bonus + $5 nijer taka = $8 → **$5 je kew** ke pathate parbe, **$3 shudhu allowed manush** ke
- Bonus kharoch korle restriction nijei kome (BONUS_SENT_FROM_BALANCE ledger row)
- Model: *jodi send amount ta "nijer taka" er theke beshi hoy, tobe recipient allowed set e thakte hobe*

Example message (user dekhabe):
> `$3.00 of your balance is a promotion bonus that can be sent to your referrer and your own team members only. You can send up to $5.00 to other users.`
> `$1.00 of your balance is a promotion bonus that can only be used for boosting — it cannot be sent to anyone. Boost it and the profit you earn on top is free to send.`

**Agent payout**: agent team er keu na, tai bonus taka diye agent ke pay kora jabe na (nijer taka diye parbe) — force-withdraw bondho na kore.
**Boost**: always allowed (lock ar send rule kono tai boost block kore na)।

## 4. User app + API

- User app er Refer/Bonus section e choto line: *"$3.00 of your balance is bonus money. It can be sent to your referrer and your own team members only. Your own money — $5.00 — can go to anyone. Boosting is always allowed."*
- `/api/user/bonus` → `bonusRestricted`, `bonusSendMode`, `bonusSendLabel`, `ownSendable`
- campaign public view → `bonusSend`, `bonusSendLabel`

## 5. Test (§29, 14 check)

"boost only" → stranger ke send **403** + boost **200**; "referrer only" → stranger 403, referrer 200; nijer taka diye stranger 200; "team only" → team er baire 403, nijer downline 200; "anyone" → 200; bonus kharoch korle restricted amount kome ($3 → $2); tick na dile welcome default **boost only**; signup screen e rule dekha jay।

**Journey: 356 pass / 0 fail.**

## 6. Apnar console e

- WELCOME → Edit → **"Bonus money can be sent to"** → jeta chan (ekhon default boost only)
- Ek e form e **"Bonus lock (boost only)"** (0 din = lock nai)
- **Fix counters** ar **Fraud reviews → RV-43696471 (Reject)** — ei duita age er report theke baki
- **Duplicate account check — same IP → Ignore the IP** — shared mobile IP er area te notun user atkabe na

## 7. Revert

`git revert 2ce1bac 61d1004` — tick chole jabe, bonus abar sobai ke send kora jabe (data same thakbe)।
