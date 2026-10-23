# BoostPay — 4 Fix Report (Banglish)

**Date:** 2026-10-23
**Commit:** `b02f0f0`
**Deploy:** BoostPay (user app) + BoostPay Agent + BoostPay Management — tinta e deploy, health OK.

---

## 1. Claim code copy UI fix

- Age copy button ta choto icon chilo, code er pashe ghushe jeto, ar iOS / non-secure context e `navigator.clipboard` fail korle kono feedback dito na.
- **Ekhon:**
  - Code ta alada line e boro kore dekhabe (4 character, onek jaiga), tap korle o select kora jay.
  - Nicher dike **“Copy code”** button — chap dile **“Copied!”** hoye tick dekhay (2 second).
  - `navigator.clipboard` na thakle purono `execCommand` fallback; ekdom fail korle message e puro code ta likhe dey — agent ke bole dewa jabe.
  - Pending list er protita code er pashe o choto copy button ache.

## 2. User message agent chat e show korche na — fixed

**Asol karone:** agent app er chat screen e ekta **infinite request loop** chilo. `onRead` callback ta protibar notun function hisebe create hoto, tai polling effect protibar abar subscribe korto → thread bar bar `[]` hoye reload hoto, rate-limit e dhakka kheye message harie jeto / flicker korto.

**Fix:**
- Callback gulo ref e rakha hoyeche (stable) — ekhon effect ar re-subscribe kore na.
- Thread kholar somoy ekbar e reset hoy, poll e ar reset hoy na.
- Server e **instant wake-up** add kora hoise: user message pathale `pushToAgent` diye agent er SSE stream e event jay — agent console 20s wait na kore sathe sathe list refresh kore.
- User side e agent chat ekhon **puro chat kit** — text, photo, voice, reply, seen tick, typing (age shudhu text dekhato, tai photo/voice pathale “show korche na” mone hoto).

## 3. Agent ↔ User voice + video call — ekhon kaj kore

**Age keno korto na:**
- `/api/chat/call-signal` non-admin caller ke straight **403** dito — mane user o agent duijon e call dite parto na.
- Agent app e call UI i chilo na, ar agent er kono live stream (SSE) chilo na — tai incoming call asleo receive korar upay chilo na.
- App je `video-request / video-accept / video-decline / video-cancel` signal pathay, server ogulo **unknown** bole reject korto — video switch o kaj korto na.

**Ekhon:**
- Server USER, ADMIN ar **AGENT** — tin role er call signal e support kore.
  - Agent → User call: `pushToUser` (user app er CallManager ring kore, Accept/Decline dekhay).
  - User → Agent call: `pushToAgent` (notun `/api/agent/stream` SSE) — agent app ring kore, Accept/Decline dekhay.
  - User → User call: age er motoi admin-only (403).
  - Agent shudhu oi user ke call korte parbe je **age message koreche** (privacy).
- Agent app e **puro WebRTC CallManager** — voice/video, mute, camera toggle, speaker, hang up, missed call, call duration; call log thread e “📞 Voice call · 2:14” hisebe boshe.
- Call button: **agent er chat thread header e Phone + Video button**, **user er agent chat header e o Phone + Video button**.
- Incoming call e user side e caller name **“Agent AGT-xxxx”** dekhabe (age “User #…” dekhato).
- Video switch (audio → video) handshake o ekhon accepted.

## 4. Agent ↔ Management chat er boro problem — fixed

**Ki chilo:**
1. Agent app er management thread e **same infinite polling loop** (upor point 2 er moto) — thread bar bar reload, message miss howa.
2. `ChatList` er reply system **global window event** chilo — agent app e user thread ar management thread duitar reply strip e cross-talk hote parto (ek thread er reply onno thread e boshbe).
3. Reply korte **double-tap** lagto — mobile e i ta dhora porto na.

**Fix:**
- Polling loop duijaygay i thik kora hoise (agent + management app).
- Reply event ekhon **scope** onujayi — `agent-user-<id>`, `agent-management`, `mgmt-agent-<id>`, `user-agent-<id>`; reply kokhono onno chat e jabe na.
- **Tap-and-hold (450ms) reply** add kora hoise — mobile e o kaj kore (double-tap ar right-click o ache).
- Management side e o SSE-wake type refresh, thread preview (Photo / Voice message), unread badge thik ache.

---

## Verification

| Test | Result |
| --- | --- |
| Notun call test suite (`test_calls.mjs`) — 22 assertion | **ALL PASSED** |
| Agent → user offer / user answer realtime (SSE) | PASS |
| User → agent offer / agent reject / user e reject dekhay | PASS |
| video-request / accept / decline / cancel | PASS |
| User → user call blocked (403), agent → agent blocked (400), no-thread user blocked (403) | PASS |
| Agent stream without token → 401 | PASS |
| Chat/media parity suite (`test_agent_parity.mjs`) — 50+ assertion | **ALL PASSED** |
| Typecheck: user app, agent app, management app | Clean |
| `vite build` × 3 apps | Clean |
| Live health (3 domain) | OK, same version |

---

## Note (boost engine — jiggesh korchilen)

Apni `keep_click` bechlen — mane **one cycle = one click**, cycle shesh hole boost theme jabe, abar Start chaap dile notun cycle. Ei rule e kono poriborton kora hoy nai.

Engine er live data (ajker check):
- 24 ghontay **806 reward** credit hoise, 6 ghontay **420** — cycle cholche.
- Kono **duplicate payout** nei (`boostStartAt` duplicate key = 0).
- Target time cross korar pore o kono cycle **atke nei** (stuck = 0 row).
- Kono reward amount **0 ba negative** na.
- Ekhon 6 ta boost running + 1 paused (72 user er moddhe) — baki ra Start chaaple cholbe.

`lifetimeProfit` ar reward sum er chhoto mismatch (jemon User #13 e −15.17) purono data reset/patch er effect — balance ledger (`balanceAfter`) thik ache, area ta history theke porchhe. Chaile ekta nirdisto User ID dile oi account er puro ledger line-by-line miliye debo.
