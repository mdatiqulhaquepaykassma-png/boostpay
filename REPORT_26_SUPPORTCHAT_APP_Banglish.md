# REPORT 26 — Support Chat app (`supportchat.boostpay.online`) ✅ LIVE

**তারিখ:** 2026-10-30 · **অ্যাপ:** নতুন, আলাদা PWA · **ডোমেইন:** `https://supportchat.boostpay.online` (Let's Encrypt TLS, মেয়াদ ২০২৭-০১-২৮ পর্যন্ত)

---

## ১. কী বানানো হলো

একটা **আলাদা মোবাইল PWA** — শুধু **support স্টাফের** জন্য। এখানে আসে **শুধু সেই মেসেজগুলো যেগুলো ইউজার নিজে support-কে পাঠিয়েছে**।

* ইউজার অ্যাপে আগের মতোই **Chat → Support**-এ মেসেজ দেয় (মূল API-তে `ADMIN_SUPPORT` মেইলবক্স) — সেটাই এখানে সাথে সাথে এসে পড়ে।
* **বন্ধ** থাকে: P2P চ্যাট, agent↔user, management↔agent — এই কনভার্সেশনগুলো কোড-লেভেলেই বাদ (শুধু DM + `…-ADMIN_SUPPORT` + ইউজার নিজে লিখেছে এমন থ্রেড)।
* স্টাফ উত্তর দিতে পারে (Support হিসেবে), unread ব্যাজ, mark-as-read, **ছবি ও ভয়েস নোট** ইনলাইন দেখা/শোনা যায়।

---

## ২. Dokploy-তে যা তৈরি হলো

| বিষয় | মান |
|---|---|
| Application | **BoostPay Support Chat** · `applicationId` `Uogull9bTaIY9127BD6uw` |
| appName / Swarm service | `boostpay-supportchat-memsqg` · **1/1 Up** |
| Project / Env | `boostpay` / `production` (বাকি ৪টা অ্যাপের পাশে) |
| Source | GitHub `mdatiqulhaquepaykassma-png/boostpay` · branch `main` · **auto-deploy on push** |
| Build | **Dockerfile**, buildPath `support-app/Dockerfile` |
| Domain | `supportchat.boostpay.online` → container port 3000, HTTPS Let's Encrypt ✅ |
| Env | `API_PROXY_TARGET=http://boostpay-l2q4ry:3000`, `PORT=3000`, `NODE_ENV=production` |
| PWA | `manifest.json` + `sw.js` + `icon.svg` সার্ভ হচ্ছে, installable (HTTPS) |
| Resource | CPU 0.26 %, RAM ~47 MB |

**নোট (API key):** Dokploy UI-র পুরোনো API key আর কাজ করছিল না (better-auth hash mismatch)। তাই VPS-এ একটা নতুন automation key বানানো হয়েছে (`boostpay-supportchat-setup`) — শুধু কাজ চালানোর জন্য, VPS-এ `/root/.dokploy_api_key_supportchat` (600)। **Dokploy UI → Settings → API Keys থেকে যেকোনো সময় ডিলিট করতে পারেন**, দরকার হলে আবার বানিয়ে নেব।

---

## ৩. কে লগইন করবে (গুরুত্বপূর্ণ)

* লগইন = **admin console-এর অ্যাকাউন্ট** (SUPPORT বা SUPERADMIN role)। আলাদা পাসওয়ার্ড সিস্টেম নেই — যাতে স্টাফ অ্যাকাউন্ট ম্যানেজ করা সহজ থাকে।
* **SUPPORT স্টাফ বানাতে:** Admin console → *Admin accounts* → নতুন অ্যাকাউন্ট, role **SUPPORT**।
  (SUPPORT role-এর অ্যাকাউন্ট admin panel-এ ইউজারের পাসওয়ার্ড দেখতে পায় না — এটা আগের নিয়মই আছে।)
* একই অ্যাকাউন্ট অন্য ডিভাইসে লগইন করলে আগের সেশন বাতিল হয় (single-device cap, বাকি অ্যাপের মতোই)।

---

## ৪. যাচাই — লোকাল end-to-end টেস্ট: **২২/২২ PASS**

| # | টেস্ট | ফল |
|---|---|---|
| 1 | ভুল পাসওয়ার্ড | 401 ✅ |
| 2 | স্টাফ লগইন (console proxy দিয়ে) | 200, role SUPERADMIN ✅ |
| 3-4 | ইউজার → support মেসেজ (২টা) | 200, ইনবক্সে এলো ✅ |
| 5 | **P2P মেসেজ (control case)** | 200, কিন্তু **support ইনবক্সে আসেনি** ✅ |
| 6-7 | ফোনের নম্বর/থ্রেড ফিল্টার | শুধু ১টা support থ্রেড ✅ |
| 8-9 | ইউজারের লেখা টেক্সট অপরিবর্তিত | ✅ |
| 10 | **anonymous** mailbox পড়তে চাইলে | **401** ✅ |
| 11 | **সাধারণ ইউজার টোকেন** দিয়ে mailbox | **403** ✅ |
| 12-13 | স্টাফের উত্তর → ইউজারের অ্যাপে দেখা যায় | ✅ |
| 14 | mark-as-read | ✅ |
| 15-17 | ইউজারের **ছবি** → কনসোলে দেখা যায় + ফাইল লোড | ✅ |
| 18-20 | ইউজারের **ভয়েস নোট** (4.2s) → কনসোলে চালানো যায় | ✅ |
| 21 | থ্রেডে শুধু দুই পক্ষ (ইউজার + Support) | ✅ |
| 22 | **লাইভ SSE push** — ইউজার লিখলে সাথে সাথে ইভেন্ট | ✅ |

**প্রোডাকশনে (কোনো ডেটা না লিখে):** `/` 200 · `/manifest.json` 200 · `/sw.js` 200 · `/icon.svg` 200 · bundle 200 · `/api/chat/messages?userId=ADMIN_SUPPORT` → **401** · `/api/db` → **401** · `/api/admin/accounts` → **401** · TLS Let's Encrypt ✅ · সার্ভিস 1/1 ✅

**`server.ts`-এ কোনো পরিবর্তন লাগেনি** — সব endpoint আগেই ছিল এবং admin-authenticated। তাই মূল ইউজার অ্যাপ, টাকা, boost কিছুই ছোঁয়া হয়নি।

---

## ৫. আপনার জন্য পরের ধাপ

1. **একজন SUPPORT স্টাফ অ্যাকাউন্ট বানান** (Admin console → Admin accounts → role SUPPORT) — না থাকলে §৩ দেখুন।
2. ফোনে Chrome খুলুন → `https://supportchat.boostpay.online` → লগইন → **"Add to Home screen"** (এবার এটা আসল PWA, আইকনসহ ইনস্টল হবে)।
3. ইউজার অ্যাপ থেকে Chat → Support-এ একটা মেসেজ পাঠিয়ে দেখুন — কনসোলে **সাথে সাথে** (query ছাড়াই) এসে পড়বে, ব্যাজ বাড়বে।
4. উত্তর দিন — ইউজারের অ্যাপে চলে যাবে; ছবি/ভয়েসও দেখতে পাবেন।

### সীমা (ইচ্ছাকৃত)
* এই কনসোলে **ইউজারের ব্যালেন্স/টাকা/boost তথ্য নেই** — শুধু চ্যাট। (দরকার হলে পরে যোগ করা যাবে, তখন admin API দিয়ে নামিয়ে আনব।)
* একসাথে অনেক স্টাফ একই ইনবক্স দেখতে পারবেন; "কোন স্টাফ কোন চ্যাট ধরেছে" — এখনো ট্র্যাকিং নেই (চাইলে যোগ করা যায়)।
* পুশ নোটিফিকেশন (অ্যাপ বন্ধ থাকলেও নোটিফিকেশন) এখনো নেই — যোগ করতে চাইলে বলুন।

---

## ৬. ফাইল ও কোড

* `support-app/` (নতুন): `src/App.tsx` (লগইন + ইনবক্স + থ্রেড), `src/api.ts` (API ক্লায়েন্ট), `public/manifest.json`, `public/sw.js`, `public/icon.svg`, `server.ts` (same-origin `/api` proxy), `Dockerfile`, `nixpacks.toml`, `README.md`
* Commit: `e6460e8` (+ `8e3482f` deploy trigger) — non-force push, auto-deploy চালু

---

## ৭. অটো-ডিপ্লয় যাচাই (শেষ)

* push করলে **নতুন অ্যাপটিও নিজে থেকেই ডিপ্লয় হয়** — শেষ push-এ `BoostPay Support Chat` ডিপ্লয় হয়েছে (status `done`)। অর্থাৎ ভবিষ্যতে `support-app/`-এ কিছু বদলে push করলেই লাইভ হবে।
* সব সার্ভিস স্বাস্থ্যকর: `boostpay-supportchat-memsqg 1/1` (বাকি ৫টা সহ), ছয়টা হোস্টের health version একই: **`v1.2.1793385686`**।
* `supportchat.boostpay.online/` → 200, TLS Let's Encrypt ✅
