# REPORT 27 — Push Notification (অ্যাপ বন্ধ থাকলেও নোটিফিকেশন) ✅ LIVE

**তারিখ:** 2026-10-30 · **অ্যাপ:** `https://supportchat.boostpay.online` · **API:** `v1.2.1793386963`

---

## ১. কী হলো

আগে শুধু SSE ছিল — অ্যাপ বন্ধ/ফোন লক থাকলে কিছুই আসত না। এখন **আসল Web Push**:

> **ইউজার support-কে মেসেজ দিলে → স্টাফের ফোনে নোটিফিকেশন বাজবে, অ্যাপ সম্পূর্ণ বন্ধ থাকলেও।**
> নোটিফিকেশনে লেখা থাকবে: `New support message · User #142` + মেসেজের প্রথম অংশ (বা `📷 Photo` / `🎤 Voice message`)।
> ট্যাপ করলে কনসোল খুলে যাবে (আগে খোলা থাকলে সেটাই ফোকাস হবে)।

সাথে সাথে **উল্টোটাও** তৈরি: স্টাফ উত্তর দিলে ওই ইউজারের ডিভাইসে push যাবে — তবে ইউজার অ্যাপ এখনো subscribe করে না, তাই ইউজারের ফোনে push পেতে চাইলে পরের ধাপে ইউজার অ্যাপেও "Turn on notifications" যোগ করতে হবে (নিচে দেখুন)।

---

## ২. কীভাবে কাজ করে (সংক্ষেপে)

| ধাপ | কোথায় |
|---|---|
| VAPID key pair | প্রথমবার নিজে থেকে তৈরি হয় এবং state document-এ (`db.pushKeys`) থাকে — তাই redeploy-এ subscriber নষ্ট হয় না। চাইলে env দিয়ে override: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` |
| ডিভাইস subscribe | স্টাফ কনসোলে **"Turn on"** চাপলে ব্রাউজার permission চায়, তারপর subscription স্টাফ অ্যাকাউন্টে জমা হয় (`db.pushSubscriptions`, সর্বোচ্চ ৫০০০ ডিভাইস) |
| পাঠানো | `/api/chat/send`-এ ইউজার→support মেসেজ হলে সব subscribed staff ডিভাইসে push (fire-and-forget: চ্যাটের গতি বদলায় না) |
| মৃত ডিভাইস | ব্রাউজার ৪০৪/৪১০ দিলে subscription নিজে থেকেই মুছে যায় (uninstall/permission reset) |
| নিরাপত্তা | `/api/push/key` শুধু পাবলিক key; subscribe/unsubscribe/test সব **লগইন ছাড়া 401**। `pushKeys` (private) কোনো API-তে যায় না — যাচাই করা |

**নতুন endpoint:** `GET /api/push/key` · `POST /api/push/subscribe` · `POST /api/push/unsubscribe` · `POST /api/push/test`

---

## ৩. যাচাই

### (ক) API টেস্ট — **১২/১২ PASS**
স্টাফ লগইন · public VAPID key সার্ভ হচ্ছে · subscribe জমা হয় (owner=ADMIN) · একই endpoint আবার পাঠালে ডুপ্লিকেট হয় না · ভুল subscription → 400 · লগইন ছাড়া → 401 · test push → `devices: 1` · ইউজার→support মেসেজ সংরক্ষিত · `/api/db` (user ও admin) **`pushKeys`/privateKey লিক করে না** · unsubscribe কাজ করে · ডিভাইস না থাকলে test সঠিকভাবে 400

### (খ) পুরো delivery path — আসল P-256 key + লোকাল HTTPS push-service stand-in
```
subscribe: 200 ADMIN
test push: 200 devices 2 | received by push service: 2
  push service saw: {"ttl":"600","enc":"aes128gcm","auth":true,"len":289}   ← web-push ঠিকভাবে encrypt+sign করে POST করেছে
after a user->support message, pushes received: 3                          ← স্বয়ংক্রিয় hook কাজ করছে
support reply pushes to admin devices (should be 0): 0                     ← ভুল ডিভাইসে যায় না
```

### (গ) প্রোডাকশন (কোনো ডেটা না লিখে)
* `/api/push/key` → **200** (বাস্তব public key), `/api/push/subscribe` ও `/api/push/test` লগইন ছাড়া → **401**
* `sw.js`-এ push + notificationclick handler সার্ভ হচ্ছে ✅
* কন্টেইনারে `web-push` ইনস্টল ✓, লগে `[push] generated a new VAPID key pair` ✓, DB-তে `pushKeys` আছে (public key ৮৭ অক্ষর, subscriptions ০)
* ছয়টা হোস্টের health একই: `v1.2.1793386963` · API CPU 0.33 % · support console CPU 0.08 %

---

## ৪. আপনার জন্য (ফোনে চালু করার নিয়ম)

1. ফোনে `https://supportchat.boostpay.online` খুলুন → লগইন।
2. উপরে হলুদ ব্যানার: **"Get alerts when the app is closed" → Turn on** চাপুন → ব্রাউজার permission-এ **Allow**।
3. ব্যানার সবুজ হয়ে **"🔔 Notifications are on"** হবে → **Send test** চাপুন, তারপর ফোন **লক** করুন বা অ্যাপ বন্ধ করুন — নোটিফিকেশন আসবে।
4. এরপর ইউজার অ্যাপ থেকে Support-এ মেসেজ দিলে অ্যাপ বন্ধ থাকলেও বাজবে।
5. বন্ধ করতে চাইলে ওই ব্যানারেই **Turn off**।

### ⚠️ গুরুত্বপূর্ণ শর্ত
* **Android/Chrome:** সরাসরি কাজ করে (সাইট HTTPS)।
* **iPhone/iPad:** **iOS 16.4+** লাগবে এবং অ্যাপটা **Home Screen-এ "Add to Home Screen"** করে ইনস্টল করা থাকতে হবে; Safari ট্যাবে খোলা অবস্থায় push আসে না। (Apple-এর নিয়ম, আমাদের কোডের সীমা নয়।)
* **Do Not Disturb / battery optimization** চালু থাকলে নোটিফিকেশন দেরি হতে পারে — ফোনের সেটিংসে Chrome-কে "Unrestricted" রাখলে সবচেয়ে ভালো।
* একই অ্যাকাউন্টে একাধিক ফোন subscribe করা যাবে (সবগুলোতেই যাবে)।

---

## ৫. পরের ধাপে কী করা যেতে পারে (আপনি বললে)
1. **ইউজার অ্যাপেও push** — "Support replied" নোটিফিকেশন ইউজারের ফোনে (প্রয়োজন: মূল অ্যাপের service worker-এ push handler + ওই অ্যাপে "Turn on" বাটন)। সার্ভারের দিক প্রস্তুত আছে — শুধু ইউজারের ডিভাইস subscribe করতে হবে।
2. **Unread-ভিত্তিক digest** — অনেক মেসেজ এলে একটি সারসংক্ষেপ নোটিফিকেশন।
3. **অ্যাডমিন কনসোলেও** একই push (SUPPORT অ্যাকাউন্ট যেহেতু শেয়ার্ড, এখন supportchat-ই যথেষ্ট)।

---

## ৬. কোড ও ফাইল
* `server.ts`: web-push + VAPID ম্যানেজমেন্ট, `db.pushSubscriptions`, ৪টি endpoint, `/api/chat/send`-এ hook (নতুন কোড ~১২০ লাইন)
* `support-app/public/sw.js`: `push`, `notificationclick`, `pushsubscriptionchange` handler
* `support-app/src/push.ts` (নতুন): permission → subscribe → server-এ জমা, silent re-register, test, off
* `support-app/src/App.tsx`: ইনবক্সে notification ব্যানার (Turn on / Send test / Turn off)
* `package.json` + `bun.lock`: `web-push` (ও `@types/web-push`, dev)
* Commit: **`c6e75e6`** (non-force push → auto-deploy → ছয় হোস্টে live)

**টাকার নিয়ম ছোঁয়া হয়নি** — শুধু নোটিফিকেশন প্লাম্বিং; boost/transfer/commission-এ কোনো পরিবর্তন নেই।
