# REPORT 56 — Promotional & Referral Management System (আলাদা অ্যাপ + PWA)

তারিখ: 2026-11-08 · কমিট: `f38a40d` · ব্রাঞ্চ: `main` (force ছাড়া পুশ)

---

## ১. কী বানানো হলো (এক নজরে)

| অংশ | কী | কোথায় |
|---|---|---|
| **নতুন অ্যাপ** | Promotion Console — আলাদা লগইন, আলাদা অ্যাপ, PWA | `promo-app/` → ডোমেইন `promotion.boostpay.online` |
| **Bonus Engine** | একটাই ইঞ্জিন, সব ক্যাম্পেইন এটাই ব্যবহার করে | `server.ts` (promotion engine helpers) |
| **Refer Code মডিউল** | পুরনো refer code + নতুন campaign code — দুটোই একসাথে চলে | আগের কাজ + নতুন `campaignOf()` |
| **Campaign মডিউল** | তৈরি/এডিট/পজ/রিজিউম/ডিলিট, বাজেট, এক্সপায়ারি | `/api/admin/promo/campaigns*` |
| **Bonus Wallet** | ইউজারের বোনাস ব্যালেন্স (boost-only), expiry, লেজার | `/api/user/bonus*` + ইউজার অ্যাপের Refer পেজে কার্ড |
| **Fraud Review** | সন্দেহজনক/ডুপ্লিকেট ক্লেইম → Pending → অ্যাডমিন সিদ্ধান্ত | `/api/admin/promo/reviews*` |

আলাদা ডাটাবেস নেই, আলাদা চাবি নেই — Promotion Console শুধু UI, সব টাকা-পয়সার
হিসাব মূল API-তেই হয় (একটাই লেজার, একটাই সত্য)।

---

## ২. অ্যাডমিন যা যা নিয়ন্ত্রণ করতে পারে (প্রতি কোডে)

- **Referral Code** — নিজের ইচ্ছেমতো (যেমন `BP2026VIP`) অথবা 🎲 **Random code** বাটনে ৮ অক্ষরের কোড
- **Bonus Amount** (per user), **Maximum Uses** (৫০০ জন ইত্যাদি), **Minimum Deposit** ($5)
- **Campaign Status** — Active / Paused / Inactive (যখন খুশি বন্ধ, আবার চালু)
- **Start Date · Expiry Date** — নির্দিষ্ট সময়ে নিজে থেকেই চালু/বন্ধ
- **Bonus Transfer Allowed ON/OFF**, **Bonus Withdrawal Allowed ON/OFF** — **সার্ভারে** এনফোর্সড
- **Bonus Expiry** — 7 / 15 / 30 দিন বা কখনোই না
- **Budget limit** — এই কোডে সর্বোচ্চ কত ডলার বিলি হবে; বাজেট শেষ হলে বিলি বন্ধ
- **Audience** — শুধু নতুন ইউজার / সবাই; **Country restriction** (কোন কোন দেশ)
- **First-deposit reward** — নির্দিষ্ট deposit-এর পরে অতিরিক্ত বোনাস
- **Bonus Revoke** — কারণ লিখে বোনাস ফেরত; লেজার + ব্যালেন্স দুই-ই সমন্বয় হয়

সব পরিবর্তন **audit log**-এ যায় (কে, কখন, কী বদলাল)।

---

## ৩. ইউজারের দিক (ইউজার অ্যাপে)

Refer পেজে নতুন **🎁 Bonus wallet** কার্ড:

- বোনাস ব্যালেন্স, ব্যবহৃত টাকা, পরের expiry তারিখ
- `Transfer allowed / not allowed` ও `Withdraw allowed / not allowed` ব্যাজ
- "⏳ $5 বোনাস $5 ডিপোজিটের জন্য অপেক্ষায়" / "🕒 বোনাস রিভিউতে আছে" নোটিশ
- বোনাস লেজার (credit / used / transfer / revoke)
- নিয়মের লাইন: withdraw না থাকলে স্পষ্ট লেখা — *"এই বোনাস শুধু boost করা যাবে, পাঠানো বা উইথড্র করা যাবে না; এর উপরে যা প্রফিট হবে সেটা যাবে।"*

সাইনআপ ফর্মে কোড লিখলে আগেই দেখায়: **🎁 $2.00 join bonus (boost only) · 12 slots left · expires 7d after join**।

---

## ৪. বিজনেস লজিক (সার্ভার-সাইড, §10)

1. কোড **রেজিস্ট্রেশন শেষ হওয়ার আগেই** যাচাই হয় (`/api/refer/check-code`, `/api/promo/code/:code`)।
2. সাইনআপ শেষে eligibility চেক: paused / expired / not-started / full / budget-done / country-blocked / already-joined।
3. ক্রেডিট **সর্বোচ্চ একবার** — প্রতিটি grant-এর ইউনিক আইডি (`BG-xxxxxxxx`), ইভেন্ট-কি ডুপ্লিকেট হলে দ্বিতীয়বার টাকা ঢোকে না।
4. **Max uses concurrent-safe** — ক্যাপ গোনা ও ক্রেডিট একই লিখন-সাইকেলে (পরপর দুটি সাইনআপ ক্যাপ ভাঙতে পারে না; journey টেস্টে শেষ স্লট পে করে, তারপরের জন `FULL`)।
5. Min-deposit থাকলে বোনাস `WAITING_DEPOSIT`-এ থাকে, প্রথম ডিপোজিট এলে স্বয়ংক্রিয়ভাবে ছাড়া হয় (`releasePendingBonuses`)।
6. ডুপ্লিকেট অ্যাকাউন্ট (একই IP + একই device-id) → টাকা না দিয়ে **Pending**-এ; অ্যাডমিন Approve করলে তখনই ক্রেডিট, Reject করলে কিছুই না।
7. Transfer/Withdraw পারমিশন প্রতি কোডে আলাদা, **API-লেভেলে** 403 দিয়ে আটকানো (UI লুকানো নয়):
   - `POST /api/user/bonus/convert` → withdraw permission না থাকলে `403 This bonus cannot be withdrawn…`
   - `POST /api/user/bonus/send` → transfer permission না থাকলে `403 This bonus cannot be transferred…`
8. BUDGET_DONE হলে নতুন কেউ টাকা পায় না, কিন্তু আগের গ্রান্ট আগের নিয়মেই চলে।

---

## ৫. ড্যাশবোর্ড নম্বর (প্রতি ক্যাম্পেইনে)

`joins · successful · pending · rejected · bonusIssued · remainingSlots · usagePercent ·
firstDeposits · conversionRate · budgetLimit/budgetUsed/budgetLeft · day-wise joins (১৪ দিন)`

আপার লেভেলে: মোট ক্যাম্পেইন, লাইভ ক্যাম্পেইন, মোট জয়েন, মোট বোনাস ইস্যুড, পেন্ডিং রিভিউ।
**Leaderboard** ট্যাব: কোন কোড সবচেয়ে বেশি first deposit এনেছে + conversion rate।
**Grants** ট্যাব: সব গ্রান্ট (কার, কত, কবে), কারণ লিখে revoke।

---

## ৬. অ্যাপ + PWA + ডিপ্লয়

- ভিটে + রিঅ্যাক্ট ১৯, নিজস্ব `server.ts` (স্ট্যাটিক + `/api` প্রক্সি) → একই অরিজিন, কোনো CORS নেই।
- PWA: `manifest.json`, `sw.js` (শুধু shell ক্যাশ করে, **`/api` কখনো ক্যাশ করে না** — টাকার ডেটা সবসময় লাইভ), ১৯২/৫১২ আইকন, মোবাইলে নিচে বটম-নেভ, ডেস্কটপে ট্যাব।
- লগইন টোকেন `localStorage['bp_promo_token']`, প্রতিটি কলে `authorization: Bearer`.
- লোকাল টেস্ট: `PORT=3903 API_PROXY_TARGET=http://127.0.0.1:3901 npm start` → ডেস্কটপ ও মোবাইল স্ক্রিনশট নেওয়া হয়েছে, কোনো পেজ-এরর নেই, service worker রেজিস্টার্ড।

**Dokploy-তে আপনাকে যা করতে হবে** (`promo-app/README.md`-তে বিস্তারিত):
1. New Application → একই রিপো, **Base directory `promo-app`**।
2. ENV: `PORT=3000`, `API_PROXY_TARGET=http://<main-api-service>:3000`।
3. Domain: `promotion.boostpay.online` + Let's Encrypt।
4. Cloudflare: `A promotion` → সার্ভার IP, proxied, Full (strict)। চাইলে এই হোস্টেও Access বসাতে পারেন।

---

## ৭. টেস্ট ফল

| টেস্ট | ফল |
|---|---|
| `tsc --noEmit` (root + promo-app) | ক্লিন |
| `vite build` (root + promo-app) | ক্লিন |
| **user-journey** | **221 pass / 0 fail** (নতুন §18 = ৩২ চেক) |
| regression | 42 / 0 |
| system-check | no problems found |
| UI smoke | OK — কোনো পেজ-এরর নেই |
| Playwright | ডেস্কটপ কনসোল + মোবাইল PWA স্ক্রিনশট (`report-assets/promo-*.png`) |

§18 যা প্রমাণ করে: কোড ছাড়া অ্যাডমিন লিস্ট 401 · ইউজার টোকেনে 401 · নেগেটিভ বোনাস 400 ·
ডুপ্লিকেট কোড 409 · random code · সাইনআপের আগেই কোড প্রিভিউ · জয়েনে পেমেন্ট · wallet + expiry ·
transfer/withdraw 403 দুটোই · এডিটে পারমিশন ফ্লিপ · শেষ স্লট পে → পরের জন FULL · pause→resume ·
budget শেষে BUDGET_DONE · শুরু হয়নি ক্যাম্পেইন NOT_STARTED · ড্যাশবোর্ড নম্বর · লিডারবোর্ড ·
revoke (কারণ ছাড়া 400) · একই IP থেকে দ্বিতীয় অ্যাকাউন্ট Pending → রিভিউ কিউতে → Approve করলে wallet-এ ১ ডলার।

---

## ৮. বাকি / আপনার সিদ্ধান্ত লাগবে

1. **Dokploy অ্যাপ + DNS** — উপরের ৪ ধাপ (আমি ডিএনএস/ডিপ্লয় ছুঁই না, অনুমতি ছাড়া)।
2. চাইলে এই হোস্টে **Cloudflare Access** দেবেন কি না (রেকমেন্ডেড — এটা অ্যাডমিন-অ্যাপ)।
3. বোনাস expiry হলে টাকা **পুড়ে যাবে** নাকি অটো-মেইন ব্যালেন্সে যাবে — এখন পুড়ে যায় (expired গ্রান্ট আর available-এ গোনা হয় না)। আলাদা চাইলে বলবেন।
