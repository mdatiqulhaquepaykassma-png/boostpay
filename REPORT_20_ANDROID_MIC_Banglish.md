# REPORT 20 — Android-এ Mic চাপলে কিছু হয় না — কারণ ও সমাধান
**তারিখ:** 2026-10-23 · **Build:** `v1.2.1792775660` · **Commit:** `dfdbf33`

আপনার উত্তর অনুযায়ী: **Android (Chrome/PWA)**, build ঠিকই নতুন (`v1.2.…3822+`), কিন্তু **mic এ চাপ দিলে record শুরুই হয় না**।
নতুন build-এ এখন এই সমস্যাটা ধরা পড়বে এবং নিজেই সমাধানের পথ দেখাবে। নিচে কী হয়েছে আর আপনাকে কী করতে হবে।

---

## ১. কেন mic চাপলে কিছুই হচ্ছিল (Confirmed কারণগুলো)

### (ক) একবার "Block" হলে Chrome আর কখনো জিজ্ঞেস করে না
PWA/installed app-এ microphone permission একবার block হয়ে গেলে পরবর্তী প্রতিবার `getUserMedia()` সাথে সাথে fail করে — **কোনো popup আসে না**। আগের কোডে সেই error শুধু console-এ যেত, তাই বাটনটা "মরা" মনে হতো।

### (খ) getUserMedia কখনো কখনো ঝুলে থাকে
কিছু Android WebView/কম দামের ফোনে permission promise কখনো resolve করে না — তখন UI-তে কিছুই ঘটে না, শুধু অপেক্ষা।

### (গ) Recorder তৈরি/শুরু হতে না পারলে চুপচাপ ব্যর্থ হতো
`MediaRecorder` options reject করলে বা `rec.start()` throw করলে আগে কোনো message দেখাত না।

---

## ২. এখন কী হয়েছে (নতুন build)

| আগে | এখন |
|---|---|
| mic চাপলে কিছুই হয় না | **"Waiting for the microphone… tap Allow"** বার সাথে সাথে দেখায় |
| block করা mic-এ চুপচাপ fail | লাল বাক্সে পরিষ্কার নির্দেশ: *"Microphone is blocked for this app. In Chrome tap the lock/ⓘ → Permissions → Microphone → Allow, reload…"* + **Try again** বাটন |
| no mic / busy / timeout → কিছুই না | প্রতিটি কারণের আলাদা message (No microphone / Microphone is busy / did not respond / could not start) |
| — | **"Send an audio file"** বাটন: ফোনের gallery/recorder থেকে m4a/mp3/ogg বেছে **voice note হিসেবে** পাঠানো যাবে (owner rule: শুধু voice/photo — তাই এটাও voice) |
| — | ১৫ সেকেন্ডে mic সাড়া না দিলে timeout message (আর অনন্ত অপেক্ষা নেই) |

এছাড়া আগের দুটি ফিক্সও এখানেই আছে: `;codecs=opus` data URL গ্রহণ, ৮ MB limit, Range সাপোর্ট (iPhone-এ playback), এবং record হয় **AAC/mp4** তাই সব ফোনে বাজে।

---

## ৩. আপনার ফোনে এখন কী করবেন (৩০ সেকেন্ডের কাজ)

1. **Chrome এ খুলুন** `agent.boostpay.online` (Facebook/WhatsApp এর ভিতরের browser হলে ওখানে mic কাজ করে না — অবশ্যই Chrome)।
2. উপরে address bar এর পাশে **🔒 / ⓘ আইকন** → **Permissions** → **Microphone** → **Allow** → page **Reload**।
3. App (home screen icon) থেকে ব্যবহার করলে:
   - Chrome → Settings → **Site settings** → **Microphone** → `agent.boostpay.online` খুঁজুন → **Blocked** থেকে সরান
   - অথবা সহজ পথ: app টা **uninstall** করে আবার "Add to Home screen" করুন — permission আবার চাইবে
4. এরপর Chats → যেকোনো user → **🎤** চাপুন → প্রথমবার **Allow** চাইবে → record শুরু হবে (লাল "Recording… 0s" বার)।
5. এখনো না হলে লাল বাক্সে **হুবহু কারণ** লেখা দেখাবে — সেটার স্ক্রিনশট/text পাঠালেই বাকিটা ঠিক করা যাবে। ততক্ষণ **"Send an audio file"** দিয়ে voice পাঠানো যাবে।

---

## ৪. Test / Deploy

- Typecheck + build: user, agent, management — তিনটিই clean
- Local harness: `test_chat_media_verify.mjs` (২৬ চেক: codecs mime, 1.8 MB voice, 413, Range 206/416/HEAD, email verify flow) **ALL PASSED**; `test_chat_regression.mjs` **ALL PASSED**
- Deploy: তিনটি host-ই `v1.2.1792775660`, agent bundle `/assets/index-DVRjcD8f.js`-এ নতুন mic-diagnostic কোড যাচাই করা
- Commit: `dfdbf33` (ff push, force নয়)

| App | Host | Version |
|---|---|---|
| BoostPay (user) | `boostpay.online` | `v1.2.1792775660` |
| BoostPay Agent | `agent.boostpay.online` | `v1.2.1792775660` |
| BoostPay Management | `management.agent.boostpay.online` | `v1.2.1792775660` |

---

## ৫. মনে রাখবেন

- **Agent chat UI:** full-height messenger layout, pinned composer, search + unread dot + media preview, day separator — আগের রিপোর্টে দেওয়া, live আছে।
- **Email verify:** Profile → Email verification → Gmail-এ ৬ সংখ্যার code → Verified badge।
- Profile এর একদম নিচে **"App build v1.2.…"** — এখানে `1792775660` দেখলেই বুঝবেন নতুন কোড চলছে।
