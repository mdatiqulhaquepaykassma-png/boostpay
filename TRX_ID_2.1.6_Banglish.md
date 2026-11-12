# TrxID কালেক্ট + সাকসেস/ফেইলড স্ট্যাটাস + Cancel/OK · অ্যাপ 2.1.6

তারিখ: 2026-11-12 · Live

---

## ১. প্রথম সফল পেআউট — প্রমাণ

আপনার পাঠানো লগে:

```
⇨ ••••   · PIN prompt
⇦ Carrier info · Send Money Tk 21.00 to 01780240277 successful.
   TrxID: 76B13VK1
   Fee & VAT: Tk 5.00
   Balance: Tk 474.00
0. Main Menu · Cancel · Send
queue: job PO-MWDLHI9Q-YC4 → SENT
```

**টাকা গেছে, TrxID = 76B13VK1, ফি ৫ টাকা, ব্যালেন্স ৪৭৪ টাকা।** 2.1.5-এর নতুন "উত্তর পড়ে সিদ্ধান্ত" কাজ করেছে।

---

## ২. এখন যা যোগ হলো (2.1.6, code 21)

### (ক) TrxID কালেক্ট
কনফার্মেশন স্ক্রিন থেকে TrxID পড়া হয় (`TrxID:`, `TxnID`, `Transaction ID` — যেকোনো ফরম্যাট), সাথে Fee & VAT।
- অ্যাপের বড় কার্ডে দেখাবে: **`SENT · TrxID 76B13VK1`**
- প্যানেলে জবের লাইনে `TrxID 76B13VK1`
- সার্ভার জবের `trxId` ফিল্ডে সেভ করে, অডিটে লেখে `PAYOUT_SENT · TrxID …`

### (খ) সফল = সফল **এবং** TrxID
আপনার নিয়ম হুবহু:
| স্ক্রিনে যা দেখা গেল | ফল |
|---|---|
| "successful" + `TrxID: XXXX` | **SENT** (TrxID সহ) |
| "successful" কিন্তু কোনো TrxID নেই | **FAILED** (`NO_TRXID …`) |
| "Invalid PIN / insufficient / failed" | **FAILED** (কারণসহ) |
| কিছুই আসেনি ১৪ সেকেন্ডেও | TrxID থাকলে SENT, না থাকলে **FAILED** |

⚠️ টাকার সুরক্ষা: `NO_TRXID` হলে সার্ভার ইউজারের withdrawal **স্বয়ংক্রিয় রিফান্ড করে না** (টাকা সত্যিই
গিয়ে থাকতে পারে) — সেটা PENDING থাকে, আপনি ব্যালেন্স দেখে সিদ্ধান্ত নেবেন।

### (গ) ডায়ালগ বন্ধ করার নিয়ম (আপনি যেভাবে বলেছেন)
- **সফল হলে → `Cancel`** ক্লিক (সেশন শেষ হয়, "0. Main Menu"-তে ফিরে যায় না)
- **এরর হলে → `OK`** ক্লিক (এরর বক্স বন্ধ)
- কোনটা না পেলে → BACK।

এতে পরের জব আর পুরোনো "Invalid PIN" স্ক্রিন পড়বে না।

### (ঘ) ইউজার TrxID দেখবে
- ইউজারের **Withdraw → Your recent withdrawals** লিস্টে এখন সবুজ mono লেখায় **`TrxID 76B13VK1`**।
- সফল পাঠানোর সাথে সাথে ইউজার নোটিফিকেশন/পুশ পায়: *"Your withdrawal WD-… was sent. TrxID …"*

---

## ৩. টেস্ট (আসল স্ক্রিন টেক্সট দিয়েই)

```
PASS trx '76B13VK1'      ← আপনার সাকসেস স্ক্রিন
PASS trx '8AB12CD34'
PASS trx 'XY12Z9'        (Transaction ID: …)
PASS trx ''              ("Thank you" — কোনো TrxID নেই)
PASS trx ''              (TrxID: —)
fee -> Fee & VAT: Tk 5.00
PASS trxId lands on the job · status SENT · trx 76B13VK1
PASS a failed job keeps no trxId
payout-queue 53 pass / 0 fail · check.py 100 / 0
```

| জিনিস | ফল |
|---|---|
| bKash APK | **2.1.6** · code 21 · 61,163 B |
| Nagad APK | **2.1.6** · code 21 · 61,131 B |
| `/api/apks` | `ussdpayout 2.1.6`, `nagadpayout 2.1.6` |
| API ping | `ok:true · queued:1` |
| Git | `39a3523` |

---

## ৪. এখন করুন

1. **2.1.6 ইনস্টল** — `https://app.boostpay.online/apks/boostpay-ussd-nagad.apk` (Nagad ফোন, যেটা এখন চলছে)
   / bKash ফোনে `…-ussd-payout.apk`
2. ২১ টাকার মতো একটা ছোট LIVE টেস্ট → কার্ডে **`SENT · TrxID …`** দেখা উচিত, আর প্যানেলে জবের পাশে TrxID।
3. কাস্টমার উইথড্র পাঠালে তার Withdraw লিস্টে TrxID দেখাবে।
4. মনে রাখুন: **PAID** হতে তখনও ডেবিট SMS দরকার (SMS রিলে)। TrxID থাকলেও PAID হয় SMS মিললে।

> নোট: আজকের ২১ টাকার জব (PO-MWDLHI9Q-YC4) আগের বিল্ডে রিপোর্ট হয়েছিল, তাই ওই জবের `trxId`
> ফিল্ড খালি — তবে TrxID **76B13VK1** তার লগে সংরক্ষিত আছে। 2.1.6 থেকে প্রতিটি নতুন জবের TrxID
> স্বয়ংক্রিয়ভাবে সেভ হবে।
