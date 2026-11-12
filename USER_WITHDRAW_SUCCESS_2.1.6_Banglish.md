# ইউজার কেন সাকসেস পাচ্ছিল না — এবং এখন কী দেখবে

তারিখ: 2026-11-12 · Live

---

## ১. সমস্যাটা ঠিক কোথায় ছিল

জব **PO-MWDMINXT-2XU** · 130.01 BDT → 01780240277 · **TrxID 76B1LM9Y** · status **SENT** — টাকা গেছে।
কিন্তু সার্ভারে:

| জিনিস | আগের অবস্থা |
|---|---|
| ইউজারের withdrawal (WDR-MWDMIDMV-GZA) | **PENDING** — "review বাকি" |
| ট্রানজেকশন হিস্ট্রি | `Withdrawal WDR-… via Nagad (pending review)` — TrxID নেই |
| নোটিফিকেশন | ভুল ফরম্যাটে এক লাইন (`TrxID 76B1LM9Y.Amount 130 BDT`) |

**কারণ:** কোডে withdrawal শুধু **ডেবিট SMS** এলে `COMPLETED` হতো। SMS রিলে এখনো চলছে না
(`sms count = 0`), তাই ফোন TrxID সহ SENT রিপোর্ট করেও ইউজারের কাছে কিছুই "success" হয়নি —
PENDING-ই পড়ে ছিল। এটা ডিজাইনের ভুল ছিল, কারণ **TrxID মানেই ওয়ালেট নিজে টাকা পাঠানোর প্রমাণ**।

---

## ২. যা ঠিক করেছি (কোড — সামনের সব পেআউটে)

**নতুন নিয়ম:** ফোন `SENT` + **TrxID** রিপোর্ট করলেই —
1. ইউজারের withdrawal সঙ্গে সঙ্গে **COMPLETED** (payoutRef = TrxID),
2. ইউজার নোটিফিকেশন/পুশ: **"130 BDT sent via Nagad. Ref: WDR-… · TrxID 76B1LM9Y"**,
3. ইউজারের **ট্রানজেকশন হিস্ট্রি**: `Withdrawal WDR-… via Nagad — sent · TrxID 76B1LM9Y`,
4. ইউজারের **Withdraw লিস্ট**: সবুজ **COMPLETED** ব্যাজ + নিচে **TrxID 76B1LM9Y**।

TrxID ছাড়া "successful" এলে আগের নিয়মেই **FAILED (NO_TRXID)** — আর `NO_TRXID` হলে অটো-রিফান্ড
হয় না (টাকা গিয়ে থাকতে পারে), PENDING থাকে, আপনি ব্যালেন্স দেখে সিদ্ধান্ত নেবেন।

পরে ডেবিট SMS এলে কিছুই ডাবল হয় না (withdrawal আর PENDING থাকে না) — শুধু জবটা PAID হয়ে অডিটে যোগ হয়।

---

## ৩. আপনার এখনকার ১৩০.০১ টাকার ডিপ্লয়মেন্ট — হাতে সারানো হয়েছে

প্রোডাকশন ডেটাবেসে (PostgreSQL `app_state`) শুধু **এই একটি** রেকর্ড ঠিক করা হয়েছে —
আগে সম্পূর্ণ ব্যাকআপ নেওয়া হয়েছে (`/app/data/backup-pre-withdraw-fix-*.json`)।

```
BEFORE {"status":"PENDING","trx":"76B1LM9Y"}
AFTER  {"status":"COMPLETED","ref":"76B1LM9Y"}
ট্রানজেকশন: "Withdrawal WDR-MWDMIDMV-GZA via Nagad — sent · TrxID 76B1LM9Y"  (status COMPLETED)
নোটিফিকেশন: "130 BDT sent via Nagad. Ref: WDR-MWDMIDMV-GZA · TrxID 76B1LM9Y"
```
কোনো ব্যালেন্স/কমিশন/অন্য রেকর্ড বদলানো হয়নি — শুধু status, TrxID আর নোটিফিকেশন।

---

## ৪. ইউজার এখন কী দেখবে (অ্যাপ খুললেই)

- **Withdraw → Your recent withdrawals**: `WDR-MWDMIDMV-GZA` · **COMPLETED** (সবুজ) · নিচে `TrxID 76B1LM9Y`
- **Transaction history**: `Withdrawal WDR-MWDMIDMV-GZA via Nagad — sent · TrxID 76B1LM9Y`
- **Inbox/নোটিফিকেশন**: `Withdrawal sent · 130 BDT sent via Nagad. Ref: … · TrxID 76B1LM9Y`

> অ্যাপ বন্ধ করে আবার খুললেই (বা pull-to-refresh) নতুন ডেটা দেখাবে — পুরোনো APK-তেও, কারণ
> লেখাটা সার্ভার থেকেই আসে। শুধু "TrxID" লাইনটার সবুজ রঙের UI টুকরো নতুন বিল্ডে; তথ্য এখনই দেখা যাবে।

---

## ৫. ভেরিফিকেশন

| জিনিস | ফল |
|---|---|
| API deploy | 200 · ping `ok:true` (14:21 UTC) |
| সার্ভার কোড (কন্টেইনারেই) | `Paid by the USSD robot · job … TrxID` ✔ · `WITHDRAW_PAID` ✔ |
| DB (PostgreSQL) | withdrawal **COMPLETED**, ref **76B1LM9Y**, ট্রানজেকশন নোটে TrxID ✔ |
| ইউজার অ্যাপ (boostpay.online) | bundle-এ `payoutTrxId` আছে (TrxID লাইন) ✔ |
| টেস্ট | payout-queue 53/0 |
| Git | `22ac627` |

---

## ৬. বাকি (একটাই)

**SMS রিলে** এখনো চলছে না। এখন পেআউট TrxID দিয়েই COMPLETED হয়, কিন্তু **ডিপোজিট অটো-ক্রেডিট**
আর জবের চূড়ান্ত "PAID" কনফার্মেশন তখনও SMS-এর উপর নির্ভর করে। ওয়ালেট ফোনে
`https://app.boostpay.online/apks/boostpay-sms-relay.apk` চালু করলে সিস্টেম পুরো বন্ধ হয়ে যাবে।
