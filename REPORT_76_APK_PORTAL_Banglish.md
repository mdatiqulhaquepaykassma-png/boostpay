# REPORT 76 — APK Download Portal (`app.boostpay.online`)

**Date:** 2026-11-12
**Job:** "sob app er apk download korar jonno akta application banan dockploy te" — প্রতিটা অ্যাপের জন্য আলাদা লিংক + Download বাটন।
**Status:** ✅ **LIVE** — সব লিংক কাজ করছে, HTTPS, Cloudflare-এর পেছনে।

---

## ১. লাইভ লিংক (এগুলোই ইউজারকে দিতে হবে)

| অ্যাপ | আলাদা পেজ (Details + বাটন) | সরাসরি ডাউনলোড |
| --- | --- | --- |
| **BoostPay (ইউজার অ্যাপ)** | `https://app.boostpay.online/userapk` | `https://app.boostpay.online/userapk/download` |
| **BoostPay Agent** | `https://app.boostpay.online/agentapk` | `https://app.boostpay.online/agentapk/download` |
| **BoostPay Management** | `https://app.boostpay.online/managementapk` | `https://app.boostpay.online/managementapk/download` |
| **BoostPay Admin** (প্রাইভেট) | `https://app.boostpay.online/adminapk` | `https://app.boostpay.online/adminapk/download` |
| **BoostPay SMS Relay** (প্রাইভেট) | `https://app.boostpay.online/relayapk` | `https://app.boostpay.online/relayapk/download` |
| সব একসাথে (গ্যালারি) | `https://app.boostpay.online/` | — |
| হেলথ চেক | `https://app.boostpay.online/api/health` | — |
| JSON লিস্ট | `https://app.boostpay.online/api/apks` | — |

> আপনার উদাহরণটা ছিল `app.boostpay.online/userapk` — ঠিক সেটাই বানানো হয়েছে। বাকিগুলো একই প্যাটার্নে।

---

## ২. এখন কী আছে (লাইভ ডেটা)

| অ্যাপ | ফাইল | সাইজ | version | SHA-256 (প্রথম ১৬) | প্যাকেজ |
| --- | --- | --- | --- | --- | --- |
| BoostPay | `boostpay-user.apk` | 4.0 MB | 1.0 | `0b8c669f3a456d01` | `com.boostpay.app` |
| BoostPay Agent | `boostpay-agent.apk` | 3.8 MB | 1.0 | `35be8d278a9a2e48` | `com.boostpay.agent` |
| BoostPay Management | `boostpay-management.apk` | 3.8 MB | 1.0 | `f87fe39a074552e6` | `com.boostpay.management` |
| BoostPay Admin | `boostpay-admin.apk` | 3.9 MB | 1.0 | `a163143a1691f0f4` | `com.boostpay.admin` |
| BoostPay SMS Relay | `boostpay-sms-relay.apk` | 19 KB | 1.0 | `8e59d719b37db3af` | `com.boostpay.smsrelay` |

সব APK এখন **release build** (debuggable flag নেই) এবং একই স্টেবল কি দিয়ে সাইন করা:

```
CN=BoostPay, O=BoostPay, L=Dhaka, C=BD
SHA-256: ad923e947380f6aa3d9f42fc6f34408ec370c5919498c69ca1fc8cdb5153b61e
```

চারটা আলাদা `applicationId` — একই ফোনে চারটা অ্যাপ একসাথে ইনস্টল থাকতে পারবে, একটার অ্যাকাউন্ট অন্যটাকে টাচ করবে না।

⚠️ **গুরুত্বপূর্ণ:** এই কী দিয়ে সাইন করা APK-এর উপরে ভবিষ্যতে আপডেট দিতে হলে **একই কী** লাগবে। কী-টা `mobile/android/app/keystore.b64` হিসেবে রেপোতে কমিট করা আছে (git-ignored `.jks` থেকে ডিকোড হয়)। এই ফাইলটা মুছে ফেললে/বদলালে ইউজারকে অ্যাপ আনইনস্টল করে নতুন করে ইনস্টল করতে হবে — তাই ফাইলটা ডিলিট করবেন না।

---

## ৩. পেজে কী দেখায়

**`/` (গ্যালারি):** প্রতিটা অ্যাপের কার্ড — নাম, এক লাইনে কাজ, **READY/PRIVATE** ব্যাজ, সাইজ, ভার্সন, বিল্ড তারিখ, বড় **Download** বাটন + **Details**।

**`/userapk` (প্রতিটা অ্যাপের নিজের পেজ):** অ্যাপের নাম, প্যাকেজ নাম, SHA-256, সাইজ, বিল্ড তারিখ, বড় **Download BoostPay APK** বাটন, আর ৪ ধাপের ইনস্টল গাইড (Download → Install anyway → লগইন → Battery Unrestricted)।

**নিরাপত্তা:** কোনো লগইন লাগে না (ডাউনলোড পাবলিক, এটাই দরকার), কোনো secret/PII পেজে নেই, `X-Content-Type-Options: nosniff`, `attachment` ডিসপোজিশন, শুধু `GET`/`HEAD` (POST → 405)। কোনো আপলোড এন্ডপয়েন্ট নেই — ফাইল শুধু রেপো থেকে আসে, তাই কেউ সার্ভারে APK বসাতে পারবে না।

স্ক্রিনশট: `report-assets/apk-portal-index.png`, `report-assets/apk-portal-userapk.png`

---

## ৪. ইনফ্রা (কীভাবে বসানো হলো)

| জিনিস | মান |
| --- | --- |
| Dokploy অ্যাপ | **BoostPay APK Portal** — `SX4u6LAwmFpclWQRwrLaM` |
| কন্টেইনার | `app-calculate-bluetooth-application-mtqvhf` (port 3000) |
| সোর্স | `github mdatiqulhaquepaykassma-png/boostpay`, branch `main`, **buildPath `/apk-portal`** |
| বিল্ড | nixpacks (`node server.mjs`), autoDeploy ON |
| ডোমেইন | `app.boostpay.online` → `72.60.42.18`, **Cloudflare proxied (orange)** |
| TLS | Let's Encrypt, Traefik `certResolver: letsencrypt`, অটো রিনিউ |
| কোড | `apk-portal/` — `server.mjs` (dependency-free Node), `apks/`, `check.py`, `publish.sh`, `nixpacks.toml` |

**কেন আলাদা অ্যাপ:** মেইন সাইট (`boostpay.online`) ডাউন থাকলেও ডাউনলোড লিংক যেন কাজ করে — শেয়ার করা কন্টেইনার/সার্ভিস নেই।

**DNS নিয়ম মানা হয়েছে:** প্রথমে **grey cloud** → HTTPS + health 200 কনফার্ম → তারপর **orange cloud** ফ্লিপ → Cloudflare edge দিয়ে আবার সব ফাইল ভেরিফাই।

---

## ৫. নতুন বিল্ড কীভাবে তুলবেন (আপনার জন্য ৩ লাইন)

কোনো অ্যাপে কোড বদলানোর পর:

```bash
cd mobile
node scripts/prepare.mjs user          # user | agent | management | admin
npx cap sync android
cd android && ./gradlew assembleRelease
cd ../.. && sh apk-portal/publish.sh user release   # ফাইলটা apk-portal/apks/ তে কপি হয়
git add apk-portal/apks && git commit -m "apk: new user build" && git push
```

পুশ করার ~১-২ মিনিটের মধ্যে Dokploy নিজেই রিবিল্ড করে নতুন ফাইল লাইভ করে দেয় (autoDeploy)। পেজে সাইজ/তারিখ/SHA নিজে থেকেই আপডেট হবে।

SMS Relay APK বানানোর নিয়ম আলাদা (নেটিভ অ্যাপ, Capacitor নয়) — `sms-relay/` ফোল্ডার, `REPORT_75`-এ লেখা আছে; বিল্ড শেষে ফাইলটা `apk-portal/apks/boostpay-sms-relay.apk` তেও কপি করতে হবে (আর `public/download/`-এ আগের লিংকের জন্য)।

---

## ৬. টেস্ট রেজাল্ট

| চেক | রেজাল্ট |
| --- | --- |
| `apk-portal/check.py` (লোকাল) | **74 pass / 0 fail** |
| ৬টা পেজ (`/`, `/userapk`, `/agentapk`, `/managementapk`, `/adminapk`, `/relayapk`) | সব **200** |
| ৫টা ডাউনলোড (`/<slug>/download`) | সব **200**, সঠিক সাইজ, `application/vnd.android.package-archive` |
| SHA-256 — লাইভ ফাইল vs রেপো ফাইল | **৫/৫ MATCH** |
| Cloudflare edge (104.21.60.244) দিয়ে | সব **200**, হুবহু একই সাইজ |
| ব্রাউজারে ক্লিক করে ডাউনলোড | playwright ডাউনলোড ইভেন্ট ফায়ার — `boostpay-user.apk` |
| ভুল লিংক (`/nope`, `/nosuchapk/download`) | **404** |
| POST রিকোয়েস্ট | **405** |
| মেইন সাইট / walletagent / agent / management / promotion | সব **200** (Traefik রিস্টার্টের পর ভেরিফাই করা) |
| APK সাইনিং | `apksigner verify` — valid, একই সার্টিফিকেট ৪টা অ্যাপে |

**কমিট:** `ac5355c` (portal + APK) → `cf30ba1` (release signing) → `99b3ede` (SVG আইকন, KB/MB)। সব পুশ করা, লাইভ ডিপ্লয় `done`।

---

## ৭. যা এখনো বাকি / খেয়াল রাখুন

1. **ভার্সন নাম্বার এখনো `1.0` / versionCode `1`** — অ্যাপ আপডেট দিলে versionCode বাড়াতে হবে, নাহলে ফোন আপডেটটা "নতুন" হিসেবে ধরবে না (uninstall/reinstall করতে হবে)। বলবেন, আমি `prepare.mjs`-এ অটো versionCode বাম্প বসিয়ে দেব।
2. **Play Store** — এগুলো সাইড-লোড (Play Store-এ নেই), ইনস্টল করার সময় ফোন "Unknown source" ওয়ার্নিং দেবে; এটাই স্বাভাবিক।
3. **Admin/Relay পেজে লিংক প্রাইভেট রাখতে চাইলে** — এখন যে কেউ লিংক জানলে APK নামাতে পারবে। চাইলে Cloudflare Access বা একটা কোড-গেট বসানো যায় (বললে করে দেব)।
4. **UI বাংলা লেখা** — ফোনে (Android/iOS) ঠিকই দেখাবে; পুরনো ডেস্কটপে বাংলা ফন্ট না থাকলে বক্স দেখাতে পারে, তাই নাম/বাটন/সাইজ সব ইংরেজিতেই রাখা হয়েছে, বাংলা শুধু ব্যাখ্যায়।
5. **অটো-আপডেট** — এখন APK রেপোতে কমিট করেই আপডেট হয় (উপরের ৫ নম্বর ধাপ)। চাইলে CI থেকে অটো-পুশ করা যায়, কিন্তু তখন প্রতিটা মেইন-পুশে চারটা APK বিল্ড হবে — ধীরগতির জন্য এখন হাতে রাখা ভালো।

---

**সংক্ষেপে:** `app.boostpay.online` লাইভ, `userapk` সহ ৫টা আলাদা লিংক, প্রত্যেকটায় বড় Download বাটন, ফাইলগুলো release-signed, Cloudflare+HTTPS-এর পেছনে, টেস্ট ৭৪/৭৪ পাস।
