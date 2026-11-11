# REPORT 71 — Job 14: দেশভিত্তিক পেমেন্ট মেথড + আলাদা Wallet Agent প্যানেল

তারিখ: 2026-11-11 · লোকাল টেস্ট সার্ভার `:3901` / `admin :3911` / `walletagent :3921`

---

## ১. আপনার চাওয়া (হুবহু)

1. "jei country er currency select korbe sei country er local payment methods deposit and withdraw te show korbe."
2. "deposit and withdraw manage korar jonno alada panel lagbe, alada login lagbe, admin panel theke login account create kore dibe — walletagent.boostpay.online"
3. "Dokploy te alada application korte hobe"
4. "walletagent only 1 ta desh er 1 ta payment method niye kaj korbe, admin account create kore dawar somoy select kore debe."

---

## ২. যে ফাঁকটা ছিল (Confirmed — কোড পড়ে প্রমাণিত)

| # | সমস্যা | প্রমাণ |
|---|---|---|
| 1 | ইউজার কারেন্সি পিকার থেকে BDT বেছে নিলেও `owner.country` কখনো সেট হতো না | `setCurrencyPref()` শুধু `currency` + `currencySource='MANUAL'` লিখত |
| 2 | ফলে `countryAllowed()`-এর কাছে দেশ খালি → দেশভিত্তিক মেথড কখনো দেখাত না | `/api/payment/methods`-এ `user.country` (শুধু signup geo) পাঠানো হতো |
| 3 | ডিফল্ট ১৩টা বাংলাদেশি মেথড (bKash/Nagad/…) `countries: []` = "সব দেশে" | আমেরিকার ইউজারও bKash দেখত |
| 4 | মেথড এডিটরে দেশ ছিল ফ্রি-টেক্সট কমা লিস্ট | PaymentAdmin.tsx:~381 |
| 5 | deposit/withdraw রিভিউ লজিক admin রুটের ভেতরে লেখা, নতুন প্যানেল রিইউজ করতে পারত না | `/api/admin/payment-requests/*/review` |

---

## ৩. যা বানানো হলো

### ৩.১ দেশ → মেথড (ইউজার অ্যাপ)

- `currency-data.ts`: নতুন `countriesForCurrency()` + `primaryCountryForCurrency()`।
- `server.ts` → নতুন `effectiveCountryOf()`: ক্রম — অ্যাকাউন্টের `country` → `currencyCountry` → (শুধু MANUAL হলে) কারেন্সির দেশ। VPN/ট্রাভেল কখনো বদলাবে না, কারণ **সেভ করা পছন্দই** আগে।
  - **সতর্কতা:** যাদের কোনোদিন পিকার ব্যবহার করেনি (legacy USD ডিফল্ট) তাদের দেশ `''` = "কোনো restriction নেই" — আগের মতোই সব মেথড, রিগ্রেশন নেই।
- `setCurrencyPref()` এখন `owner.currencyCountry` সেট করে (BDT → `BD`)।
- `/api/payment/methods` এখন `effectiveCountryOf()` দিয়ে ফিল্টার করে এবং রেসপন্সে `country`, `countryLabel`, `countryFlag`, `otherCountries` দেয় — খালি স্ক্রিন হলে অ্যাপ বলতে পারে "অন্য দেশে মেথড আছে"।
- deposit/withdraw রিকোয়েস্ট রুট দুটোও একই ফাংশন ব্যবহার করে → **স্ক্রিন আর সার্ভার একই নিয়ম**।
- ডিফল্ট ক্যাটালগে ১৩টি BD মেথডে `countries: ['BD']`; পুরনো ডাটাবেসের জন্য one-time `migrateDefaultCountries()` (ফ্ল্যাগ `db.countriesMigratedAt`, অ্যাডমিন পরে হাতে বদলালে সেটা আর ছোঁবে না)।

**ইউজার অ্যাপ (PaymentsPage.tsx):**
- হেডারে `🇧🇩 Bangladesh · BDT` চিপ → ট্যাপে "Country & currency" শিট (সব কারেন্সি, দেশের নাম সহ) → বেছে নিলেই `setCurrency()` → মেথড লিস্ট নতুন দেশে রিলোড।
- মেথড না থাকলে সৎ খালি-স্টেট: "No deposit method is available for Bangladesh yet" + Change বাটন।
- কার্ডের রেঞ্জ আরও ভাঙছিল (`৳124.610683 – …`) — এখন রাউন্ডেড (`৳125 – ৳12,461,068`)।

### ৩.২ রিভিউ লজিক এক জায়গায়

`reviewDepositCore()` / `reviewWithdrawCore()` — ক্রেডিট/রিফান্ড/নোটিফিকেশন/অডিট সব একটাই ইমপ্লিমেন্টেশন; অ্যাডমিন কনসোল আর ওয়ালেট এজেন্ট দুজনেই এটা কল করে, পার্থক্য শুধু `reviewedBy` (actor)। লক আগের মতোই `withPaymentLock('DEPREVIEW:'/`WDRREVIEW:')`।

### ৩.৩ Wallet Agent প্যানেল (নতুন অ্যাপ)

- নতুন ফোল্ডার **`walletagent-app/`** (promo-app-এর প্যাটার্ন): `server.ts` (API প্রক্সি + `/app` ইনস্টল এন্ট্রি), Vite+React UI, `public/manifest.json`, `sw.js`, `app-install.js`, আইকন, `make-app-files.mjs`.
- লগইন: `POST /api/walletagent/login` → রোল **`WALLET_AGENT`** (আলাদা টোকেন, আলাদা সেশন; ১ ডিভাইস নিয়ম একই)। অ্যাডমিন টোকেন বা ইউজার টোকেন দিয়ে এই প্যানেলের কোনো API কল হয় না (টেস্টে প্রমাণিত)।
- স্ক্রিন: **Queue** (pending deposit/withdraw, ১৫ সেকেন্ডে নিজে রিফ্রেশ, ডিপোজিটে ইউজারের রেফারেন্স + আপনার pay-to নম্বর পাশাপাশি, উইথড্রতে গন্তব্য), **History**, **Account** (binding + লিমিট + pay-to)।
- সার্ভার-সাইড স্কোপ: `row.methodId !== agent.methodId` হলে **403** + অডিট `WALLET_AGENT_SCOPE_DENIED`। কোয়েরিতেই শুধু নিজের মেথডের রো আসে।

### ৩.৪ অ্যাডমিন সাইড (অ্যাকাউন্ট তৈরি)

- নতুন ট্যাব **Wallet Agents** (`admin-app/src/components/WalletAgentAdmin.tsx`): নাম, ইমেইল, পাসওয়ার্ড, **দেশ → সেই দেশের মেথড** (দেশ না মিললে সার্ভার ৪০০ দেয়), তৈরি; তারপর সারি খুলে Disable/Enable, পাসওয়ার্ড রিসেট, Delete, দেশ/মেথড সরানো।
- Disable/পাসওয়ার্ড বদল/Delete → ওই এজেন্টের **সব লাইভ সেশন সাথে সাথে মরে** (টেস্টে প্রমাণিত)।
- মেথড এডিটরে ফ্রি-টেক্সট দেশের জায়গায় **দেশ-চিপ পিকার** (`+ Add a country…`, × দিয়ে বাদ, `All` = সব দেশ)। নতুন `GET /api/admin/countries`।
- API: `GET/POST /api/admin/wallet-agents`, `PATCH/DELETE /api/admin/wallet-agents/:id`, `GET /api/admin/wallet-agents/options` (দেশ→মেথড ট্রি)।

### ৩.৫ বোনাস বাগ ফিক্স (গুরুত্বপূর্ণ)

অ্যাডমিন কম্পোনেন্টগুলো `{ ...BoostPayStore.adminAuthHeaders(), 'content-type': 'application/json' }` লিখত। স্টোর ইতিমধ্যেই `Content-Type` দেয় → **হেডার দুবার** যেত → প্রক্সি পাঠাত `application/json, application/json` → express বডি পার্স করত না → **সব admin POST ফাঁকা বডি নিয়ে যেত** (Wallet Agent তৈরি হচ্ছিল না, একইভাবে মেথড সেভও ভাঙত)। ঠিক করা হয়েছে:

- `WalletAgentAdmin.tsx`, `CurrencyAdmin.tsx`, `PaymentAdmin.tsx` — ডুপ্লিকেট হেডার বাদ,
- ৭টি কনসোলের `server.ts` প্রক্সিতে `content-type` নরমালাইজ (প্রথম ভ্যালু) — ভবিষ্যতের জন্য।

---

## ৪. টেস্ট ফলাফল

| টেস্ট | ফল |
|---|---|
| `tools/walletagent-check.py` (নতুন, API) | **40 pass / 0 fail** |
| `tools/walletagent-ui-check.py` (নতুন, প্যানেল ব্রাউজার) | **21 pass / 0 fail** |
| `tools/walletagent-admin-ui-check.py` (নতুন, অ্যাডমিন→এজেন্ট→প্যানেল) | **12 pass / 0 fail** |
| `tools/payment-country-ui-check.py` (নতুন, ইউজার অ্যাপ) | **11 pass / 0 fail** |
| `tools/payments-check.py` | 40 / 0 |
| `tools/payments-ui-check.py` | 18 / 0 |
| `tools/admin-payments-ui-check.py` | 9 / 0 |
| `tools/currency-client-check.tsx` | 23 / 0 |
| `tools/regression.cjs` | 52 / 0 |
| `tools/user-journey.py` | 409 / 0 |
| `tools/system-check.py` | কোনো সমস্যা নেই |

মূল প্রমাণগুলো:
- BDT ইউজার deposit **এবং** withdraw দুই জায়গায় bKash দেখে; USD ইউজার দেখে না; প্যানেল থেকে দেশ বদলালে লিস্ট সাথে সাথে বদলায়।
- bKash এজেন্ট Nagad-এর ডিপোজিট approve করতে গেলে **403**, আর সেটা তার কোয়েরিতেই আসে না।
- একই ডিপোজিট দুইবার approve → **409**, ব্যালেন্স একবারই বাড়ে।
- উইথড্র reject → টাকা ইউজারের ব্যালেন্সে ফেরত (এবং boost-profit বালতিও ফেরত)।

স্ক্রিনশট: `report-assets/payments-country-bd-deposit.png`, `payments-country-panel.png`, `payments-country-us-deposit.png`, `payments-country-switched.png`, `admin-walletagents.png`, `admin-walletagents-created.png`, `walletagent-queue.png`, `walletagent-deposit-detail.png`, `walletagent-withdraw-detail.png`, `walletagent-history.png`, `walletagent-account.png`, `walletagent-panel-live.png`।

---

## ৫. যা এখনো বাকি (সৎ তালিকা)

1. **Dokploy অ্যাপ + DNS** `walletagent.boostpay.online` — কোড প্রস্তুত, পুশ হয়েছে; অ্যাপ/ডোমেইন তৈরি বাকি (ধাপ ৬)।
2. **pay-to নম্বর**: ২০টি ডিফল্ট মেথডের `accountNumber` অ্যাডমিনকে ভরতে হবে, নাহলে ডিপোজিটে মেথড দেখাবে না (কোড আগের মতোই কঠোর থাকে)।
3. এজেন্ট নিজের পাসওয়ার্ড বদলাতে পারবে না — ইচ্ছাকৃত; অ্যাডমিন "Reset password" দিয়ে দেয়।
4. এজেন্টের নিজের কোনো ব্যালেন্স/কমিশন নেই — শুধু কিউ ম্যানেজ করে (আপনি এটা চাইলে পরের জব)।

---

## ৬. রোলব্যাক

```bash
# শুধু কোড: আগের কমিটে ফিরুন (এজেন্ট ডেটা অক্ষত থাকবে, রুটগুলো নিষ্ক্রিয় থাকবে)
git revert <commit>
# অ্যাপ বন্ধ (ডিপ্লয়ের পর)
docker service scale boostpay-walletagent-<hash>=0
# ডাটাবেস: db.walletAgents[] মুছে ফেললেই সব অ্যাকাউন্ট যায়, রিকোয়েস্টের ডেটা অক্ষত
```
