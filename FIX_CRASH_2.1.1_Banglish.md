# FIX 2.1.1 — অ্যাপ খোলার সাথে সাথেই বন্ধ হচ্ছিল (NullPointerException)

তারিখ: 2026-11-12 · Live (APK Portal এ 2.1.1 আছে)

---

## ১. যে ক্র্যাশটা আপনি পাঠিয়েছেন

```
NullPointerException: Attempt to invoke virtual method
'void android.widget.CheckBox.setOnCheckedChangeListener(...)' on a null object reference
  at MainActivity.buildUi(MainActivity.java:161)
  at MainActivity.onCreate(MainActivity.java:85)
```

**অর্থ:** 2.1.0-এ UI সাজানোর সময় `queueBox` (Dry run চেকবক্স) এখনো তৈরি হয়নি, কিন্তু তার উপরেই
listener বসানো হচ্ছিল। `queueBox` তখন `null` → অ্যাপ খোলার সাথে সাথে বন্ধ।

**কেন হয়েছিল:** ক্লিন UI লেখার সময় "Dry run চেকবক্স বদলালে সার্ভিস রিস্টার্ট হবে" — এই কোডটা
ভুল জায়গায়, কানেক্ট বোতামের পাশে বসিয়ে দিয়েছিলাম; আসল চেকবক্স তৈরি হয় তার **~৩০ লাইন পরে**।

---

## ২. কী ঠিক করেছি

1. **Listener সরানো হয়েছে** — buildUi()-এর ভুল জায়গা থেকে বাদ।
2. **নতুন `wireQueueBox()`** — চেকবক্স তৈরি হওয়া **এবং** `loadSettings()` সেটায় আগের মান বসানোর
   **পরে** listener বসে। তাই চেকবক্স লোড হওয়ার সময় ভুল করে সার্ভিস চালু/বন্ধ হবে না।
3. **নিরাপত্তা জাল (safety net)** — `onCreate`-এ `buildUi()` কে try/catch-এ রাখা হয়েছে। ভবিষ্যতে
   UI-তে কোনো বাগ থাকলেও অ্যাপ আর **কালো স্ক্রিনে বন্ধ হবে না**; বদলে লাল লেখায় কারণ দেখাবে
   ("App could not start" + কোন ফাইল/লাইন) আর **Copy error** বোতাম থাকবে।
4. **পুরো UI কোড চেক করা হয়েছে** — buildUi()-এর প্রতিটি ভিউ (বোতাম, ইনপুট, কার্ড) ব্যবহারের আগে
   তৈরি হচ্ছে কি না, স্ক্রিপ্ট দিয়ে যাচাই → **কোনো use-before-assign নেই**।

---

## ৩. Live যা আছে (verified)

| জিনিস | মান |
|---|---|
| bKash APK | `boostpay-ussd-payout.apk` · **2.1.1** · code **16** · 55,079 B |
| Nagad APK | `boostpay-ussd-nagad.apk` · **2.1.1** · code **16** · 55,063 B |
| `/api/apks` | `ussdpayout 2.1.1`, `nagadpayout 2.1.1` |
| ব্রাউজার থেকে ডাউনলোড টেস্ট | `http 200`, 55,079 B, badging = `versionName='2.1.1' versionCode='16'` |
| `check.py` | 100 pass / 0 fail |
| Gradle | BUILD SUCCESSFUL (দুই ফ্লেভার) |
| Git | `a571176` → `origin/main` |

ডাউনলোড লিংক (একই):
- bKash ফোন: `https://app.boostpay.online/apks/boostpay-ussd-payout.apk`
- Nagad ফোন: `https://app.boostpay.online/apks/boostpay-ussd-nagad.apk`

---

## ৪. ফোনে করণীয়

1. উপরের লিংক থেকে **2.1.1** ইনস্টল করুন (পুরোনোটার উপরেই বসবে; 2.1.0 খুলত না, তাই সরাসরি ইনস্টল হয়ে যাবে)।
2. খুলুন → উপরে বড় কার্ড (এখন **DISCONNECTED** লাল দেখাবে, কারণ ফোন কানেক্ট করা নেই)।
3. **Server connection** কার্ডে URL + টোকেন → **▶ CONNECT** চাপুন।
4. সবুজ **CONNECTED** হলে প্যানেলে ১ সেকেন্ডে `MOBILE: CONNECTED · LIVE` দেখাবে, তারপর ৬টা QUEUED জব আসতে শুরু করবে।

যদি আবারও কোনো সমস্যা হয়: অ্যাপ আর বন্ধ হবে না — স্ক্রিনে লাল লেখায় কারণ দেখাবে, **Copy error** চেপে
আমাকে পাঠিয়ে দিলেই হবে।

---

## ৫. নোট

- ক্র্যাশটা ছিল **শুধু অ্যাপের UI**-তে; সার্ভার, প্যানেল, কিউ — কিছুই ক্ষতিগ্রস্ত হয়নি (jobs এখনো ৬টি QUEUED)।
- 2.1.0 আমি সরাসরি টেস্ট করতে পারিনি (এই স্যান্ডবক্সে এমুলেটর/ব্রাউজার নেই) — এটাই সীমাবদ্ধতা ছিল।
  তাই 2.1.1-এ "ক্র্যাশ করলে কারণ দেখাও" জালটা যোগ করা হয়েছে, যাতে পরের বার অনুমান করতে না হয়।
