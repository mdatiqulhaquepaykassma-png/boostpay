# FIX 2.1.2 — "GET only" এর মানে: ভুল সার্ভার ঠিকানায় জব চাওয়া হচ্ছিল

তারিখ: 2026-11-12 · Live

---

## ১. লগে যা দেখা যাচ্ছিল

```
18:44:09  queue│ queue: GET only
18:44:24  queue│ queue: GET only
...প্রতি ১৫ সেকেন্ডে একই কথা
```

## ২. কারণ (নিশ্চিত)

অ্যাপ যে ঠিকানায় জব চাইছিল সেটা ছিল **`app.boostpay.online` — এটা APK ডাউনলোডের সাইট, পেআউট সার্ভার নয়**।
ওই সাইট শুধু ফাইল দেয়, তাই পোস্ট করা জব-রিকোয়েস্টে সে জবাব দেয়:

```
POST https://app.boostpay.online/api/payout/next  →  http 405  {"error":"GET only"}
```

আসল পেআউট সার্ভার আলাদা। আমি তিনটা হোস্ট নিজে টেস্ট করে দেখেছি:

| ঠিকানা | ফল |
|---|---|
| `https://management.boostpay.online/api/payout/next` | **401** + ঠিক নিয়মের হিন্ট ← এটাই সঠিক সার্ভার |
| `https://boostpay.online/api/payout/next` | 401 (এটাও কাজ করে) |
| `https://app.boostpay.online/api/payout/next` | **405 "GET only"** ← আপনার ফোন এখানে যাচ্ছিল |

*আরও একটা জিনিস নিশ্চিত:* সার্ভারে ফোনের কোনো চিহ্নই নেই — `lastSeenAt` বদলায়নি, `payoutAppVersion` খালি।
মানে টোকেন ভুল নয়; রিকোয়েস্টটাই ভুল দরজায় যাচ্ছিল।

---

## ৩. 2.1.2-তে যা বদলেছে

1. **ভুল ঠিকানা নিজেই ঠিক করে নেয়** — `app.boostpay.online`, `admin.72-60-42-18.sslip.io`
   টাইপ/সেভ থাকলে অ্যাপ নিজেই `https://management.boostpay.online` বসিয়ে দেয়,
   স্ক্রিনে/লগে জানায়: *"app.boostpay.online is not the payout server → using …"*।
2. **বোধগম্য এরর** — আর শুধু "GET only" দেখাবে না; লিখবে
   *"this address is not the payout server (GET only)"* এবং নিচে হিন্ট: সঠিক ঠিকানা।
   404 / 502-504 এর জন্যও আলাদা সহজ ভাষা।
3. **Server connection কার্ডে ছোট নোট** — "Payout server = https://management.boostpay.online
   (app.boostpay.online হলো APK ডাউনলোড সাইট — ওখানে পেআউট হয় না)"।
4. **প্যানেলে Copy বোতাম** — Payout Robot-এ এখন "Server URL for the phone" লাইন + Copy;
   টোকেন ব্লকের ধাপগুলোও নতুন অ্যাপের ভাষায় (Server connection → Test → ▶ CONNECT)।

### যাচাই (আসল কোড, আসল JVM)
```
PASS 'https://app.boostpay.online'   -> 'https://management.boostpay.online'
PASS 'app.boostpay.online'           -> 'https://management.boostpay.online'
PASS 'https://management.boostpay.online' -> অপরিবর্তিত
PASS 'https://boostpay.online'       -> অপরিবর্তিত
explain(405,'GET only') -> this address is not the payout server (GET only)
RESULT 7 pass / 0 fail
```

---

## ৪. Live যা আছে

| জিনিস | মান |
|---|---|
| bKash APK | **2.1.2** · code 17 · 56,467 B |
| Nagad APK | **2.1.2** · code 17 · 56,435 B |
| `/api/apks` | `ussdpayout 2.1.2`, `nagadpayout 2.1.2` |
| ডাউনলোড টেস্ট | http 200 · 56,435 B · badging `2.1.2` |
| Admin bundle | `index-27fSiiRR.js` — "Server URL for the phone" + `management.boostpay.online` আছে |
| `check.py` | 100 / 0 · payout-queue.test 44 / 0 |
| Git | `da27449` |

---

## ৫. ফোনে করুন

1. নতুন APK ইনস্টল: `https://app.boostpay.online/apks/boostpay-ussd-payout.apk`
   (Nagad ফোন: `…-nagad.apk`) — **2.1.2**।
2. অ্যাপ খুলুন → **Server connection** — অ্যাপ নিজেই ঠিকানা ঠিক করে নেবে।
   চাইলে হাতে লিখুন: `https://management.boostpay.online`
3. **Test** চাপুন। আশা করা উত্তর:
   - টোকেন ঠিক → `✓ connected` (কিউ খালি বা জব অপেক্ষা করছে)
   - টোকেন ভুল/পুরোনো → 401 + হিন্ট ("New token" নিন)
4. **▶ CONNECT** → কার্ড সবুজ, প্যানেলে ১ সেকেন্ডে `CONNECTED · LIVE`, তারপর ৬টা QUEUED জব নামবে।

প্যানেল থেকে সার্ভার URL কপি করতে: Payout Robot → **Server URL for the phone → Copy**।

---

## ৬. নোট

- ১৫ সেকেন্ড পরপর রিট্রাই স্বাভাবিক আচরণ (সার্ভার এররে অ্যাপ ১৫ সেকেন্ড অপেক্ষা করে) — সেটা বাগ নয়।
- জবগুলো এখনো সার্ভারে QUEUED আছে; ফোন কানেক্ট হলেই প্রথম জবটি CLAIMED হবে।
