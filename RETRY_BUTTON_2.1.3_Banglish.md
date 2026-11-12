# RETRY + STATUS — Queue-তে রিট্রাই বোতাম (অ্যাপ 2.1.3 · প্যানেল)

তারিখ: 2026-11-12 · Live

---

## ১. যা চেয়েছিলেন

> "Queue তে retry button লাগবে, status দেখাবে, failed হলে retry করার বোতাম লাগবে।"

দুটো জায়গাতেই করা হয়েছে — **অ্যাপে** আর **প্যানেলে** — এবং রিট্রাইটা সার্ভার নিজে যাচাই করে,
তাই **দুইবার টাকা যাওয়ার কোনো সুযোগ নেই**।

---

## ২. অ্যাপে (v2.1.3, code 18)

বড় কার্ডের নিচেই এখন এগুলো:

```
JOB PAY-XXXX · 100 BDT → 01712345678
SENDING            ← চলছে
SENT               ← পাঠানো হয়েছে, SMS-এর অপেক্ষা
DRYRUN             ← মেনু দেখা হয়েছে, টাকা যায়নি
FAILED — menu never appeared      ← লাল, সাথে কারণ

[ ↻ RETRY THIS JOB ]   ← শুধু failed হলে দেখাবে
```

- **স্ট্যাটাস লাইন** সবসময় দেখায়: কোন জব, কত টাকা, কোন নম্বরে, এখন কী অবস্থায়, আর failed হলে **কেন**।
- **↻ RETRY THIS JOB** — চাপলে অ্যাপ প্যানেলকে বলে "এই জবটা আবার কিউতে দাও"। প্যানেল রাজি হলে
  জবটা আবার QUEUED হয়, ফোন পরের পোলে (কয়েক সেকেন্ডে) সেটা তুলে নেয় এবং আবার পাঠায়।
- প্যানেল যদি রিট্রাই **না** মানে (যেমন টাকা ইতিমধ্যেই গেছে), অ্যাপ লাল লেখায় কারণ দেখাবে —
  যেমন *"withdrawal … is REJECTED (already refunded) — retrying would pay it twice"*।
- কানেকশন এরর হলে (যেমন 401/violating token) একই বোতাম **↻ TRY AGAIN** হয়ে দেখাবে।
- নতুন কানেক্ট করলে পুরোনো জবের লাইনটা মুছে যায় (পুরোনো FAILED ঝুলে থাকে না)।

---

## ৩. প্যানেলে (Payout Robot)

1. **Queue হেডারে সারসংক্ষেপ**: `N queued` · `N on a phone` · `N waiting for SMS` · `N paid 24 h` ·
   `N failed 24 h` (failed সংখ্যা > 0 হলে লাল)।
2. **প্রতিটি failed জবের নিচে লাল লাইনে কারণ** দেখা যায় — লগ না খুলেই।
3. **↻ retry বোতাম** প্রতিটি failed জবের পাশে। যে জবটা রিট্রাই করা যাবে না, বোতামটা ধূসর আর
   হোভারে কারণ দেখায় ("already sent — do not send twice", "withdrawal … already refunded …")।

---

## ৪. নিরাপত্তার নিয়ম (সার্ভারে কোডে লেখা)

| অবস্থা | রিট্রাই? |
|---|---|
| `FAILED` (TEST জব) | ✅ আবার কিউতে যাবে |
| `FAILED` (WITHDRAW, ইউজারের withdrawal এখনো PENDING) | ✅ যাবে |
| `FAILED` (WITHDRAW, withdrawal ইতিমধ্যে refunded/REJECTED) | ❌ **নিষেধ** — দুইবার পেমেন্ট হয়ে যেত |
| `SENT` / `PAID` | ❌ নিষেধ — টাকা গেছে, SMS-এর অপেক্ষা করুন |
| `CLAIMED` (ফোন এখন কাজ করছে) | ❌ আগে cancel করুন |
| `CANCELLED` | ❌ ইচ্ছাকৃত বাতিল |

রিট্রাই সফল হলে অডিট লগে লেখা হয়: `PAYOUT_RETRY` (কে করেছে — ফোন না প্যানেল, আর আগের কারণ)।

**নতুন endpoint:**
- `POST /api/payout/:id/retry` — ফোনের টোকেন দিয়ে (ফোন নিজের জবই রিট্রাই করতে পারে)
- `POST /api/admin/payouts/:id/retry` — অ্যাডমিন প্যানেল থেকে (super admin)

---

## ৫. টেস্ট ও লাইভ ভেরিফিকেশন

```
PASS a FAILED job goes back to the queue
PASS the retry forgets the old phone
PASS the retry keeps the attempt count
PASS the retried job can be claimed again
PASS a SENT job is never retried (no double payment)
PASS a CANCELLED job is not retried
PASS a job still being worked on cannot be retried
PASS an unknown job is not retried
53 pass / 0 fail
```

| জিনিস | ফল |
|---|---|
| bKash APK | **2.1.3** · code 18 · 58,083 B |
| Nagad APK | **2.1.3** · code 18 · 58,055 B |
| `/api/apks` | `ussdpayout 2.1.3`, `nagadpayout 2.1.3` |
| `POST /api/payout/…/retry` (টোকেন ছাড়া) | 401 `This phone is not allowed to retry payouts.` ✔ সুরক্ষিত |
| `POST /api/admin/payouts/…/retry` (লগইন ছাড়া) | 401 `Administrator authentication required.` ✔ সুরক্ষিত |
| Admin bundle | `index-C7f8Fbxa.js` — retry + "failed 24 h" আছে |
| `check.py` | 100 / 0 |
| Git | `d7b46ee` |

---

## ৬. ফোনে করুন

1. ইনস্টল: `https://app.boostpay.online/apks/boostpay-ussd-payout.apk` (Nagad ফোন: `…-nagad.apk`) — **2.1.3**।
2. **▶ CONNECT** → সবুজ কার্ড।
3. কোনো জব ফেল করলে কার্ডেই লাল লেখায় **কারণ** + **↻ RETRY THIS JOB** দেখবেন। একটা চাপেই আবার চেষ্টা।
4. চাইলে প্যানেল থেকেও ওই জবের পাশে **↻ retry** চাপতে পারেন — দুই জায়গার ফল একই।
