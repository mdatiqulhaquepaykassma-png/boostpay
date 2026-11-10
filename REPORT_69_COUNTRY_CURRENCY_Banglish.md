# REPORT 69 — দেশ অনুযায়ী অটোমেটিক কারেন্সি সিলেকশন (Banglish)

তারিখ: 2026-11-10 · স্ট্যাটাস: কোড + টেস্ট + বিল্ড সম্পূর্ণ, ডিপ্লয়ের পথে
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

## ৮. বাকি কাজ (আলাদা অনুমোদন সাপেক্ষ)

1. Android APK রিবিল্ড — নতুন পিকার + `currencySource` টেক্সট দেখাতে।
2. Leaderboard / Referral tree / Inbox+chat / Agent-pay স্ক্রিন এখনো USD ফরম্যাটে (REPORT_68 §6-এর তালিকা)। আপনি বললেই একই `useCurrency()` দিয়ে কনভার্ট করব।
3. Promotion কনসোল এখনো USD-তে।
4. রোলব্যাক পথ: `git revert` এই কমিট; ডেটাবেসে কোনো স্কিমা বদল নেই (শুধু `currencySource`, `currencyCountry`, `currencySetAt`, `db.geoCache`, `db.currencyConfig.autoDetect/geoProvider` — সবই অ্যাডিটিভ ফিল্ড)।
