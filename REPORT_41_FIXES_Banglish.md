# REPORT 41 — REPORT 40-এ পাওয়া সমস্যাগুলো ঠিক করা হয়েছে

তারিখ: ২ নভেম্বর ২০২৬ · commit **`ef12578`** · লাইভ API **`v1.2.1793606958`**

---

## ১. সংক্ষেপে

> **৫টি সমস্যার ৫টিই ঠিক হয়েছে, সাথে ৩টি ইনফ্রা-ঘাটতিও।**
> **`tools/user-journey.py` = ৫৬/৫৬ PASS** (আগে ৫০/৫৫), `regression 42/42`, `sync-perf 9/9`, `send-live 6/6`, `tsc` ও `vite build` ক্লিন, `tools/system-check.py` → **"no problems found"**।
> কোনো ব্যবসার নিয়ম (টাকা, কমিশন, লক, boost) বদলায়নি — শুধু যে জায়গায় ভুল ছিল সেগুলো সারানো হয়েছে।

---

## ২. এক এক করে — আগে সমস্যা, এখন ফল

### ✅ ১) অডিট লগে লক/আনলক ঢুকছে না → **ঠিক**
**করণ:** ১৭টি হ্যান্ডলারে `recordAuditLog()` এখন `writeDb()`-এর **আগে** চলে (send-lock, agent-lock, referral/antifraud config, IP block add/update/remove/toggle, audit correction, SMTP add/update/remove/config, password reset, email verify, agent login)।
**প্রমাণ:** লোকালে send-lock দিলে অডিট এন্ট্রি **৬ → ৭**, নতুন এন্ট্রি:
`{"action":"USER_SEND_LOCK","adminEmail":"admin@boostpay.local","targetUserId":"U3","details":"User #U3 send lock -> $5.00 held (audit-fix…)"}` — লক খুললে আরেকটি এন্ট্রি (৭ → ৮)।
**নোট:** টেস্টে ভুল ক্রম ধরার পর স্ক্রিপ্টের প্রথম চেষ্টায় দুটি এন্ট্রি ভুল জায়গায় সরেছিল — ধরা পড়ায় ফিরিয়ে নিয়ে **শুধু সঠিক ১৭টিতেই** প্রয়োগ করা হয়েছে (ডিফে দেখা যায় প্রতিটি কেবল এক লাইন উপরে-নিচে সরানো)।

### ✅ ২) ভুল পাসওয়ার্ডে **পুরো আইপি** ব্লক → এখন শুধু **ওই আইপি + ওই অ্যাকাউন্ট**, আর শাস্তি ধাপে ধাপে
**আগে:** ৮ বার ভুল → IP ৩০ মিনিট ব্লক → ওই নেটওয়ার্কের **সবাই** লগইন করতে পারত না; সঠিক পাসওয়ার্ডেও ঢোকা যেত না।
**এখন:** ব্লকের চাবি = `IP + ইমেইল`; সময় **৬০ সেকেন্ড → ৫ মিনিট → ৩০ মিনিট** (বারবার করলে বাড়ে)। অ্যাকাউন্ট-ফ্রিজ (অ্যান্টিফ্রড) আগের মতোই আছে — ব্রুট-ফোর্স ঠেকানো আছে।
**প্রমাণ (একই আইপি থেকে):** ৮ বার ভুল → `[401×8, 429, 429]` · **নির্দোষ অন্য ইউজার (u3): ২০০** ✅ · ৬০ সেকেন্ড পরে আসল মালিক (u2): **২০০** ✅

### ✅ ৩) ব্যর্থ সেন্ড চেষ্টা কোটা খাচ্ছিল → **ঠিক**
**করণ:** `/api/transfer`-এর প্রতিটি **ভ্যালিডেশন-ব্যর্থ** রেসপন্সে (`refundRateLimit`) টোকেন ফেরত যায় — ভুল অ্যামাউন্ট, নিজেকে সেন্ড, অজানা প্রাপক, অন্যের অ্যাকাউন্ট ইত্যাদি। সফল সেন্ডে কিছুই ফেরত যায় না।
**প্রমাণ:** এক মিনিটে **৯টি ভুল চেষ্টা → সব ৪০০, কোনো ৪২৯ নেই** (আগে ৯মটায় ৪২৯)।

### ✅ ৪) চ্যাট টেক্সটের সীমা ছিল না → **৪,০০০ অক্ষর**
**প্রমাণ:** ৫,০০০ অক্ষর → `400 {"error":"Message is too long (5000 characters). Keep it under 4000 — send the rest as a second message or a voice note.","maxLength":4000}` · ৩,৯৯৯ অক্ষর → **২০০** ✅ (ভয়েসের ২ মিনিট সীমা আগেই ছিল)

### ✅ ৫) ৫টি অ্যাপে সিকিউরিটি হেডার নেই → **৬টি হোস্টেই এখন আছে**
Traefik-এ `bp-security-headers` middleware (HSTS ১ বছর + subdomains, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, Permissions-Policy)।
**প্রমাণ:** user / agent / supportchat / admin / db / management — **৬টিতেই ৪/৪ হেডার**, প্রতিটি অ্যাপের পেজ ২০০, বান্ডল লোড, `/api/health` ঠিক।
**ইচ্ছাকৃত বাদ:** **CSP** কনসোলগুলিতে দেওয়া হয়নি — ওদের বান্ডলে ইনলাইন বুটস্ট্র্যাপ আছে, ভুল পলিসি দিলে লগইন স্ক্রিন ভাঙবে। (system-check এখন CSP বাদ থাকাকে "note" হিসেবে দেখায়, সমস্যা নয়।)

### ✅ ৬) `/api/<ভুল রুট>` → HTML ২০০ → এখন **JSON 404**
**প্রমাণ (লাইভ):** `GET /api/definitely-not-real` → `404 {"error":"Unknown API endpoint.","code":"API_NOT_FOUND"}` · আর `/wallet`, `/chat`, `/a/b/c` আগের মতোই অ্যাপ সার্ভ করে (**২০০**)।

### ✅ ৭) DB Studio-র PWA manifest নেই → **যোগ হয়েছে, লাইভ**
`db-studio/public/manifest.json` + `icon.svg` + index.html-এ লিঙ্ক।
**প্রমাণ (লাইভ):** `https://db.boostpay.online/manifest.json` → **২০০**, `{"name":"BoostPay DB Studio","display":"standalone",…}`।

### ✅ ৮) (বোনাস) npm/CI আচরণ
`tools/system-check.py` এখন CSP বাদকে সমস্যা গোনে না — তাই ভবিষ্যতে "সব ঠিক" মানে সত্যিই সব ঠিক।

---

## ৩. টেস্ট ফলাফল (সব লোকাল, প্রোডাকশনে কোনো লেখা নেই)

| সুইট | আগে | এখন |
|---|---|---|
| `tools/user-journey.py` (ইউজার-জার্নি, ৫৬ চেক) | 50/55 | **56/56 PASS** |
| `tools/regression.cjs` (লক, MFA, sync, host) | 42/42 | **42/42 PASS** |
| `tools/sync-perf.test.mts` | 9/9 | **9/9 PASS** |
| `tools/send-live.test.mts` | 6/6 | **6/6 PASS** |
| `tools/bootstrap.test.mts` | 22/22 | 22/22 PASS |
| `tools/system-check.py` (লাইভ, read-only) | ৩টি ইনফ্রা-ঘাটতি | **no problems found** |
| `tsc --noEmit` / `vite build` | clean | clean (bundle ১১২ KB gzip) |

---

## ৪. প্রোডাকশনে যা যাচাই করেছি (শুধু পড়ে)

- API ভার্সন বদলেছে: `v1.2.1793606661` → **`v1.2.1793606958`** (ডিপ্লয় সম্পন্ন)
- `/api/definitely-not-real` → **JSON 404** ✅
- `/wallet` (গভীর লিঙ্ক) → **২০০**, অ্যাপ ঠিক ✅
- ৬ হোস্টে **হেডার ✅**, ৬টি সার্টিফিকেট **৯০ দিন বাকি**, `http→https` ৩০১, CORS ২০৪
- DB Studio manifest লাইভ ✅
- ছয়টি অ্যাপের পেজ + বান্ডল + `/api/health` — সব ২০০

**প্রোডাকশনে যা ইচ্ছাকৃতভাবে টেস্ট করিনি:** লকআউট, অডিট-এন্ট্রি, সেন্ড-কোটা, চ্যাট-সীমা — এগুলো প্রমাণ করতে **লেখা** লাগে, আর আপনার নিয়মে প্রোডাকশনে রাইট কল নয়। এগুলো লোকালে প্রমাণিত; কোড একই।

---

## ৫. রোলব্যাক

`git revert ef12578` — শুধু লজিক-সারানো ও ভ্যালিডেশন; কোনো ডেটাবেস স্কিমা বা ফাইন্যান্সিয়াল ফর্মুলা বদলায়নি।
Traefik হেডার আলাদা: `deploy/traefik/boostpay-online-domains.yml` থেকে `bp-security-headers` সরালেই আগের অবস্থা।

---

## ৬. এখনো বাকি (আপনার সিদ্ধান্ত / বাইরের নির্ভরতা)

- **Firebase push** — `google-services.json` লাগবে (আগের মতোই)
- **Play Store AAB**, iOS
- **admin/management-এ Cloudflare Access** (ইমেইল OTP) — চাইলে করে দেব
- **Origin CA সার্ট + আবার proxied** — admin/db/management-এ CF WAF ফেরাতে
- **CSP** কনসোলগুলিতে — আগে ওদের ইনলাইন স্ক্রিপ্ট আলাদা করতে হবে (ছোট রিফ্যাক্টর), তখন নিরাপদে দেওয়া যাবে
