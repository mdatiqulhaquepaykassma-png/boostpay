# BoostPay Android অ্যাপ (Capacitor) — সেটআপ ও বিল্ড

এই ফোল্ডারে BoostPay-এর **Android (APK) শেল** আছে। ভেতরের UI পুরোটাই আমাদের React বান্ডল —
অ্যাপ ইন্টারনেট থেকে ওয়েবসাইট লোড করে না, তাই **ডোমেইন মরে গেলেও অ্যাপের আইকন খোলে, স্ক্রিন আসে**
(সাদা স্ক্রিন নয়)। API একাধিক হোস্টে ফলব্যাক করে (`public/api-base.js`)।

---

## ১. কী কী আছে

```
mobile/
├─ capacitor.config.json        # appId / appName / webDir=www / androidScheme=https
├─ package.json                 # Capacitor 6 + ৪টি ছোট প্লাগিন
├─ scripts/prepare.mjs          # যেকোনো অ্যাপ বিল্ড করে www/ বানায় (user|agent|management|admin)
├─ scripts/icons.mjs            # লঞ্চার আইকন + স্প্ল্যাশ বসায়
├─ www/                         # শেষ বিল্ড (gitignored নয়, রেফারেন্স হিসেবে থাকে)
├─ android/                     # আসল Android 프로젝트 (Gradle)
└─ README.md                    # এই ফাইল
```

সাথে রিপো রুটে:
* `public/api-base.js` — হোস্ট লিস্ট + ফলব্যাক (৫টি ওয়েব অ্যাপেই ইনজেক্ট করা)
* `.github/workflows/android-apk.yml` — GitHub থেকেই APK বিল্ড
* সার্ভারে `GET /api/mobile/hosts` — **অ্যাপ আপডেট ছাড়াই** হোস্ট বদলানো যায়

---

## ২. অ্যাপ বেছে নিয়ে বিল্ড (লোকাল)

```bash
cd mobile
npm install                 # একবার
node scripts/prepare.mjs user        # → mobile/www (ইউজার অ্যাপ)
node scripts/icons.mjs user
npx cap sync android
```

অন্য অ্যাপের জন্য: `agent` / `management` / `admin`. প্রতিটার **নিজস্ব package id** হয়
(`com.boostpay.app`, `com.boostpay.agent`, `com.boostpay.management`, `com.boostpay.admin`),
তাই চারটা অ্যাপ একসাথে এক ফোনে ইনস্টল থাকতে পারে।

---

## ৩. APK বানানোর দুই রাস্তা

### (ক) Android Studio দিয়ে (সবচেয়ে সহজ)
1. Android Studio (Koala বা নতুন) + **Android SDK 34** ইনস্টল করুন, **JDK 17** সেট করুন।
2. `mobile/android` ফোল্ডারটা Android Studio-তে Open করুন (Gradle sync চলবে).
3. **Build → Build Bundle(s)/APK(s) → Build APK(s)**
4. ফাইল: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` → ফোনে কপি করে ইনস্টল (Unknown sources অন)।

### (খ) শুধু কমান্ড লাইন (SDK থাকলে)
```bash
export ANDROID_HOME=$HOME/Android/Sdk
cd mobile/android && ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

### (গ) GitHub Actions দিয়ে (লোকাল Android SDK ছাড়াই — **সুপারিশ**)
* `main`-এ পুশ হলেই Actions → **Android APK** → artifact **`boostpay-user-apk`** ডাউনলোড।
* হাতে চালাতে: Actions → Android APK → *Run workflow* → app বেছে নিন (`user`/`agent`/`management`/`admin`)।
* ট্যাগ দিলে (`git tag v1.0.0 && git push --tags`) APK Release-এও যুক্ত হয়।

---

## ৪. সার্ভারে কী বদলেছে (অ্যাপ চলার জন্য জরুরি)

| পরিবর্তন | কেন |
|---|---|
| `https://localhost`, `capacitor://localhost` CORS allowlist-এ যোগ | অ্যাপের WebView origin এটাই |
| `boostpay.online` + admin/agent/management/supportchat হোস্টও allowlist-এ | পুরোনো লিস্টে মূল ডোমেইনই ছিল না |
| নতুন `GET /api/mobile/hosts` (পাবলিক, সিক্রেট নেই) | ভবিষ্যতে ডোমেইন বদলালে **নতুন APK ছাড়াই** অ্যাপ নতুন হোস্টে যাবে |

> অ্যাপ এখনো `Authorization: Bearer …` টোকেনই ব্যবহার করে — কুকি নয়, তাই CORS-এ `credentials` লাগে না।

---

## ৫. হোস্ট ফলব্যাক কীভাবে কাজ করে (`public/api-base.js`)

1. অ্যাপ চালু হলে `/api/health` দিয়ে হোস্ট লিস্ট পরীক্ষা করে (প্রথমটা আগে, ৩ সেকেন্ড টাইমআউট)।
2. যে হোস্ট সাড়া দেয় সেটা `localStorage`-এ রাখে — পরেরবার সাথে সাথে চালু।
3. সব `fetch('/api/...')` ওই হোস্টে যায়। কোনো কল নেটওয়ার্ক-এররে ব্যর্থ হলে
   **বাকি হোস্টগুলো একে একে পরীক্ষা করে** পরেরটায় গিয়ে একবার রিট্রাই করে।
4. সাধারণ ব্রাউজারে (PWA) এই ফাইলটা **কিছুই করে না** — same-origin-ই থাকে।

হোস্ট বদলাতে: `public/api-base.js`-এর `HOSTS` + সার্ভারের `/api/mobile/hosts` দুটোই
(একই লিস্ট রাখুন)। টেস্ট: `node /tmp/api_base_test.mjs` ধরনের সিমুলেশন — ৯/৯ পাস করা আছে।

---

## ৬. রিলিজ APK সাইন করা (Play Store বা আপডেটের জন্য)

```bash
keytool -genkey -v -keystore boostpay-release.keystore -alias boostpay \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 boostpay-release.keystore     # GitHub Secrets-এ বসাতে হবে
```
GitHub → Settings → Secrets → Actions-এ যোগ করুন:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`

⚠️ keystore হারালে Play Store-এ আপডেট দেওয়া যাবে না — নিরাপদ জায়গায় ব্যাকআপ রাখুন (সিক্রেট রিপোতে কমিট করবেন না)।

---

## ৭. এখনো বাকি (আপনার সিদ্ধান্ত দরকার)

| কাজ | কেন দরকার | কী লাগবে |
|---|---|---|
| **Push notification (অ্যাপ বন্ধ থাকলেও)** | PWA-র Web Push Android অ্যাপে কাজ করে না | Firebase প্রজেক্ট → `google-services.json` (আপনার কাছ থেকে) + `@capacitor/push-notifications` |
| Play Store-এ প্রকাশ | ডিস্ট্রিবিউশন সহজ হয় | $25 developer account, ফিন্যান্স/লেনদেন সংক্রান্ত পলিসি ডিক্লেয়ারেশন, signed AAB |
| iOS অ্যাপ | iPhone ইউজার | Mac + Apple Developer ($99/বছর) + App Store রিভিউ |
| ডোমেইন স্থায়ী করা | `admin.boostpay.online` ইত্যাদি | Hostinger DNS-এ `admin/agent/management` → `72.60.42.18` |

> ⚠️ APK দিলে "ডোমেইন ব্লক" সমস্যা মেটে, কিন্তু Google/Play-এর **কনটেন্ট ফ্ল্যাগ** আলাদা
> বিষয় — সেটার সমাধান পরিষ্কার ব্র্যান্ড, স্বচ্ছ শর্ত ও দ্রুত সাপোর্ট (দেখুন `REPORT_33`)।

---

## ৮. দ্রুত চেকলিস্ট (প্রথম APK)

```bash
cd mobile
npm install
node scripts/prepare.mjs user && node scripts/icons.mjs user && npx cap sync android
npx cap open android        # Android Studio খুলবে → Build APK(s)
```
অথবা শুধু GitHub-এ পুশ করে Actions artifact ডাউনলোড করুন।
