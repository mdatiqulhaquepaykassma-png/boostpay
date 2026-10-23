# REPORT 18 — Agent Chat UI · Voice Send · Email Verify
**তারিখ:** 2026-10-23 · **Build:** `v1.2.1792773109` · **Commit:** `04489d8`

---

## ১. Agent chat এর UI fix

আগের layout-এ সমস্যা ছিল:
- chat container ছিল `minHeight: calc(100vh - 190px)`, message list-এ hard-coded `maxHeight: 48vh / 52vh`
- ফলে composer (লেখার/মাইক/ক্যামেরা bar) অনেক সময় screen-এর নিচে চলে যেত, bottom nav এর সাথে overlap হতো, ডাবল scroll হতো

**এখন:**
- App shell পুরোটা `100dvh` (মোবাইল ব্রাউজার bar সহ ঠিকঠাক height), ভিতরে header + main flex
- Chat screen = **আসল messenger layout**: উপরে fixed header, মাঝে scrollable messages (`flex-1 min-h-0`), নিচে **pinned composer** — nav এর জন্য safe-area padding
- Thread header-এ: back button, avatar (U / M), **User #ID / Management**, typing indicator, right side-এ **voice call + video call** বাটন
- Conversation list-এ নতুন:
  - **Search** box (`Search User # or message…`)
  - avatar + **unread dot**, time (just now / 5m ago), media preview (📷 Photo / 🎤 Voice message), "You:" prefix
  - header-এ মোট **unread count**, খালি অবস্থায় পরিষ্কার empty state
- Message list-এ **day separator** (Today / 12 Oct 2026) — তিনটি app-এ (user, agent, management) একই ChatKit
- Composer এর error গুলো এখন inline banner + toast দুটোতেই দেখায় (আগে চুপচাপ fail হতো)

No user name/email — শুধু **User #ID** দেখায় (আপনার rule মেনে)।

---

## ২. "Agent থেকে user-এ voice পাঠানো যাচ্ছে না" — আসল কারণ ও fix (Confirmed)

**Root cause:** ব্রাউজারের voice recorder (Chrome) যে data URL তৈরি করে তার মাঝে codec parameter থাকে:

```
data:audio/webm;codecs=opus;base64,GkXfo59...
```

সার্ভারের পুরোনো regex ছিল `/^data:([^;]+);base64,(.+)$/` — এটা `;base64,` ঠিক প্রথম `;` এর পরেই আশা করে, কিন্তু এখানে `;codecs=opus` মাঝখানে আছে। তাই mime ধরা পড়ত **ফাঁকা** → server উত্তর দিত:

> `400 Only voice notes can be sent.`

অর্থাৎ **প্রতিটি আসল voice note reject হচ্ছিল** — agent→user, user→agent, user↔user, management↔agent সব জায়গায়। টেক্সট আর ছবি ঠিক যাচ্ছিল, শুধু voice fail।

**Fix:** নতুন `parseDataUrl()` — header কে `;` দিয়ে ভেঙে **base type** (`audio/webm`, `audio/mp4`) নেয়, parameters বাদ দেয়। ছবির জন্যও একই parser।

উপরন্তু **দুটি অতিরিক্ত সমস্যা** ঠিক করা হয়েছে:
1. **Upload size:** chat routes-এ global limit ছিল **1 MB** — ১ মিনিটের বেশি voice note (~1.8 MB base64) বা ফোনের ছবি **413** খেত। এখন ৪টি chat route-এ **8 MB** limit, আর limit ছাড়ালে HTML এর বদলে পরিষ্কার JSON error: *"That file is too large to send. Use a shorter voice note or a smaller photo."*
2. **Recording size:** recorder এখন **32 kbps**-এ record করে (কথার জন্য যথেষ্ট) — ২ মিনিটের note ≈ 480 KB, কখনো limit ছাড়াবে না। ছবি পাঠানোর আগে **1600px / JPEG 0.82** এ downscale হয় (~200–400 KB)।

**Playback:** voice bubble-এ `<audio controls>` + duration (s) — iOS এর `audio/mp4` ও Chrome এর `audio/webm` দুটোই চলে।

---

## ৩. Agent নিজের email verify করতে পারবে

**Agent app → Profile → "Email verification"** কার্ড:

1. **"Send code to my Gmail"** → agent এর নিজের Gmail-এ **6-digit code** যায় (১৫ মিনিট valid)
2. Code লিখে **"Verify email"** → verified
3. Verified হলে **সবুজ "Verified" badge**, Profile-এ email এর পাশে ✓ চিহ্ন, আর agent header-এ BadgeCheck রঙিন হয়
4. "Resend" বাটন আছে; ভুল/expired code পরিষ্কার message দেখায়

**নতুন API (agent token লাগে):**

| Method | Route | কাজ |
|---|---|---|
| POST | `/api/agent/verify-email` | নিজের Gmail-এ code পাঠায় (rate-limit 6) |
| POST | `/api/agent/verify-email/confirm` | code মিলিয়ে email verified করে |
| GET | `/api/agent/verify-email/status` | verified? pending code? expiry? |

- Code শুধু **নিজের account**-এ apply হয় (token থেকে id নেওয়া, body থেকে নয়)
- ব্যবহারের পর code মুছে যায়, expired code reject হয়, audit log-এ `AGENT_EMAIL_VERIFIED` লেখা হয়
- `/api/agent/me` ও login response-এ `emailVerified` আছে, তাই app reload করলেও badge থাকে

---

## ৪. Test result (local harness, port 4100)

`test_chat_media_verify.mjs` → **ALL PASSED**
- agent voice `;codecs=opus` → **200** (আগে 400) ✅
- agent voice `audio/mp4` (iOS) → 200 ✅
- user voice `;codecs=opus` → 200 ✅
- parameter সহ photo data URL → 200 ✅
- **1.8 MB voice note → 200** (আগে 413) ✅
- 12 MB upload → **413 + পড়ার মতো message** ✅
- user আসলেই agent এর voice + photo পায় ✅
- email verify: status → send → pending → ভুল code 400 → সঠিক code verified → me-তে `emailVerified: true` → code মুছে যায় → expired code 400 → anonymous 401 ✅

`test_chat_regression.mjs` → **ALL PASSED** (user↔user text/photo/voice, management↔agent text/voice, agent stream 401)

**Build:** user app, agent app, management app — তিনটিই typecheck + `vite build` clean।

---

## ৫. Deploy (সব live)

| App | Host | Version |
|---|---|---|
| BoostPay (user) | `boostpay.online` | `v1.2.1792773109` |
| BoostPay Agent | `agent.boostpay.online` | `v1.2.1792773109` |
| BoostPay Management | `management.agent.boostpay.online` | `v1.2.1792773109` |

Live bundle check: agent bundle-এ `Email verification`, `Send code to my Gmail`, `Search User #` আছে; `/api/agent/verify-email/status` live (token ছাড়া 401)। Commit `04489d8` (force push নয়)।

---

## ৬. আপনার জন্য নোট

1. Agent এখন **voice note, ছবি, reply, seen, typing** — সবই user কে পাঠাতে পারবে; আগে voice server-এ reject হচ্ছিল, এখন যাবে।
2. ছবি স্বয়ংক্রিয়ভাবে ছোট করা হয়, voice ২ মিনিট limit — এর বেশি হলে app বলবে "too long"।
3. Email verify না করলেও agent কাজ করবে; verify করলে Profile-এ Verified badge দেখাবে (ভবিষ্যতে gating চাইলে বলা যাবে)।
4. Management app-এর chat ও একই ChatKit ব্যবহার করে, তাই voice fix ও UI উন্নতি ওখানেও প্রযোজ্য।
