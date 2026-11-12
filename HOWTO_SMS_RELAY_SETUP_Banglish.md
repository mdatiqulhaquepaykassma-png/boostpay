# SMS Relay APK — সেটআপ গাইড (Banglish)

**লিংক:** `https://app.boostpay.online/relayapk`
**ফাইল:** `boostpay-sms-relay.apk` · ১৯ KB · প্যাকেজ `com.boostpay.smsrelay`

---

## ০. আগে বুঝে নিন কোন ফোনে বসবে

এই অ্যাপটা **আপনার (ব্যবসার) যে ফোনে bKash/Nagad-এর টাকা আসে** — সেই ফোনে ইনস্টল হবে।
কাস্টমারের ফোনে নয়। অ্যাপটা ওই ফোনের "টাকা এসেছে" SMS পড়ে সার্ভারে পাঠায়, সার্ভার মিলিয়ে দেখে
ইউজার যে TrxID সাবমিট করেছিল তার সাথে মিলছে কি না — মিললে সেই ইউজারের ব্যালেন্সে টাকা যোগ হয়।

একটা ফোন = একটা ডিভাইস = একটা মেথড+নম্বর। দুইটা নম্বর (bKash + Nagad) হলে দুইটা ডিভাইস বানাতে হবে
(একই ফোনে দুইটা অ্যাপ চলবে না — আলাদা ফোন বা পরে আলাদা ডিভাইস)।

**যা লাগবে:**
- ইন্টারনেট (WiFi/মোবাইল ডেটা) সহ চার্জে রাখা একটা Android ফোন (Android 5+)
- ফোনে ওই bKash/Nagad সিম
- Admin console-এ একবার ঢোকার অ্যাক্সেস (`https://admin.boostpay.online`)
- Admin → Payments-এ bKash/Nagad মেথড **enabled** থাকা (নাহলে ডিভাইস বানানোর ড্রপডাউনে দেখাবে না)

---

## ১. ফোনে APK ইনস্টল

1. ফোনের ব্রাউজারে খুলুন: `https://app.boostpay.online/relayapk`
2. **Download BoostPay SMS Relay APK** চাপুন (১৯ KB)
3. ফাইল খুলুন → "Unknown app / Install anyway" এ **Allow** দিন
   (Play Protect "unsafe" বললে **Install anyway** — অ্যাপটা Play Store-এ নেই, আমাদের নিজের সাইটের ফাইল)
4. অ্যাপ খুলে রাখুন, বন্ধ করবেন না।

---

## ২. Admin console-এ ফোন পেয়ার করুন (টোকেন নিন)

1. `https://admin.boostpay.online` → লগইন → **SMS Bridge** ট্যাব
2. **Add a phone** অংশে:
   - **Phone name** — চেনার জন্য, যেমন `bKash 01711-111111 — Dhaka shop`
   - **Payment method** — bKash / Nagad (যেটার টাকা এই ফোনে আসে)
   - **Receiving number** — `01XXXXXXXXX` (যে নম্বরে টাকা আসে)
   - ✅ **Credit automatically** — টিক দিলে অটো ব্যালেন্স যোগ হবে
   - **Tolerance** — `0` রাখুন (হুবহু অ্যামাউন্ট মিলতে হবে)
3. **Create & show token** চাপুন
4. উপরে সবুজ বক্সে **`BPX-…` টোকেন** দেখাবে — **শুধু একবারই দেখায়**।
   **Copy** চেপে নিন (নাহলে পরে "New token" চেপে নতুন বানাতে হবে)।

---

## ৩. ফোনে টোকেন বসান

1. অ্যাপ খুলুন → প্রথমেই **SMS permission** চাইবে → **Allow**
   (না দিলে কিছুই ফরওয়ার্ড হবে না)
2. **Server address** — আগেই লেখা থাকবে `https://boostpay.online` → **বদলাবেন না**
3. **Device token** — `BPX-…` টোকেনটা পেস্ট করুন
4. **Save & start forwarding** চাপুন → "Relay is ON" দেখাবে
5. **Send a test message now** চাপুন → নিচে `test result: …` আসবে।
   এটা শুধু কানেকশন টেস্ট — **কোনো টাকা যোগ হয় না**।
6. **Allow background (battery)** চাপুন → Allow / Unrestricted

---

## ৪. ব্যাটারি ও অটো-স্টার্ট (সবচেয়ে জরুরি ধাপ)

ফোনের সেটিংসে গিয়ে:
- **Battery → App battery usage / Battery saver → Unrestricted** (Xiaomi: "No restrictions")
- **Autostart / Auto-launch** → চালু (Xiaomi, Oppo, Vivo, Realme, Infinix, Tecno — এগুলোতে ডিফল্টে বন্ধ থাকে)
- অ্যাপকে **recent apps থেকে swipe করে kill করবেন না**

না করলে ফোন SMS পেলেও অ্যাপকে জাগাবে না → ডিপোজিট অটো ক্রেডিট হবে না।

---

## ৫. ঠিক আছে কি না যাচাই

অ্যাপের স্ক্রিনে দেখাবে:
```
SMS forwarded: 0   ·   auto-credited deposits: 0
Permission: granted   ·   battery: unrestricted
Last result: saved — waiting for an SMS
Server: https://boostpay.online
```
Admin → SMS Bridge-এ ডিভাইসের নিচে দেখাবে `last seen just now`।
`last seen never` থাকলে = ফোন থেকে সার্ভারে পৌঁছাচ্ছে না (টোকেন/নেট সমস্যা)।

**লাইভ টেস্ট:** নিজের একটা অ্যাকাউন্ট থেকে ছোট একটা ডিপোজিট সাবমিট করুন (মিনিমাম $1 ≈ ৮০০ BDT),
TrxID দিন → ওই নম্বরে আসা আসল bKash/Nagad SMS অ্যাপ পড়ে সার্ভারে পাঠাবে → ১০-২০ সেকেন্ডে
ব্যালেন্স যোগ হবে, আর Admin-এর inbox-এ `CREDITED` দেখাবে।

---

## ৬. কখন টাকা যোগ হয়, কখন হয় না

| অবস্থা | মানে |
| --- | --- |
| **CREDITED** | TrxID + amount মিলেছে → ইউজারের ব্যালেন্সে যোগ হয়েছে (audit: `SMS_AUTO_CREDIT`) |
| **MATCHED** | মিলেছে কিন্তু ডিভাইসের "Require approval" চালু → admin-এর APPROVE-র অপেক্ষা |
| **UNMATCHED** | এই TrxID দিয়ে কেউ ডিপোজিট সাবমিট করেনি → inbox-এ জমা, ক্রেডিট হয়নি |
| **AMOUNT_MISMATCH** | TrxID মিলেছে কিন্তু টাকার পরিমাণ মেলেনি → ক্রেডিট হয়নি |
| **DUPLICATE** | একই TrxID আগেই ক্রেডিট হয়েছে → দ্বিতীয়বার কখনো হবে না |
| **IGNORED** | "টাকা এসেছে" SMS নয় (OTP/বিজ্ঞাপন/ব্যালেন্স চেক) |

অর্থাৎ **SMS না এলে বা TrxID না মিললে কখনো টাকা যোগ হবে না** — এটাই ডিজাইন।

---

## ৭. Admin থেকে নিয়ন্ত্রণ (SMS Bridge ট্যাব)

| বাটন | কাজ |
| --- | --- |
| **Pause / Resume** | ফোন থামানো/চালু — pause করলে ওই ফোন থেকে কিছুই ক্রেডিট হবে না |
| **Require approval / Auto-credit ON** | অটো বদলে ম্যানুয়াল রিভিউ |
| **New token** | নতুন টোকেন — পুরোটা বদলে যায়, ফোনে আবার বসাতে হবে (পুরনো টোকেন মরে যায়) |
| **Delete** | ডিভাইস মুছে ফেলা — ফোন সাথে সাথে কাজ করা বন্ধ করবে |
| **Test the reader** | একটা SMS পেস্ট করে দেখুন parser কী বোঝে (**কিছু ক্রেডিট হয় না**) |

---

## ৮. সমস্যা হলে

| লক্ষণ | সমাধান |
| --- | --- |
| Admin-এ `last seen never` | Token ভুল/পুরনো, বা ফোনে নেট নেই → app-এ **Send a test message** দেখুন |
| `test result:` এ error | Server address-এ https আছে কি দেখুন; ফোনের নেট চেক করুন |
| SMS আসছে কিন্তু forwarded বাড়ছে না | SMS permission বন্ধ হয়ে গেছে, বা অ্যাপ kill হয়েছে (autostart on করুন) |
| forwarded বাড়ছে, credited ০ | ইউজার TrxID ভুল দিয়েছে / অ্যামাউন্ট মেলেনি → inbox-এ UNMATCHED দেখুন |
| টোকেন হারিয়ে ফেলেছি | Admin → ডিভাইসে **New token** → ফোনে নতুন টোকেন বসান |
| অ্যাপ বারবার বন্ধ হচ্ছে | Battery → Unrestricted + Autostart; চার্জে রাখুন |
| ফোন বদলাতে চাই | নতুন ফোনে APK ইনস্টল → **New token** → নতুন টোকেন বসান |

---

## ৯. নিরাপত্তা

- টোকেন **কারো সাথে শেয়ার করবেন না** — টোকেন থাকলে যে কেউ ভুয়া SMS পাঠাতে পারে
  (যদিও টাকা যোগ হবে শুধু তখনই, যখন কোনো ইউজার ঠিক সেই TrxID দিয়ে ডিপোজিট সাবমিট করে আছে)।
- টোকেন হারালে/লিক হলে সাথে সাথে **New token**।
- ফোন হারালে **Delete**।
- বড় টাকা হলে `Credit automatically` বন্ধ রেখে **Require approval** চালান — তখন প্রতিটা
  ম্যাচ admin-এর APPROVE চাইবে।
- অ্যাপ শুধু SMS টেক্সট + sender id পাঠায় — চ্যাট/কন্টাক্ট/ছবি পড়ে না।

---

**সংক্ষেপে ৫ ধাপ:** APK ইনস্টল → Admin-এ ফোন অ্যাড করে `BPX-` টোকেন কপি → অ্যাপে টোকেন পেস্ট + Save →
SMS permission + Battery Unrestricted + Autostart → Admin-এ `last seen just now` দেখলেই চালু।
