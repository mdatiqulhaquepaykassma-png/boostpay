# REPORT 62 — Welcome Bonus (প্রমোশন সিস্টেমে নতুন ধরনের ক্যাম্পেইন)

তারিখ: 2026-11-08 · কমিট `b234191` · লাইভ API `v1.2.1794140803` · প্রমোশন কনসোল `index-B_av2BsT.js`

---

## ১. কী নতুন

আগে ক্যাম্পেইন মানেই **কোড** — ইউজার কোড লিখলে বোনাস পেত। এখন দ্বিতীয় ধরন:

| ধরন | কে পাবে |
|---|---|
| **Referral / promo code** (আগের) | যে কোড লিখে সাইনআপ করবে |
| **Welcome bonus** ⭐ নতুন | **প্রতিটা নতুন অ্যাকাউন্ট, কোড ছাড়াই**, একবার |

কোথায় বানাবেন: **`https://promotion.boostpay.online` → New → Campaign type → "Welcome bonus (automatic, every new user)"**।

একসাথে **একটাই** welcome ক্যাম্পেইন থাকতে পারে (দ্বিতীয়টা বানাতে গেলে ৪০৯) — নাহলে প্রতিটা ইউজার ডাবল বোনাস পেত।

## ২. টিক-মার্ক — welcome bonus দিয়ে ইউজার কী কী করতে পারবে

| টিক/ফিল্ড | অন থাকলে | অফ থাকলে |
|---|---|---|
| **Bonus amount ($)** | প্রতিটা নতুন ইউজারের বোনাস | — (আবশ্যক) |
| **Bonus transfer** | বোনাস অন্য ইউজারের bonus wallet-এ পাঠাতে পারবে | `403 This bonus cannot be transferred…` |
| **Bonus withdrawal** | মেইন ব্যালেন্সে নিতে পারবে (তারপর boost/withdraw) | `403 This bonus cannot be withdrawn…` |
| **Bonus validity after join** | 7/15/30/90 দিন বা কখনোই না | — |
| **When the unused bonus expires** | Burn (বাতিল) / Move to main balance | — |
| **Maximum uses / budget / min deposit / countries** | একই নিয়ম প্রযোজ্য | — |
| **If the user also joined with a code** ⭐ নতুন | কোড ক্যাম্পেইনের সাথে **সাথে** welcome-ও পাবে | কোড ক্যাম্পেইন জিতবে, welcome বাদ |

**গুরুত্বপূর্ণ:** এই সব টিক **সার্ভারে** এনফোর্সড — `/api/user/bonus/convert` ও `/api/user/bonus/send` টিক না থাকলে `403` দেয়, UI লুকিয়ে নয়।

## ৩. কোথায় কোথায় দেখা যাবে

- **সাইনআপ স্ক্রিনে (কোড লেখার উপরে):** `🎁 New account welcome bonus $3.00 (withdrawable) · expires 7d after signup` — `/api/promo/welcome` থেকে আসে, welcome ক্যাম্পেইন বন্ধ থাকলে দেখায় না
- **সাইনআপ রেসপন্সে:** নতুন ফিল্ড `welcome: {paid, reason, amount, code}` (আগের `campaign`-এর পাশে)
- **ইউজারের Refer পেজে:** কার্ডের হেডার লেখা হয় **"🎁 Welcome bonus"** (ক্যাম্পেইনের কোড দেখানোর বদলে)
- **নোটিফিকেশন:** `BOOSTPAY-WELCOME — Welcome bonus $3.00 added to your Bonus wallet`
- **প্রমোশন কনসোলের তালিকায়:** বেগুনি **WELCOME** ব্যাজ, কোডের বদলে ক্যাম্পেইনের নাম

## ৪. নিয়ম ও নিরাপত্তা

1. **একবারই** — ক্যাম্পেইন + ইউজার আইডি ইদেম্পোটেন্সি key; রিট্রাই/ডাবল ট্যাপে দ্বিতীয়বার টাকা ঢোকে না (টেস্টে `granted` সবসময় $3)।
2. **মিন ডিপোজিট** দিলে বোনাস `WAITING_DEPOSIT`-এ থাকে, প্রথম ডিপোজিটে ছাড়া হয় (আগের ইঞ্জিন)।
3. **কান্ট্রি রেস্ট্রিকশন / বাজেট / ক্যাপ / pause / expiry** — সব আগের মতোই কাজ করে; welcome ক্যাম্পেইন pause করলে নতুন কাউকে টাকা যায় না।
4. **কোড-নেমস্পেসে সংঘাত নেই** — `WELCOME` কখনো refer code হিসেবে কাজ করে না (`/api/refer/check-code?code=WELCOME` → `resolves: false`)।
5. **Suspicious/duplicate** হলে আগের anti-fraud রিভিউ কিউতেই যায় (একই ইঞ্জিন)।
6. প্রতিটা পেআউট **audit log**-এ।

## ৫. টেস্ট (নতুন §24 — ১৬ চেক)

- welcome ক্যাম্পেইন তৈরি · দ্বিতীয়টা ৪০৯ · তালিকায় ধরনসহ দেখা
- `/api/promo/welcome` সাইনআপের আগেই দেখায়, permission সহ
- **কোড ছাড়া সাইনআপেও বোনাস** · wallet-এ `campaignCode = WELCOME`
- withdraw টিক অন → convert ২০০ · transfer টিক অফ → send ৪০৩
- একই ইউজার দুইবার পায় না (`granted` = $3)
- stack টিক **অফ** → কোড ক্যাম্পেইন পেল, welcome পেল না · **অন** → দুটোই
- welcome pause → কেউ পায় না · `WELCOME` refer code নয় · audit এন্ট্রি

| টেস্ট | ফল |
|---|---|
| user-journey | **302 pass / 0 fail** |
| regression | 42 / 0 |
| system-check | no problems found |
| build (user + admin + promo) | ক্লিন |

## ৬. লাইভ

কমিট `b234191` পুশ (force ছাড়া) → ডিপ্লয়, `/api/health` = `v1.2.1794140803`, `/api/promo/welcome` = `{"welcome":null}` (এখনো কোনো welcome ক্যাম্পেইন বানানো হয়নি — আপনি কনসোল থেকে বানালেই সাইনআপ স্ক্রিনে দেখাবে)।

## ৭. পরে চাইলে যোগ করা যাবে

- Welcome বোনাস **ডিপোজিটের পরেই** (min deposit টিক ইতিমধ্যেই আছে — শুধু ফ্লোটা দেখিয়ে দেবো)
- Welcome বোনাস **শুধুই boost-যোগ্য** (ব্যালেন্সে ঢুকবে না) — এখন বোনাস আলাদা ওয়ালেটে থাকে
- **Referral-এ আসা ইউজারদের জন্য আলাদা** welcome অ্যামাউন্ট (দুই দাম) — বললে যোগ করবো
