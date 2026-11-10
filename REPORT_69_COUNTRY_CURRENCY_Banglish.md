# REPORT 69 — দেশ অনুযায়ী অটোমেটিক কারেন্সি সিলেকশন (Banglish)

তারিখ: 2026-11-10 · স্ট্যাটাস: **লাইভ** — কমিট `39a6ad6`, বিল্ড `v1.2.1794337299`
আগের রিপোর্ট: `REPORT_68_CURRENCY_SYSTEM_Banglish.md` (গ্লোবাল কারেন্সি সিলেকশন, লাইভ)

---

## ১. আপনি যা চেয়েছিলেন → যা করা হলো

| আপনার কথার অর্থ | অবস্থা |
|---|---|
| প্রথম রেজিস্ট্রেশনে দেশ ডিটেক্ট করে কারেন্সি অটো-সিলেক্ট | ✅ BD→BDT, US→USD, GB→GBP, IN→INR, AE→AED, SA→SAR … (১৮৮ দেশ) |
| ইউজার ও এজেন্ট যেকোনো সময় হাতে বদলাতে পারবে | ✅ আগের মতোই, কোনো লক নেই |
| প্রায়োরিটি: আগের নিজের পছন্দ → দেশ → অ্যাডমিন ডিফল্ট | ✅ এই ক্রমেই কাজ করে |
| VPN-এ ভুল ডিটেক্ট হতে পারে, কিন্তু প্রতি লগইনে কারেন্সি বদলাবে না | ✅ একবার সেট হলে পাকাপাকি; পরে অন্য দেশ থেকে লগইন করলেও বদলায় না |
| প্রথম লগইনে ডিটেক্ট → অটো সিলেক্ট → চাইলে বদল → সেভ | ✅ |
| ওয়ালেট, লেজার, ট্রানজেকশন রেকর্ড সবই USD-তে | ✅ অপরিবর্তিত |

## ২. কীভাবে সিদ্ধান্ত নেয় (ক্রম)

1. একাউন্টে আগেই কোনো `currency` সেভ করা আছে? → সেটাই থাকবে, ডিটেকশন চলে না।
2. নাহলে দেশ বের করে:
   - `CF-IPCountry` হেডার (ক্লাউডফ্লেয়ার আসল আইপি থেকে দেয়) →
   - অ্যাপ পাঠানো `country` ফিল্ড →
   - `db.geoCache[ip]` (৩০ দিনের ক্যাশ) →
   - দরকার হলে `geoProvider` (ডিফল্ট `https://ip-api.com/json/`, ৩ সেকেন্ড টাইমআউট, প্রাইভেট আইপি বাদ)।
3. দেশ → কারেন্সি (`COUNTRY_CURRENCY`, ১৮৮টি আইএসও কোড)।
4. সেই কারেন্সি অ্যাডমিনের `disabled` লিস্টে থাকলে → অ্যাডমিন `default`।
5. দেশই চেনা না গেলে → অ্যাডমিন `default` → সেটাও না থাকলে USD।

## ৩. কোথায় কোথায় হুক বসেছে

- **সাইনআপ** (`POST /api/users/register`): `newUser.country` সেভ + `applyAutoCurrency()`।
- **পুরোনো একাউন্টের লগইন** (`POST /api/users/login`): কারেন্সি খালি থাকলে ঠিক একবার দেশ থেকে সেট, `writeDb()`। কোনো এরর হলে লগইন আটকায় না।
- **এজেন্ট লগইন** (`POST /api/agent/login`): একই নিয়ম, এজেন্টের নিজের `.currency` স্বতন্ত্র।
- **ম্যানুয়াল চেঞ্জ**: `setCurrencyPref()` → `currencySource = 'MANUAL'`, এরপর অটো-ডিটেকশন কখনো ছোঁবে না।
- **অডিট**: `CURRENCY_AUTO_SET` (অটো) ও `CURRENCY_PREF_CHANGED` (ম্যানুয়াল) — দুটোই আলাদা করে লগ হয়।

## ৪. অ্যাডমিন প্যানেল (Currency ট্যাব)

- চেকবক্স: **Auto-select the currency by country** — বন্ধ করলে সবাই ডিফল্ট কারেন্সিতে শুরু করবে।
- ফিল্ড: **Country lookup (IP geo, HTTPS)** — `geoProvider` বদলানো যাবে; ভুল URL দিলে ৪০০।
- শর্ট নোট: CF হেডার আগে, জিও-লুকআপ শুধু হেডার না থাকলে চলে।
- সব পরিবর্তন অডিটেড, আগের মতোই।

## ৫. API-তে যা যোগ হলো

- `publicUser` / `publicAgent`: `currencySource` (`COUNTRY` / `DEFAULT` / `MANUAL` / `USD`) + `currencyCountry`।
- `POST /api/user/currency` ও `POST /api/agent/currency`: রেসপন্সে `currencySource` — অ্যাপ লিখতে পারবে "আপনার দেশ থেকে" বনাম "আপনার পছন্দ"।
- `GET /api/currency/options`: `autoDetect` ফ্ল্যাগ।
- `GET|POST /api/admin/currency/config`: `autoDetect`, `geoProvider`।

## ৬. টেস্ট ফলাফল

| সেট | ফল |
|---|---|
| নতুন journey §31 (১৪ চেক) | **সব PASS** |
| পুরো journey | **389 pass / 0 fail** |
| regression | **42 pass / 0 fail** |
| system-check | No problems found |
| root `tsc` (tsconfig.server.json) | clean |
| ৩টি vite build (user / agent / admin) | clean |

§31-এ যেগুলো আসলে যাচাই হয়েছে:
BD হেডার → BDT (`source=COUNTRY`); US → USD; AE → AED; অজানা দেশ → অ্যাডমিন ডিফল্ট (EUR টেস্টে); হেডার ছাড়া অ্যাপের `country:IN` → INR; হাতে GBP করা যায়; এরপর US হেডার দিয়ে আবার লগইন → **GBP-ই থাকে** (`MANUAL`); পুরোনো একাউন্ট (কারেন্সি কেটে দেওয়া) পরের লগইনে একবার → BDT; `BDT` disabled থাকলে → USD (ডিফল্ট); `autoDetect:false` → সবাই ডিফল্টে; এজেন্ট কারেন্সি স্বতন্ত্র ও ম্যানুয়াল SAR; একাউন্টে `country` সেভ হয়।

## ৭. যা ইচ্ছাকৃতভাবে বদলায়নি

- ওয়ালেট ব্যালেন্স, লেজার, ট্রানজেকশন — সবই USD (বেস)। ডিটেকশন শুধু **দেখানোর** কারেন্সি ঠিক করে।
- অ্যাডমিন প্যানেল USD-তেই থাকে।
- ইউজার অ্যাপে কোনো অ্যাডমিন লিংক নেই, আইডি ছাড়া নাম/ইমেইল নেই — আগের নিয়ম অটুট।

## ৮. লাইভ যাচাই (ডিপ্লয়ের পরে)

| চেক | ফল |
|---|---|
| কনটেইনারে কমিট | `39a6ad6`, `server.ts`-এ `applyAutoCurrency` আছে, `currency-data.ts` উপস্থিত |
| `/api/health` | `v1.2.1794337299` (নতুন বিল্ড) |
| `/api/currency/options` | 200, base USD, default USD, `autoDetect: true`, ১৫০ কারেন্সি, BDT 124.258644 |
| `/api/admin/currency/config` (টোকেন ছাড়া) | 401 |
| Admin কনসোল `admin.boostpay.online` | নতুন বান্ডল `assets/index-BD1RGmxT.js`-এ "Auto-select the currency by country" + `geoProvider` আছে |
| Agent অ্যাপ `agent.boostpay.online` | নতুন বান্ডল সার্ভ হচ্ছে (`assets/index-DbhIL6VT.js`) |
| User অ্যাপ | বান্ডল অপরিবর্তিত (`assets/index-CqS4ZPq4.js`) — এই রিলিজে user-app ফাইল বদলায়নি |

প্রোডাকশনে ইচ্ছাকৃতভাবে কোনো টেস্ট-একাউন্ট তৈরি করা হয়নি — দেশ-ভিত্তিক সিলেকশন লোকাল journey §31-এ পুরোপুরি যাচাই করা হয়েছে (উপরে §৬)।

## ৯. বাকি কাজ (আলাদা অনুমোদন সাপেক্ষ)

1. Android APK রিবিল্ড — নতুন পিকার + `currencySource` টেক্সট দেখাতে।
2. Leaderboard / Referral tree / Inbox+chat / Agent-pay স্ক্রিন এখনো USD ফরম্যাটে (REPORT_68 §6-এর তালিকা)। আপনি বললেই একই `useCurrency()` দিয়ে কনভার্ট করব।
3. Promotion কনসোল এখনো USD-তে।
4. রোলব্যাক পথ: `git revert` এই কমিট; ডেটাবেসে কোনো স্কিমা বদল নেই (শুধু `currencySource`, `currencyCountry`, `currencySetAt`, `db.geoCache`, `db.currencyConfig.autoDetect/geoProvider` — সবই অ্যাডিটিভ ফিল্ড)।

---

## ১০. হটফিক্স — "কারেন্সি সিলেক্ট করলে লগআউট হয়ে সাইনআপ পেজে চলে যাচ্ছে" (2026-11-10)

**আপনার রিপোর্ট:** কারেন্সি বেছে নেওয়া মাত্র লগআউট হয়ে সাইনআপ/লগইন পেজে চলে যাচ্ছে।

**কারণ (Confirmed):** ইউজার অ্যাপের নতুন `src/lib/currency.tsx` টোকেন পড়ছিল `boostpay_token` কী থেকে, কিন্তু অ্যাপ আসলে টোকেন রাখে `boostpay_auth_token_v1`-এ (`services/store.ts` → `STORAGE_AUTH_TOKEN`)। ফলে:

1. `POST /api/user/currency` হেডারে কোনো টোকেন ছাড়াই যাচ্ছিল,
2. সার্ভার `requireUser` → **401** ফিরিয়ে দিচ্ছিল,
3. `App.tsx`-এর গ্লোবাল "যেকোনো 401 = সেশন শেষ" হ্যান্ডলার সাথে সাথে `setCurrentUser(null)` করে টোস্ট দেখিয়ে লগইন স্ক্রিনে পাঠাচ্ছিল।

অর্থাৎ কারেন্সি সেভ হচ্ছিল না, আর ৪০১-এর কারণে ইউজার লগআউট হয়ে যাচ্ছিল। সার্ভার সাইড ঠিকই ছিল — লোকাল journey §30/§31-এ টোকেন দিয়ে POST 200-ই দিচ্ছিল।

**সেইম ধরনের আরেকটি বাগ (একই রিলিজে ধরা পড়েছে):** অ্যাডমিন কনসোলের `CurrencyAdmin.tsx` টোকেন খুঁজছিল `admin_token` / `token`-এ — এই কী দুটো কোথাও লেখা হয় না। ফলে Currency ট্যাবের সব কল ৪০১-এ যাচ্ছিল (লোড/সেভ দুটোই)।

**ফিক্স (Confirmed, লোকাল টেস্টে প্রমাণিত):**

| ফাইল | পরিবর্তন |
|---|---|
| `src/lib/currency.tsx` | টোকেন কী ক্রম: `boostpay_auth_token_v1` → `boostpay_token` → `token` (পুরোনো সেশনও কাজ করবে)। টোকেন না থাকলে POST **একেবারে পাঠানো হয় না** — ৪০১ ঘটা অসম্ভব। |
| `src/components/CurrencyPicker.tsx` | সেভ ব্যর্থ হলে চুপচাপ না থেকে "Could not save. Please try again." দেখায়। |
| `admin-app/src/components/CurrencyAdmin.tsx` | একই কী-ঠিক: `boostpay_auth_token_v1` → `admin_token` → `token`। |
| `agent-app/src/lib-currency.tsx` | চেক করা হয়েছে — `bpa_token_v1`, যা এজেন্ট অ্যাপ আসলেই লেখে। ঠিক আছে, বদলানো হয়নি। |

**নতুন রিগ্রেশন টেস্ট:** `tools/currency-client-check.tsx` (react-dom/server দিয়ে প্রোভাইডার রেন্ডার করে সত্যিকারের হেডার যাচাই):

```
./node_modules/.bin/tsx tools/currency-client-check.tsx
  PASS  choosing a currency posts to /api/user/currency
  PASS  the request carries the real session token
  PASS  the choice is sent as JSON
  PASS  a successful save returns true
  PASS  with no session the call is skipped entirely
  PASS  and the picker is told it failed
  PASS  an older session key still authenticates
RESULT 8 pass / 0 fail
```

পুরোনো কোড ফিরিয়ে দিলে এই টেস্টই **4 fail** দেয় — অর্থাৎ বাগটি ধরা পড়ে (যাচাই করা হয়েছে)।

**সাইড ইফেক্ট নেই:** শুধু টোকেন কী ও এরর মেসেজ বদলেছে; ওয়ালেট, লেজার, রেট, অটো-ডিটেকশন লজিকে হাত দেওয়া হয়নি। journey **389/0**, regression **42/0**, তিনটি বিল্ড ক্লিন।
