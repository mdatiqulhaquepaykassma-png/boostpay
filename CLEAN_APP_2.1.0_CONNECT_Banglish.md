# Clean App 2.1.0 + "CONNECTED / DISCONNECTED" স্পষ্ট করা — রিপোর্ট

তারিখ: 2026-11-12 · Live deployment সম্পন্ন

---

## ১. আপনি কী চেয়েছিলেন

1. "মোবাইলটা অ্যাডমিন প্যানেলের সাথে **connected নাকি disconnected** — সেটা clear ভাবে বোঝা যায় না।"
2. "অ্যাপ থেকে **প্রয়োজনীয় জিনিস ছাড়া সব remove** করে একটা real clean app বানিয়ে দিন।"

দুটোই করা হয়েছে এবং **live deploy করা হয়েছে**।

---

## ২. নতুন অ্যাপ: v2.1.0 (code 15)

### প্রথম স্ক্রিনে এখন শুধু এটুকু
| উপরে | বড় কার্ড — **CONNECTED / DISCONNECTED** (সবুজ / লাল), নিচে ছোট লেখায় সার্ভার, শেষ যোগাযোগ কত সেকেন্ড আগে, LIVE না DRY RUN |
| এরপর | **▶ CONNECT** অথবা **■ DISCONNECT** — একটাই বড় বোতাম |
| এরপর | **⛔ STOP** — যখনই দরকার, চলমান কাজ থামানোর জন্য (সবসময় দেখা যাবে) |
| এরপর | **Server connection** কার্ড (সার্ভার URL, টোকেন, Dry-run চেকবক্স, Test বোতাম) |
| এরপর | **1 · Receiver number**, **2 · Amount (BDT)**, **3 · PIN** — কাজ চালানোর জন্য যেটুকু লাগে |

### যেগুলো এখন লুকানো (দরকার হলে খোলা যাবে)
- **⚙ Advanced settings** — ফোনে টাইপ করার গতি, USSD API / Accessibility মোড, adaptive, SIM-ওয়ালেট ম্যাপিং, PIN মুছে ফেলা ইত্যাদি।
- **📄 Log** — ডিবাগ লগ।

দুটোই ডিফল্টে **বন্ধ (GONE)**। মানে সাধারণ অবস্থায় স্ক্রিনে শুধু কানেকশন স্ট্যাটাস + কানেক্ট বোতাম + কাজের ৩টি ইনপুট — আর কিছু না।

### স্ট্যাটাস কার্ড কীভাবে ঠিক হয়
- অ্যাপ প্রতি ~৪ সেকেন্ডে সার্ভারকে ডাকে (`/api/payout/next`) → সার্ভারে `lastSeenAt` + `payoutAppVersion` + `queueDryRun` লেখা হয়।
- সার্ভার ৯০ সেকেন্ডের মধ্যে দেখা দিলে **CONNECTED**, না হলে **DISCONNECTED**।
- Dry-run টিক দেওয়া থাকলে প্যানেল/অ্যাপে **DRY RUN**, না থাকলে **LIVE**।
- কার্ড প্রতি ১ সেকেন্ডে নিজে থেকে রিফ্রেশ হয় — অ্যাপে Tap করার দরকার নেই।

---

## ৩. প্যানেল (Payout Robot ট্যাব)

সবচেয়ে উপরে একটা বড় কার্ড:

```
MOBILE: CONNECTED · LIVE      ← সবুজ
MOBILE: CONNECTED · DRY RUN   ← হলুদ
MOBILE: DISCONNECTED          ← লাল
```

- নিচে প্রতিটি ফোনের জন্য আলাদা লাইন: `01954681757 — [LIVE · 3s]` / `[DRY RUN · 8s]` / `[OFFLINE]`
- প্রতিটি ফোনের পাশে **Connect / Disconnect** বোতাম — প্যানেল থেকেই phone-কে queue-তে ঢোকানো বা বের করা যায়।
- ১ সেকেন্ডে একবার নিজে থেকে আপডেট হয়, তাই "আজ কানেক্টেড কি না" নিয়ে আর ধোঁয়াশা নেই।

---

## ৪. কী কী live হয়েছে (verified)

| জিনিস | ফলাফল |
|---|---|
| API (`management.boostpay.online`) | deploy 200 · `/api/payout/ping` → `{"ok":true,...,"queued":6}` (12:35:01Z) |
| Admin panel | নতুন bundle `index-BuGyPiwY.js` — `MOBILE:`, `CONNECTED · LIVE`, `CONNECTED · DRY RUN`, `DISCONNECTED` সব স্ট্রিং কোডে আছে |
| APK Portal (`app.boostpay.online`) | `ussdpayout` **2.1.0** · 54,163 B · `nagadpayout` **2.1.0** · 54,131 B |
| `check.py` | **100 pass / 0 fail** (৭টি অ্যাপ) |
| Git | `a8df819` → `origin/main` |
| Server test | `npx tsx tools/payout-queue.test.ts` 44/0 (আগের রাউন্ডে) |

---

## ৫. এখন ফোনে যা করতে হবে (৩ ধাপ)

1. অ্যাপ পোর্টাল থেকে নতুন APK নামান ও ইনস্টল করুন:
   - bKash ফোন: `https://app.boostpay.online/apks/boostpay-ussd-payout.apk`
   - Nagad ফোন: `https://app.boostpay.online/apks/boostpay-ussd-nagad.apk`
   - ইনস্টলে **2.1.0** লেখা দেখবেন (পুরোনোটা আনইনস্টল করার দরকার নেই, উপরে বসে যাবে)।
2. **Server connection** কার্ডে সার্ভার URL + ডিভাইস টোকেন একবার বসান (আগেই দেওয়া থাকলে থাকবে)।
3. বড় **▶ CONNECT** বোতাম চাপুন → কার্ড **সবুজ CONNECTED** হবে → প্যানেলেও ১ সেকেন্ডের মধ্যে **MOBILE: CONNECTED · LIVE** দেখাবে।

Tokens কোথায় পাবেন: প্যানেল → Payout Robot → ফোনের লাইন → **Token** (Copy)। টোকেন নতুন করে বানাতে চাইলে পাশের ⟳ বোতাম।

---

## ৬. সত্যি অবস্থা (এখন, এই মুহূর্তে)

- সার্ভারে **৬টি জব QUEUED** পড়ে আছে, একটিও CLAIMED হয়নি।
- ফোন `01954681757` শেষ দেখা গিয়েছিল **2026-11-12 06:15:54 UTC** — অর্থাৎ 2.1.0 ইনস্টল করে ▶ CONNECT না চাপা পর্যন্ত প্যানেল **DISCONNECTED** দেখাবে। এটাই সঠিক আচরণ, কোনো বাগ নয়।
- ▶ CONNECT চাপার পরও যদি লাল থাকে: টোকেন ভুল/পুরোনো, URL ভুল, অথবা ব্যাটারি-অপ্টিমাইজেশন সার্ভিসটা মেরে ফেলছে — অ্যাপের **📄 Log** খুলে শেষ লাইনটা পাঠালেই ধরা যাবে।

---

## ৭. ফাইল/কমিট রেফারেন্স

- `boostpay/ussd-payout/app/src/main/java/com/boostpay/ussdpayout/MainActivity.java` — নতুন এক-স্ক্রিন UI
- `boostpay/ussd-payout/app/src/main/java/com/boostpay/ussdpayout/QueueService.java` — lastContactAt / lastError
- `boostpay/admin-app/src/components/PayoutRobotAdmin.tsx` — MOBILE কার্ড + Connect/Disconnect
- Commit: `20d2ecd` (app + panel), `a8df819` (portal version 2.1.0)

> সংক্ষেপে: অ্যাপ এখন একটা "এক নজরে কানেক্টেড কি না" অ্যাপ — বাকি সব লুকানো। প্যানেলেও একই উত্তর সবুজ/লাল কার্ডে, সাথে দূর থেকে connect/disconnect করার বোতাম।
