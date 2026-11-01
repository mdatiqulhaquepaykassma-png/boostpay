# REPORT 34 — Android APK (Capacitor) প্রজেক্ট সেটআপ ✅

তারিখ: ২ নভেম্বর ২০২৬ · commit `47734f6` · deploy: API `v1.2.1793559828`

---

## ১. এক নজরে — যা তৈরি হয়েছে

| জিনিস | কোথায় | অবস্থা |
|---|---|---|
| Android অ্যাপ প্রজেক্ট (Capacitor 6) | `mobile/android/` | ✅ তৈরি, Gradle wrapper সহ |
| চারটা অ্যাপের বিল্ড স্ক্রিপ্ট (user/agent/management/admin) | `mobile/scripts/prepare.mjs` | ✅ চালিয়ে যাচাই (user অ্যাপ) |
| লঞ্চার আইকন + স্প্ল্যাশ (২৬টি drawable) | `mobile/scripts/icons.mjs` | ✅ চালানো হয়েছে |
| **ডোমেইন ফলব্যাক** (অ্যাপ বন্ধ না হয়ে অন্য হোস্টে যায়) | `public/api-base.js` (৫টি অ্যাপেই) | ✅ ৯/৯ টেস্ট পাস |
| সার্ভার CORS + `/api/mobile/hosts` | `server.ts` | ✅ লাইভ যাচাই |
| GitHub Actions দিয়ে APK বিল্ড | `.github/workflows/android-apk.yml` | ✅ YAML ভ্যালিড, ১৫ ধাপ |
| নির্দেশিকা (বাংলিশ) | `mobile/README.md` | ✅ |

**মূল নীতি:** অ্যাপ ওয়েবসাইট লোড করে না — UI **ফোনের ভেতরে বান্ডল** থাকে। তাই `binanceusdtpay.io`-এর মতো ডোমেইন মরে গেলেও অ্যাপের আইকন খোলে ও স্ক্রিন আসে; ডেটার জন্য হোস্ট লিস্ট থেকে যেটা সচল সেটাই ব্যবহার করে।

---

## ২. অ্যাপ বানানোর ৩ রাস্তা

**(ক) GitHub Actions — সবচেয়ে সহজ, কিছুই ইনস্টল করতে হবে না**
Actions → **Android APK** → *Run workflow* → app বেছে নিন → artifact **`boostpay-user-apk`** ডাউনলোড → ফোনে ইনস্টল। `main`-এ পুশ হলেও অটো বিল্ড হয়।

**(খ) Android Studio**
```
cd mobile && npm install
node scripts/prepare.mjs user && node scripts/icons.mjs user && npx cap sync android
npx cap open android      → Build → Build APK(s)
```

**(গ) কমান্ড লাইন (SDK থাকলে)**
```
cd mobile/android && ./gradlew assembleDebug
→ app/build/outputs/apk/debug/app-debug.apk
```

চারটা অ্যাপের **নিজস্ব package id** — `com.boostpay.app` / `.agent` / `.management` / `.admin` — তাই এক ফোনে চারটাই ইনস্টল থাকতে পারে।

---

## ৩. ডোমেইন ফলব্যাক — কীভাবে কাজ করে (`public/api-base.js`)

1. অ্যাপ চালু → `/api/health` দিয়ে হোস্ট লিস্ট পরীক্ষা (প্রথমটা আগে, ৩ সেকেন্ড টাইমআউট)।
2. যে হোস্ট সাড়া দেয় → `localStorage`-এ সেভ (পরেরবার সাথে সাথে চালু)।
3. সব `fetch('/api/...')` ওই হোস্টে যায়। কোনো কল ব্যর্থ হলে **বাকি সব হোস্ট একে একে** পরীক্ষা করে পরেরটায় গিয়ে রিট্রাই।
4. **সাধারণ ব্রাউজারে (PWA) এই ফাইল কিছুই করে না** — same-origin আগের মতোই।

হোস্ট লিস্ট দুই জায়গায়: `public/api-base.js`-এর `HOSTS` + সার্ভারের `GET /api/mobile/hosts`
(সার্ভারের লিস্ট বদলালে **নতুন APK ছাড়াই** অ্যাপ নতুন হোস্টে যাবে)।

### টেস্ট — ৯/৯ PASS (সিমুলেটেড Android WebView)
```
PASS  browser: no rewrite, request stays same-origin     (/api/health অপরিবর্তিত)
PASS  browser: no API base forced
PASS  apk: relative /api call → واقعی হোস্টে যায়
PASS  apk: primary host down → healthy fallback বেছে নেয়
PASS  apk: chosen host remembered (localStorage)
PASS  apk: mid-session failover + retry → ২য়/৩য় হোস্টে সফল
PASS  apk: সব হোস্ট ডাউন হলেও অ্যাপ বুট হয়, ক্র্যাশ করে না
PASS  apk: absolute URL কখনো রিরাইট হয় না
RESULT 9 pass / 0 fail
```

---

## ৪. সার্ভারে যা বদলাল (লাইভ যাচাই করা)

| পরিবর্তন | যাচাই |
|---|---|
| CORS-এ `https://localhost` ও `capacitor://localhost` | `OPTIONS` → `204` + `access-control-allow-origin: https://localhost` ✅ |
| CORS-এ `boostpay.online` + admin/agent/management/supportchat | ✅ (পুরোনো লিস্টে মূল ডোমেইনই ছিল না!) |
| অচেনা origin (evil.example) | ✅ কোনো CORS হেডার নেই (ব্লকড) |
| নতুন `GET /api/mobile/hosts` | ✅ লাইভ, `Cache-Control: max-age=300` |

---

## ৫. এখনো বাকি (আপনার সিদ্ধান্ত)

| কাজ | কী লাগবে |
|---|---|
| **অ্যাপ বন্ধ থাকলেও push notification** | Firebase প্রজেক্ট → `google-services.json` (আপনার কাছ থেকে) + `@capacitor/push-notifications` — এখন APK-তে শুধু অ্যাপ খোলা থাকলে আসে |
| Play Store-এ প্রকাশ | $25 developer account + signed AAB + ফিন্যান্স পলিসি ডিক্লেয়ারেশন |
| iOS | Mac + Apple Developer ($99/বছর) |
| `admin.boostpay.online` স্থায়ী করা | Hostinger DNS: `admin`/`agent`/`management` → `72.60.42.18` (আমি DNS বদলাই না) |

⚠️ **সৎ সীমা:** APK দিলে **ডোমেইন ব্লক** সমস্যা মেটে (অ্যাপ খোলে + হোস্ট বদলায়), কিন্তু Google/Play-এর **কনটেন্ট ফ্ল্যাগ** আলাদা — সেটার প্রতিকার পরিষ্কার ব্র্যান্ড, স্বচ্ছ শর্ত, দ্রুত সাপোর্ট (দেখুন `REPORT_33`)। আর API ছাড়া কোনো অ্যাপই টাকা দেখাতে পারে না — তাই ব্যাকআপ হোস্ট থাকাটাই আসল বীমা।

---

## ৬. পরের ধাপে আমি যা করতে পারি (বললেই)

1. **Firebase push** — আপনি `google-services.json` দিলে অ্যাপ বন্ধ থাকলেও নোটিফিকেশন চালু করে দেব।
2. **সব ৪টি অ্যাপের APK একসাথে** বিল্ড করে artifact হিসেবে দেওয়া (CI-তে এক ক্লিকে)।
3. **Uptime watchdog + অটো হোস্ট সুইচ** — প্রাইমারি ডোমেইন পড়ে গেলে সার্ভার নিজেই হোস্ট লিস্ট বদলে দেবে।
4. **admin.boostpay.online** সেটআপ (DNS রেকর্ড আপনার দিক থেকে)।
