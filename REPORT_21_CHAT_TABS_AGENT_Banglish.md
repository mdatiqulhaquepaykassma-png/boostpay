# REPORT 21 — Agent Chat এখন Chat Tab এর ভিতরে (All · P2P · Agent · Group · Support)
**তারিখ:** 2026-10-23 · **Build:** `v1.2.1792776281` · **Commit:** `a2dde17`

---

## ১. কী চেয়েছিলেন → কী হয়েছে

> "user app e agent chats ta chat er vitor p2p and support er maje ane din, all e all chats show korbe, p2p te personal chats, agent e agent chat, group e groups. chat e agent er chat golo agent hisebe dekhabe"

**হুবহু সেটাই করা হয়েছে:**

| আগে | এখন |
|---|---|
| Wallet-এ আলাদা "Agent Chats" বাটন | **সেটা তুলে দেওয়া হয়েছে** — agent chat এখন Chat tab এর ভিতরে |
| Chat tab-এ ছিল All · P2P · Support · Group | **All · P2P · Agent · Group · Support** (Agent ঠিক p2p আর support এর মাঝে, আপনি যেমন বলেছেন) |
| Agent এর সাথে চ্যাট আলাদা sheet থেকে | Chat list থেকে agent row-তে চাপ দিলেই চ্যাট খোলে |
| Chat tab badge শুধু user↔user unread গুনত | এখন **agent এর unread messages-ও** badge-এ যোগ হয় |

---

## ২. প্রতিটি tab-এ কী দেখাবে

- **All** — সব একসাথে: P2P, Group, Support আর **Agent** — সবশেষ মেসেজের সময় অনুযায়ী (newest first) সাজানো
- **P2P** — শুধু personal (১-১) chat, আগের মতোই
- **Agent** — শুধু agent chat গুলো; tab-এর উপরে unread count badge
- **Group** — শুধু group chat
- **Support** — Official Verified Support

Search box ("Search by User ID...") এখন agent-এর ID আর মেসেজের লেখাও খোঁজে; **Unread** ফিল্টারও agent chat-এ কাজ করে।

---

## ৩. "Agent hisebe dekhabe" — Agent row দেখতে কেমন

প্রতিটি agent chat একটি আলাদা রঙের (sky-blue) row:

- আইকন: **Store** (দোকান) — user avatar এর সাথে মিশে যাবে না
- নাম: **`Agent AGT-1001`** — পাশে ছোট **AGENT** চিপ + verified (✓) ব্যাজ
- প্রিভিউ: `You: …` / `Photo` / `Voice message` / শেষ কথা
- ডানে: সময় + **unread count**
- ভিতরে চ্যাট খুললে header-এও **Agent AGT-1001** (Store আইকন) + voice/video call বাটন — অর্থাৎ কোথাও agent-কে user হিসেবে দেখাবে না

আপনার rule মেনে **agent-এর নাম/ইমেইল দেখানো হয় না** — শুধু Agent ID।

---

## ৪. প্রযুক্তিগত দিক

- `MessengerView` এখন `/api/user/agent-inbox` থেকে agent thread লোড করে (প্রতি ২০ সেকেন্ডে + agent লিখলেই `boostpay:agent-chat` event-এ সাথে সাথে)
- conversation আর agent thread একসাথে merge হয়ে **lastAt** দিয়ে sort হয় — তাই "All"-এ সময়ের ক্রম ঠিক থাকে
- agent row-তে চাপ দিলে আগের **AgentMessageSheet** খোলে (Pay an Agent থেকেও যেটা খোলে) — text/photo/voice/reply/seen/typing সব একই
- `BoostPayStore.fetchUnreadSummary()` এখন agent unread যোগ করে, তাই **Chat tab-এর সবুজ badge** agent reply-তেও জ্বলে
- Wallet-এর "Pay an Agent" বাটনে ছোট একটা hint badge থাকে (কতগুলো agent reply অপেক্ষা করছে), কিন্তু chat এখন Chat tab-এই
- Agent-এর সাথে চ্যাট না থাকলে "Agent" tab-এ পরিষ্কার নির্দেশ: *"No agent chats yet. Open “Pay an Agent” on the wallet, pick an agent and tap Message."*

---

## ৫. যাচাই

- Typecheck (user app) — clean; `vite build` — success
- Build-এ যাচাই: `MessengerView` chunk-এ tab array `["all","p2p","agent","groups","support"]`, `agent-inbox` কল, "No agent chats yet" empty state
- API যাচাই (local harness): `/api/user/agent-inbox` → `{agentId, lastText, lastAt, unread, lastSender}`, agent মেসেজ পাঠালে `unread: 1` হয়
- Deploy: `boostpay.online` → `v1.2.1792776281`, live bundle `/assets/MessengerView-BxG3kg_V.js`-এ নতুন কোড নিশ্চিত
- Commit: `a2dde17` (ff push, force নয়)

---

## ৬. নোট

1. কোনো agent এখনো মেসেজ করেনি এমন user-এর Agent tab খালি থাকবে — Pay an Agent → agent বাছাই → **Message** থেকে চ্যাট শুরু হবে।
2. Agent + Management app এই round-এ বদলায়নি, তাই ওই দুটো redeploy করা হয়নি (আগের build-ই চলছে)।
3. Chat tab-এর badge এখন agent reply-ও গোনে, তাই "কেউ মেসেজ দিয়েছে" বোঝার জন্য আলাদা করে Wallet-এ যেতে হবে না।
