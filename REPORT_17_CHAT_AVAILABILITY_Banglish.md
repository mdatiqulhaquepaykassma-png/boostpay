# REPORT 17 — Chat বন্ধ / Agent Chat না পাওয়া — Fix Report
**তারিখ:** 2026-10-23 · **Build:** `v1.2.1792769928` · **Commit:** `0157e86`

---

## ১. আসল সমস্যা কী ছিল (Confirmed)

অনেক user বলছিল "chat বন্ধ", কারো কারো chat করতে গেলে account frozen দেখাচ্ছিল।

Production DB (`app_state`, id=1) থেকে পাওয়া গেছে:

| কী | মান |
|---|---|
| `config.antifraud.enabled` | `true` |
| `config.antifraud.maxMessagesPerMin` | `10` |
| `chatSpamFreezeMs` | সেট করা নেই |
| Anti-fraud log | user `57` — `Chat spam 11/min` — 2026-10-22 08:37 এবং 08:47 |

অর্থাৎ **10 টার বেশি মেসেজ/মিনিট** গেলে পুরো account freeze হয়ে যাচ্ছিল। দুইজন মানুষের সাধারণ গল্প করলেও মিনিটে ১১টা মেসেজ চলে যায় — তাই normal chatting করলেই freeze।

আরও বড় সমস্যা: freeze মানে শুধু chat না — **পেমেন্টও lock**। frozen account `/api/user/send-to-agent` (Pay an Agent) দিলে `403 Your account is currently frozen. Payments are locked.` এই error পাচ্ছিল। মানে chat করার "শাস্তি" টাকা লেনদেন বন্ধ করে দিচ্ছিল।

লোকাল harness-এ একই bug reproduce হয়েছে (user `2`, reason `Auto anti-fraud chat spam: 11 msgs/min`)।

---

## ২. কী কী change হয়েছে

### ক) Chat আর freeze করবে না
`server.ts` → `/api/chat/send` anti-fraud block:

- **Soft limit** = `max(30, maxMessagesPerMin || 10)` → এখন কার্যত **30/মিনিট**
- Soft limit পার হলে শুধু **`429` + মেসেজ**: *"You are sending messages too fast. Please slow down a moment."* — কোনো freeze নেই, balance lock নেই
- **Hard limit** = `max(soft × 3, chatSpamFreezeAt || 90)` → অর্থাৎ **90/মিনিট** এর বেশি হলে তবেই log + freeze (এটা এখন সত্যিকারের spam/bot case)
- Production config এখনো `maxMessagesPerMin: 10` আছে — কিন্তু code minimum 30 ধরে, তাই একে বদলাতে হবে না

### খ) পুরোনো freeze হওয়া account auto release
Server boot-এ একবার repair চলে: যাদের `frozenReason` = `Auto anti-fraud chat spam …` তাদের freeze তুলে দেওয়া হয় (log-এ `[boot] released N account(s)` দেখা যায়)। এতে যারা পুরোনো rule-এ আটকে ছিল তাদের **chat + পেমেন্ট দুটোই** ফিরে আসে।

### গ) Per-conversation flood guard ও route rate limit বাড়ানো
| জায়গা | আগে | এখন |
|---|---|---|
| একই conversation-এ flood guard | 20/মিনিট | **40/মিনিট** |
| `/api/user/message-agent` | 30/মিনিট | **60/মিনিট** |
| `/api/agent/message-user` | 30/মিনিট | **60/মিনিট** |
| `/api/management/agents/:id/messages` | 30/মিনিট | **60/মিনিট** |
| `/api/agent/message-management` | 30/মিনিট | **60/মিনিট** |

### ঘ) User app থেকে Agent Chat-এ যাওয়া সহজ হয়েছে
- Wallet screen-এ **আলাদা "Agent Chats" বাটন** (sky-blue) — এটা সবসময় চালু। আগের "Pay an Agent" বাটন boost চলার সময় `disabled` থাকত, তাই boost চলাকালীন user agent-এর সাথে chat-এ ঢুকতেই পারত না
- Unread badge এখন "Agent Chats" বাটনের উপর
- বাটনে চাপ দিলে সরাসরি **conversation list** খোলে (preview + time + unread count + tap → thread)
- Pay modal-এর ভিতরে **Pay ⇄ Chats** toggle, তাই যেকোনো জায়গা থেকে দুই দিকেই যাওয়া যায়

### ঙ) Live update (polling-এর অপেক্ষা নেই)
- নতুন `boostpay:agent-chat` event — agent reply দিলে user-এর conversation list, unread badge আর খোলা thread সাথে সাথে refresh হয়
- Agent app-এ SSE wake listener (`boostpay:agent-chat-wake`) — user লিখলেই agent-এর খোলা thread refresh
- নিজের পাঠানো মেসেজ double দেখানোর bug ঠিক (dedupe by message id)

### চ) Chat polish (তিনটি app-এ একই `ChatKit`)
- **Auto-scroll** এখন শুধু তখনই হয় যখন পাঠক নিচে আছেন — আগে পুরোনো মেসেজ পড়তে গিয়ে নতুন মেসেজ এলে view লাফিয়ে নিচে চলে যেত
- iOS-এ voice note-এর mime ঠিক (Safari `audio/mp4`)
- Reply শুধু নিজের thread-এর মেসেজে (cross-thread reply patch বন্ধ)
- 5000-message cap এখন `splice` দিয়ে সামনে থেকে trim (আগে `length =` দিয়ে array reference ভাঙত)
- Inbox preview-তে `Photo` / `Voice message` দেখায়, খালি thread-এ 200 + empty list (আগে error)

---

## ৩. Agent / Management chat feature parity (আগের round-এ দেওয়া, এই round-এ verify করা)

| Feature | User chat | Agent↔User | Management↔Agent |
|---|---|---|---|
| Text | ✅ | ✅ | ✅ |
| Photo | ✅ | ✅ | ✅ |
| Voice note | ✅ | ✅ | ✅ |
| Reply | ✅ | ✅ | ✅ |
| Seen / read receipt | ✅ | ✅ | ✅ |
| Typing indicator | ✅ | ✅ | ✅ |
| Unread badge | ✅ | ✅ | ✅ |
| Live refresh | ✅ | ✅ (SSE) | ✅ (6s poll) |

তিনটি app-ই একই `ChatKit` component ব্যবহার করে — তাই feature গুলো কোড-লেভেলে অভিন্ন (verified: `diff` = identical)।

---

## ৪. Test result (local harness, port 4100)

- `test_chat_audit.mjs` → **ALL CHAT AUDIT TESTS PASSED**
  - per-chat flood guard 429 (18টি 429 পেয়েছে) ✅
  - 5000 cap: newest থাকে, সামনের পুরোনো row drop হয় ✅
  - cross-tenant: অন্য management thread পড়তে/লিখতে পারে না (403) ✅
  - voice preview = `Voice message` ✅
- `test_agent_parity.mjs` → **ALL AGENT/MANAGEMENT TESTS PASSED** (gmail rule, password change/forgot/reset, 4-char claim code, cancel/expiry refund, chat media/reply/seen/typing)
- `test_calls.mjs` → **ALL CALL TESTS PASSED**
- 46 মেসেজ/মিনিট পাঠানোর পর **কোনো user frozen হয়নি** (db check: `frozen users: []`)

---

## ৫. Build ও Deploy (সব live)

| App | Host | Version |
|---|---|---|
| BoostPay (user) | `boostpay.online` | `v1.2.1792769928` |
| BoostPay Agent | `agent.boostpay.online` | `v1.2.1792769928` |
| BoostPay Management | `management.agent.boostpay.online` | `v1.2.1792769928` |

- Typecheck: user app + agent app + management app — সব clean
- Build: তিনটি app-ই `vite build` success
- Deploy-এর পর bundle check: `Agent Chats` (user bundle), `Voice message` (agent + management bundle) — নতুন build নিশ্চিত
- Health: তিনটি host-ই `{"status":"ok"}`

---

## ৬. এখন কী হবে / আপনার জন্য নোট

1. নতুন limit: **30/মিনিট** পর্যন্ত স্বাভাবিক, 30–90 এর মধ্যে শুধু "slow down" মেসেজ, **90+** হলে তবেই freeze। দরকার হলে management config থেকে `maxMessagesPerMin` বদলাতে পারেন — কিন্তু code কখনো 30-এর নিচে নামবে না।
2. পুরোনো rule-এ কেউ frozen থাকলে server restart-এই auto release হবে — আলাদা করে কিছু করতে হবে না।
3. Chat আর কখনো টাকা লেনদেন ব্লক করবে না; freeze শুধু সত্যিকারের spam/bot-এর জন্য রাখা হয়েছে।
4. Boost চলাকালীনও "Agent Chats" বাটনে চাপ দিয়ে agent-এর সাথে কথা বলা যাবে।

**Commit:** `0157e86` (main-এ push করা হয়েছে, force push নয়)
