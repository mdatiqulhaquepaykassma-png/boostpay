# REPORT 28 — চার অ্যাপে Push Notification (user · agent · management · admin) ✅

**তারিখ:** 2026-10-30 · **কী যোগ হলো:** চারটি অ্যাপেই **অ্যাপ বন্ধ থাকলেও নোটিফিকেশন** (আসল Web Push, আগের support-chat-এ যেটা ছিল সেটাই এখন সব অ্যাপে)

---

## ১. কে, কখন নোটিফিকেশন পাবে

| অ্যাপ | কখন buzz করবে | নোটিফিকেশনের লেখা |
|---|---|---|
| **User** (`boostpay.online`) | স্টাফ/সাপোর্ট উত্তর দিলে · এজেন্ট মেসেজ দিলে · **টাকা এলে** (P2P/agent transfer) · boost yield/reward · deposit · referral কমিশন · security alert · আনঅ্যাড করা দরকারি আপডেট | `BoostPay Support replied` / `New message · Agent #AGT-…` / `BOOSTPAY-ALERTS` + সংক্ষিপ্ত টেক্সট |
| **Agent** (`agent.boostpay.online`) | **ইউজার মেসেজ দিলে** · **management মেসেজ দিলে** | `New message · User #142` / `Management sent you a message` |
| **Management** (`management.agent.boostpay.online`) | **নিজের এজেন্ট মেসেজ দিলে** | `Agent #AGT-… sent a message` |
| **Admin / Support** (`admin.boostpay.binanceusdtpay.io`) | **ইউজার support-কে মেসেজ দিলে** | `New support message · User #142` |
| **Support Chat** (`supportchat.boostpay.online`) | একই (আগেই ছিল) | একই |

নোটিফিকেশনে ছবি/ভয়েস হলে লেখা আসে `📷 Photo` / `🎤 Voice message` (মেসেজের ভেতরের কিছু ফাঁস হয় না)। ট্যাপ করলে অ্যাপ খুলে যাবে, আগে খোলা থাকলে সেই ট্যাবই ফোকাস হবে।

**গোপনীয়তা:** যে নোটিফিকেশনে reset code / OTP / password শব্দ থাকে, তার আসল লেখা লক-স্ক্রিনে **যায় না** — শুধু `Tap to open BoostPay and see the details.` যায় (কোড চুরি ঠেকাতে)।

---

## ২. কীভাবে কাজ করে

```
ফোন: "Turn on" → ব্রাউজার permission → PushManager + VAPID public key
     → subscription (endpoint + keys) → POST /api/push/subscribe → অ্যাকাউন্টের নামে জমা
সার্ভার: ইভেন্ট ঘটলে (চ্যাট / নোটিফিকেশন) → ওই অ্যাকাউন্টের সব ডিভাইসে web-push (aes128gcm, TTL 600)
ফোন বন্ধ থাকলেও ব্রাউজারের push service সার্ভিস-ওয়ার্কারকে জাগায় → নোটিফিকেশন
```

* **অ্যাকাউন্ট ধরে রাখা হয়:** `db.pushSubscriptions = [{ ownerType: USER|AGENT|MANAGEMENT|ADMIN, ownerId, subscription }]` — একটা ফোন যে অ্যাকাউন্টে subscribe করেছে, শুধু সেই অ্যাকাউন্টের ইভেন্টেই বাজবে।
* **আনইনস্টল/পারমিশন বাতিল** হলে ব্রাউজার 404/410 দেয় → সার্ভার নিজেই subscription মুছে দেয় (কোনো জঞ্জাল জমে না)।
* **VAPID key** state document-এ একবার তৈরি হয় (env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` দিয়ে override করা যায়) — তাই redeploy-এ কেউ unsubscribe হয় না।
* push সবসময় fire-and-forget — টাকা/চ্যাটের কোনো কোড পাথে অপেক্ষা করে না, লেটেন্সি বদলায় না।

**নতুন/পরিবর্তিত API:** `GET /api/push/key` · `POST /api/push/subscribe` · `POST /api/push/unsubscribe` · `POST /api/push/test` — চার রোলের টোকেনই কাজ করে, লগইন ছাড়া **401**, অন্যের ডিভাইস মুছতে পারে না।

---

## ৩. যাচাই — **১৮/১৮ PASS** (+ আগের support console ১২/১২)

প্রতিটি রোলের জন্য একটা আসল P-256 subscription বানিয়ে লোকাল HTTPS push-service stand-in-এ পাঠানো হয়েছে, তারপর প্রতিটি ইভেন্ট চালিয়ে **ঠিক কোন ডিভাইস জাগল** তা দেখা হয়েছে:

```
PASS  all four roles can sign in
PASS  admin / user / agent / mgmt subscribes a device   (ownerType সঠিক)
PASS  anonymous cannot subscribe                         (401)
PASS  user -> agent message wakes the AGENT device
PASS  agent -> user message wakes the USER device
PASS  agent -> management message wakes the MANAGEMENT device
PASS  management -> agent message wakes the AGENT device
PASS  user -> support wakes ONLY the ADMIN device
PASS  support reply wakes ONLY the USER device
PASS  money received (P2P transfer) wakes the USER device
PASS  an agent cannot remove a user's device (removed=0), device still registered
PASS  admin / agent / mgmt "Send test" reaches its own device
RESULT 18 pass / 0 fail
```

`tsc --noEmit` চার অ্যাপেই ক্লিন, চারটারই `vite build` সফল। টাকার হিসাব/boost/commission কোড **ছোঁয়া হয়নি** — শুধু ইভেন্টের পরে একটা push কল যোগ হয়েছে।

---

## ৪. ফোনে চালু করার নিয়ম (প্রতিটি অ্যাপে একই)

1. নিজের অ্যাপে লগইন করুন → নিচে ভাসমান কার্ড আসবে: **"Get alerts when the app is closed → Turn on"** → ব্রাউজারে **Allow**।
2. কার্ড সবুজ **"🔔 Notifications are on"** হবে → **Send test** → ফোন **লক** করুন → নোটিফিকেশন আসবে।
3. পরে ছোট 🔔 বাটনে চাপ দিলে আবার test / **Turn off** পাওয়া যাবে। **"Not now"** চাপলে কার্ড আর দেখাবে না।

| অ্যাপ | লিংক |
|---|---|
| User | `https://boostpay.online` |
| Agent | `https://agent.boostpay.online` |
| Management | `https://management.agent.boostpay.online` |
| Admin / Support | `https://admin.boostpay.binanceusdtpay.io` |
| Support Chat | `https://supportchat.boostpay.online` |

### ⚠️ শর্ত
* **Android + Chrome:** সরাসরি কাজ করে।
* **iPhone/iPad:** **iOS 16.4+** এবং অ্যাপটা **Home Screen-এ install করা** থাকতে হবে (Safari ট্যাবে push আসে না)।
* এক অ্যাকাউন্টে একাধিক ডিভাইস subscribe করা যাবে — সবগুলোতে যাবে।
* ব্রাউজারে নোটিফিকেশন **Block** করা থাকলে কার্ডেই লেখা দেখাবে; Settings → Site settings → Notifications → Allow দিয়ে রিলোড করুন।

---

## ৫. কোড

| ফাইল | কী |
|---|---|
| `server.ts` | push engine এখন `USER·AGENT·MANAGEMENT·ADMIN` — `resolvePushOwner` গার্ড, subscribe/unsubscribe/test, `pushNotification()`-এ user push hook, চারটি চ্যাট রুটে (`user/message-agent`, `agent/message-user`, `agent/message-management`, `management/agents/:id/messages`, `chat/send`) রোল-টার্গেটেড push |
| `public/sw.js` (user), `agent-app/public/sw.js`, `management-app/public/sw.js`, `admin-app/public/sw.js` | `push` + `notificationclick` + `pushsubscriptionchange` হ্যান্ডলার (ক্যাশ ভার্সন bump → নতুন worker নেয়) |
| `src/push/pushClient.ts` ×4 | permission → subscribe → server-এ জমা, silent re-register, test, off |
| `src/push/PushOptIn.tsx` ×4 | ভাসমান Turn on / Send test / Turn off কার্ড |
| `admin-app/public/{manifest.json,sw.js,pwa-192x192.png}` + `admin-app/index.html` | **Admin console এখন সত্যিকারের PWA** (আগে manifest/SW ছিল না) |
| `agent-app/src/main.tsx`, `management-app/src/main.tsx`, `admin-app/src/main.tsx` | `/sw.js` রেজিস্ট্রেশন (আগে ছিল না, তাই install + push সম্ভব ছিল না) |

**পরের ধাপে চাইলে যোগ করা যায়:** নতুন এজেন্ট রেজিস্ট্রেশন / উইথড্রয়াল রিকোয়েস্ট এলে অ্যাডমিন-ম্যানেজমেন্টে push · "একাধিক মেসেজ এলে একটা সারসংক্ষেপ (digest)" · নোটিফিকেশন বন্ধ/চালু সুইচ প্রোফাইল মেনুতে।

---

## ৬. ডিপ্লয়ের পরে ধরা পড়া একটা ফাঁদ (ঠিক করা হয়েছে)

প্রথম push-এ **user অ্যাপের sw.js-এ push handler আসেনি** — কারণ user অ্যাপের service worker `vite-plugin-pwa` (generateSW) নিজে তৈরি করে, তাই `public/sw.js` production build-এ ব্যবহারই হয় না (agent/management/admin অ্যাপে সেটা হয়, ওরা সাধারণ Vite build)।

**সমাধান:** push handler আলাদা ফাইল `public/push-sw.js`-এ সরানো হয়েছে এবং `vite.config.ts`-এ `workbox.importScripts: ['push-sw.js']` দেওয়া হয়েছে — ফলে generate হওয়া worker-ও push ইভেন্ট পায়। লাইভ যাচাই: চারটি ডোমেইনেই `/sw.js` (বা user অ্যাপে `/push-sw.js`) push handler সহ সার্ভ হচ্ছে ✅
