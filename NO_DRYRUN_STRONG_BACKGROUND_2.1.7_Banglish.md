# Dry run বাদ + ব্যাকগ্রাউন্ডে অ্যাপ টিকে থাকা · Payout App 2.1.7

তারিখ: ২০২৬-১১-১৩ · Live

---

## ১. Dry run পুরোপুরি বাদ (অ্যাপ থেকে)

| আগে | এখন |
|---|---|
| Server connection কার্ডে **"Dry run only (test jobs)"** চেকবক্স | **নেই** — অ্যাপ সবসময় আসল পেআউট পাঠায় |
| ⚙ Advanced-এ **"Manual DRY RUN (one payout, stop before PIN)"** বোতাম | **নেই** |
| কার্ডে হলুদ **DRY RUN** অবস্থা | সবসময় **LIVE** |
| সেটিংসে `queueDryRun` সেভ থাকতে পারত | ২.১.৭ নিজেই সেটা **false** করে দেয় |

অর্থাৎ প্যানেল থেকে জব এলে ফোন এখন **সরাসরি পিন দিয়ে পাঠায়** — মাঝপথে থেমে "dry run" বলে
থাকার সুযোগ নেই। প্যানেলেও লেখা বদলানো হয়েছে: *"The phone sends it for real — there is no dry run any more."*

> প্যানেলের **TEST payout** আলাদা জিনিস (ইউজার ছাড়া ছোট আসল পেআউট) — সেটা আগের মতোই আছে।

---

## ২. ব্যাকগ্রাউন্ডে অ্যাপ বন্ধ হয়ে যাওয়া — ৬টি স্তরে সমাধান

আপনি ঠিক ধরেছেন: শুধু "Battery → No restriction" দিলেই হয় না। MIUI / ColorOS / Vivo / Samsung
নিজের মতো প্রসেস মারে, আর Doze সব ফোনেই কাজ করে। তাই ২.১.৭-এ:

| # | কী | কীভাবে কাজ করে |
|---|---|---|
| ১ | **Foreground service** (আগেই ছিল) | স্ট্যাটাস বারে স্থায়ী নোটিফিকেশন |
| ২ | **Alarm watchdog (নতুন)** | প্রতি **১৫ মিনিটে** অ্যালার্ম — সার্ভিস মরে গেলে নিজেই আবার চালু হয় (Doze-এও কাজ করে) |
| ৩ | **Boot receiver (নতুন)** | ফোন **রিস্টার্ট**, অ্যাপ **আপডেট**, বা "Quick boot"-এর পরও কিউ নিজে চালু হয় |
| ৪ | **stopWithTask = false (নতুন)** | ফোনের "recent apps" থেকে অ্যাপ **উপরে টেনে বন্ধ করলেও** সার্ভিস মরে না |
| ৫ | **onTaskRemoved + thread watchdog (নতুন)** | অ্যাপ বন্ধ হলে সার্ভিস আবার ওঠে; ভেতরের পোলিং থ্রেড মরে গেলে ৬০ সেকেন্ডে নিজে রিস্টার্ট হয় |
| ৬ | **Autostart helper (নতুন)** | অ্যাপেই দুটো বোতাম — যেগুলো আসলে দরকার |

### অ্যাপে নতুন "Keep running in the background" কার্ড
স্ক্রিনের উপরে সবসময় অবস্থা দেখায়:
```
✓ battery: unrestricted
✓ service: running
```
লাল হলে সাথে সাথে বোঝা যাবে।

- **① Battery: unrestrict this app** — সরাসরি "no battery optimisation" স্ক্রিন।
- **② Autostart / background launch → allow** — ফোনের ব্র্যান্ড অনুযায়ী নিজে থেকেই সঠিক স্ক্রিন খোলে
  (Xiaomi/MIUI, Oppo/Realme, Vivo/iQOO, Huawei/Honor, Samsung, OnePlus, Asus)।
- **③ Test: is it really alive?** — লক করে ৫ মিনিট পর আবার দেখার জন্য।

**সবচেয়ে নিরাপদ (৩০ সেকেন্ডের কাজ):** ① চাপুন → ② চাপুন → তালিকায় BoostPay Payout চালু করুন →
"recent apps" থেকে অ্যাপটা **লক** করে দিন।

---

## ৩. লাইভ ভেরিফিকেশন

| জিনিস | ফল |
|---|---|
| bKash APK | **2.1.7** · code 22 · 64,191 B |
| Nagad APK | **2.1.7** · code 22 · 64,155 B |
| ডাউনলোড টেস্ট | http 200 · 64,155 B · badging `2.1.7` |
| নতুন পারমিশন (APK-তে) | `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` ✔ |
| Manifest | `KeepAliveReceiver` নিবন্ধিত (BOOT_COMPLETED / MY_PACKAGE_REPLACED) · `stopWithTask=false` ✔ |
| অ্যাপ কোডে dry-run | `"Dry run only"`, `"Manual DRY RUN"` — **শূন্য** |
| Admin bundle | `index-BCmWLwqq.js` — "there is no dry run any more" ✔ |
| check.py | 100 / 0 |
| Git | `9623fb9` |

### (পাশের কাজ) APK Portal-এর ডিপ্লয় ঠিক করা
ডিপ্লয় দেখছিলাম পুরোনো 2.1.6 দিচ্ছে — কারণ Dokploy-এর ওই অ্যাপের swarm service হারিয়ে গিয়েছিল
(`no such service`), ফলে নতুন বিল্ড কখনো কন্টেইনারে পৌঁছাচ্ছিল না। এখন পোর্টালটা সরাসরি
bind-mount করা কোড থেকে চলে (`restart unless-stopped`), তাই `git pull` + restart করলেই আপডেট।

---

## ৪. ফোনে করুন

1. ইনস্টল: **Nagad ফোনে** `https://app.boostpay.online/apks/boostpay-ussd-nagad.apk`
   (bKash ফোনে `…/boostpay-ussd-payout.apk`) — **2.1.7**
2. অ্যাপ খুলুন → **Keep running in the background** কার্ড →
   **①** চাপুন (Allow) → **②** চাপুন (তালিকায় চালু করুন)।
3. **▶ CONNECT** → কার্ড সবুজ।
4. এখন লক করুন/অন্য অ্যাপে যান — ১৫ মিনিটের অ্যালার্ম আর boot-receiver মিলে নিজেই টিকে থাকবে;
   কোনো কারণে মরে গেলে অ্যাপ নিজেই আবার উঠবে এবং প্যানেলে আবার `CONNECTED · LIVE` দেখাবে।
