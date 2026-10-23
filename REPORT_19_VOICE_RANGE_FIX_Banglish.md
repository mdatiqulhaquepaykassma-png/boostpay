# REPORT 19 — Voice Note দ্বিতীয় ফিক্স + Build যাচাই
**তারিখ:** 2026-10-23 · **Build:** `v1.2.1792773822` · **Commits:** `d351cc6`, `96964ad`

> আগের রিপোর্ট (REPORT 18) এর পরেও যদি একই সমস্যা দেখা যায়, তার কারণ খুঁজে আরও দুটি আসল ফিক্স করা হয়েছে। নিচে সবকিছু।

---

## ০. আগে যাচাই করলাম: আপনার ফোনে কোন build চলছে?

- `agent.boostpay.online` এর নতুন bundle: `/assets/index-c6Nb2SZ1.js` (আগের `index-Dmbi7Zlj.js`) — অর্থাৎ deploy ঠিকঠাক হয়েছে
- index.html-এ cache বন্ধ (`max-age=0`), তাই নতুন করে খুললে নতুন কোডই আসে
- **নতুন সুবিধা:** Agent app → Profile → একদম নিচে এখন **"App build v1.2.…"** লেখা দেখাবে
  - এখানে `v1.2.1792773822` (বা তার বেশি) দেখলে আপনি নতুন build-এ আছেন
  - পুরোনো নম্বর দেখলে: PWA/browser ট্যাব পুরোপুরি বন্ধ করে আবার খুলুন (অথবা app টা uninstall করে আবার install করুন)

---

## ১. Voice note: দ্বিতীয় ও তৃতীয় আসল কারণ

### (ক) সার্ভার HTTP Range সাপোর্ট দিত না → iPhone-এ ভয়েস বাজত না
`/api/chat/file/:id` ফাইলটা শুধু `createReadStream().pipe(res)` দিয়ে পাঠাত — **Range request** সাপোর্ট ছিল না, `Accept-Ranges`/`Content-Range`/`Content-Length` হেডারও ছিল না।

**iOS Safari এর `<audio>` player Range ছাড়া ফাইল বাজায় না** (চুপচাপ আটকে থাকে)। ফলে agent voice পাঠালে server-এ জমা হতো, user-এর চ্যাটে বাবলও আসত, কিন্তু **শব্দ আসত না / player চলত না** → মনে হতো "voice যাচ্ছে না"।

**Fix (এখন live):**
- `Accept-Ranges: bytes`, `Content-Length`, Range এলে **`206 Partial Content` + `Content-Range`**
- অসম্ভব Range-এ `416`, `HEAD` সাপোর্টেড
- টেস্ট: `200` → `206 (bytes 0-99/1400000)` → `416` → `HEAD len=1400000` ✅

### (খ) Android/Chrome এর webm iPhone-এ বাজেই না
Agent যদি Android/Chrome থেকে record করে, ফাইল হয় **WebM/Opus** — iPhone Safari এই ফরম্যাট চালাতে পারে না। তাই "পাঠানো হয়েছে কিন্তু শোনা যাচ্ছে না"।

**Fix:** recorder এখন **আগে `audio/mp4` (AAC)** চেষ্টা করে — এটা iPhone আর Android দুটোতেই চলে। না পারলে webm/ogg-তে নামে। অর্থাৎ নতুন রেকর্ডিংগুলো সব ফোনে বাজবে।
- পুরোনো webm নোটগুলোর জন্য bubble-এ fallback link: *"Player not supported here — open the voice note"* — চাপ দিলে নতুন ট্যাবে খুলে বাজানো/ডাউনলোড করা যাবে

### (গ) আগের ফিক্স (REPORT 18) — এখনো কার্যকর
- `data:audio/webm;codecs=opus;base64,…` — codec parameter সহ data URL এখন গ্রহণ হয় (আগে **সব voice note 400** হতো)
- chat route-এ upload limit **8 MB** (আগে 1 MB → 413), limit ছাড়ালে পরিষ্কার মেসেজ
- record হয় **32 kbps** (২ মিনিট ≈ 480 KB), ছবি pathানোর আগে **1600px JPEG** এ ছোট হয়
- iOS/WebView এ MediaRecorder options reject করলে দুই ধাপে fallback (options → শুধু mime → কোনো option ছাড়া) — তাই "recording শুরুই হয় না" আর হবে না

---

## ২. Agent chat UI (আগের রিপোর্টে যা করা হয়েছে + এই রাউন্ডে যাচাই)

- পূর্ণ **messenger layout**: fixed header (avatar, `User #ID`/Management, typing, voice + video call), scrollable messages, **pinned composer** — কোনো overlap বা double scroll নেই
- Conversation list: **search**, avatar + unread dot, `You:` prefix, media preview (Photo / Voice message), total unread, clean empty state
- Message list-এ **day separator** (Today / 12 Oct 2026) — user/agent/management তিন app-এ একই
- Composer error এখন inline banner + toast দুটোতেই দেখায় (আগে চুপচাপ fail হতো)
- শুধু **User #ID** দেখায় — নাম/ইমেইল নেই

---

## ৩. Agent email verify (আগের রাউন্ডে দেওয়া, এখনো live)

Profile → **Email verification** → "Send code to my Gmail" → ৬ সংখ্যার code (১৫ মিনিট) → Verify → সবুজ **Verified** badge।
API: `POST /api/agent/verify-email`, `POST /api/agent/verify-email/confirm`, `GET /api/agent/verify-email/status`।

---

## ৪. Test (local harness)

`test_chat_media_verify.mjs` → **ALL PASSED** (২৬টি চেক), সহ:
- agent voice `;codecs=opus` → 200, `audio/mp4` → 200
- 1.8 MB voice → 200; 12 MB → 413 + পড়ার মতো মেসেজ
- user সত্যিই agent এর voice + photo পায়
- **Range**: 206 + `Content-Range`, 416, HEAD ✅
- email verify: পুরো flow + expired + anonymous 401

`test_chat_regression.mjs` → **ALL PASSED** (user↔user, management↔agent, stream 401)
Typecheck + build: user, agent, management — তিনটিই clean।

---

## ৫. Deploy

| App | Host | Version |
|---|---|---|
| BoostPay (user) | `boostpay.online` | `v1.2.1792773822` |
| BoostPay Agent | `agent.boostpay.online` | `v1.2.1792773822` |
| BoostPay Management | `management.agent.boostpay.online` | `v1.2.1792773822` |

Live bundle যাচাই: তিন app-এর bundle-এ নতুন voice fallback কোড, agent bundle-এ `App build` ট্যাগ।

---

## ৬. যদি এখনো না হয় — শুধু এই তিনটা জানালেই যথেষ্ট

1. **ফোন/browser:** iPhone (Safari/PWA) নাকি Android (Chrome/PWA)?
2. **কোন ধাপে আটকায়:** মাইক চাপার পর record হয় না? নাকি record হয়ে "Send" চাপার পর error আসে? error এর **হুবহু লেখা** কী?
3. **কোন দিক:** agent → user পাঠাতে গিয়ে, নাকি user → agent, নাকি বাবল আসে কিন্তু বাজে না?

Profile-এর নিচে **App build** নম্বরটাও জানাবেন — সেটা পুরোনো হলে বোঝা যাবে ফোনে cache আটকে আছে।
