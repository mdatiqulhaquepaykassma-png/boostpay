# REPORT 39 — `management.boostpay.com` কেন খুলছিল না, আর কী ঠিক করলাম

তারিখ: ২ নভেম্বর ২০২৬ · লাইভ API `v1.2.3568305` · Cloudflare zone `boostpay.online`

---

## ১. সংক্ষেপে — দুটো আলাদা কারণ

**কারণ ১ — `.com` ডোমেইনটা আমাদের নয়।**
`boostpay.com` রেজিস্টার্ড `Atom.com`-এ, nameserver `NS1/NS2.ATOM.COM`। ওই ডোমেইনে `management`, `admin` — কোনো রেকর্ডই নেই, তাই `management.boostpay.com` **সংজ্ঞা অনুযায়ীই** খুলবে না। আমাদের ডোমেইন **`boostpay.online`**, আর সেটার DNS এখন Cloudflare-এ (`tiffany/nile.ns.cloudflare.com`)।

**কারণ ২ — `management.boostpay.online`-এর রেকর্ডই ছিল না।**
Cloudflare zone-এ মাত্র ৪টি রেকর্ড ছিল: `@`, `www`, `agent`, `supportchat`। মানে management অ্যাপ শুধু অস্থায়ী ঠিকানায় চলছিল: `management.72-60-42-18.sslip.io`। Traefik-এর নিয়মে management-এর একমাত্র "সুন্দর" হোস্ট ছিল `management.agent.boostpay.online` — সেটারও DNS ছিল না।

**যা করলাম:** management / admin / DB Studio — তিনটিরই আসল ঠিকানা বানিয়ে দিলাম, সার্টিফিকেটসহ।

| অ্যাপ | নতুন ঠিকানা | অবস্থা |
|---|---|---|
| Management | **https://management.boostpay.online** | ২০০ ✅ (Let's Encrypt সার্ট, বৈধ) |
| Admin Console | **https://admin.boostpay.online** | ২০০ ✅ |
| DB Studio | **https://db.boostpay.online** | ২০০ ✅ |
| User app / Agent / Support chat | boostpay.online · agent.boostpay.online · supportchat.boostpay.online | আগের মতোই ২০০ ✅ |

---

## ২. কীভাবে করলাম (উল্লেখ করা দরকার)

1. **Traefik route** — নতুন ফাইল `/etc/dokploy/traefik/dynamic/boostpay-online-domains.yml`। এতে ৩টি হোস্টের জন্য web (http→https redirect) + websecure (TLS) রাউটার, প্রতিটি **আগের কন্টেইনারেই** যুক্ত (`boostpay-management-app-qtxmlm:3000`, `boostpay-admin-a7uowo:3000`, `boostpay-studio-8n0fyq:3000`)। অ্যাপের ভেতরে কিছুই বদলায়নি — প্রতিটি সাব-অ্যাপ নিজেই `/api` কে মূল API-তে প্রক্সি করে, তাই ব্রাউজার same-origin-এই থাকে (CORS লাগে না)।
2. **Cloudflare DNS** — `management`, `admin`, `db` এই তিনটি A রেকর্ড যোগ।
3. **সার্টিফিকেট** — প্রথম চেষ্টায় Let's Encrypt HTTP-01 ব্যর্থ হলো: রেকর্ডগুলো **Proxied (কমলা মেঘ)** ছিল, আর Cloudflare-এর *Always Use HTTPS* চ্যালেঞ্জটা https-এ রিডাইরেক্ট করছিল, কিন্তু তখন অরিজিনে ওই হোস্টের সার্টই ছিল না → `526` লুপ। সমাধান: এই তিনটি **অ্যাডমিন** হোস্টকে **DNS-only (ধূসর মেঘ)** করা — LE সরাসরি সার্ভার থেকে সার্ট নিল, তিনটিই সফল (ইস্যুয়ার Let's Encrypt `YR1/YR2`)। ব্যবহারকারীর অ্যাপ/এজেন্ট/সাপোর্ট — ওগুলো আগের মতোই Cloudflare proxied, কিছু বদলায়নি।

**ভেরিফিকেশন (সার্ভার থেকে সরাসরি):** প্রতিটি হোস্টে `200`, সঠিক `<title>` (BoostPay Management / Admin Console / DB Studio), `/api/health` JSON ফেরত দিচ্ছে, বান্ডল লোড হচ্ছে (287 KB / 550 KB / 246 KB)। পুরোনো sslip ঠিকানাগুলোও আগের মতোই কাজ করছে — ফলব্যাক নষ্ট হয়নি।

---

## ৩. `.com` চাইলে কী লাগবে (ঐচ্ছিক)

`boostpay.com` যদি সত্যিই আপনার হয় (Atom.com অ্যাকাউন্ট) — তবে:
1. Atom.com-এ ওই ডোমেইনের nameserver Cloudflare-এর `tiffany/nile.ns.cloudflare.com`-এ বদলাতে হবে;
2. Cloudflare-এ **নতুন zone** হিসেবে `boostpay.com` যোগ হবে (আলাদা zone, আলাদা রেকর্ড);
3. তারপর সেখানে `management`/`admin` A রেকর্ড + Traefik-এ ওই হোস্টের রাউটার — ~১০ মিনিটের কাজ।

আমার পরামর্শ: **`.online`-ই থাকুক** — এক ডোমেইনে থাকলে সার্ট, CORS, লগইন সেশন, PWA, APK-র হোস্ট লিস্ট সব এক জায়গায় থাকে; দুই ডোমেইন মানে দুই জায়গায় রক্ষণাবেক্ষণ।

---

## ৪. একটু পরে যা দেখতে হবে

Google-এর পাবলিক DNS-এ `management.boostpay.online` এখনো `NXDOMAIN` দেখাচ্ছে — এটা পুরোনো নেগেটিভ ক্যাশ (আমরা যোগ করার আগে "নেই" বলে ক্যাশ হয়ে গেছে)। **Cloudflare-এর authoritative DNS-এ রেকর্ড ঠিকই আছে** (`72.60.42.18`)। সাধারণত ৫–৬০ মিনিটে সব রিজলভারে চলে আসে; এর মধ্যে ফোনে Wi-Fi/data বদলে বা একবার এয়ারপ্লেন মোড দিয়ে দেখলেই পাবেন।

---

## ৫. রোলব্যাক

- কোনো হোস্ট বন্ধ করতে চাইলে: `rm /etc/dokploy/traefik/dynamic/boostpay-online-domains.yml` (Traefik নিজেই রিলোড হবে) + Cloudflare থেকে ওই A রেকর্ড মুছে দিন।
- পুরোনো sslip ঠিকানা কখনোই বন্ধ হয়নি — তাই কিছু ভাঙার ঝুঁকি নেই।
- ফাইলের কপি রিপোতে রাখা আছে: `deploy/traefik/boostpay-online-domains.yml`।

---

## ৬. নিরাপত্তা নোট (সৎভাবে)

- 관리 hosgulo **DNS-only**, তাই Cloudflare-এর WAF/DDoS শিল্ড এদের ওপরে নেই (মূল ডোমেইন আর ইউজার অ্যাপে আছে)। 대신 সার্ভারের নিজের লগইন সুরক্ষা (rate limit + IP auto-block) কাজ করছে।
- চাইলে পরের ধাপে: **Cloudflare Origin CA সার্টিফিকেট** নিয়ে এদের আবার proxied করা যাবে (তখন WAF + IP গোপন থাকবে) — এর জন্য টোকেনে `SSL and Certificates: Edit` পারমিশন লাগবে, অথবা ড্যাশবোর্ড → SSL/TLS → Origin Server → Create Certificate।
- আরও শক্ত করতে চাইলে **Cloudflare Access** দিয়ে admin/management-এ ইমেইল-OTP লগইন বসানো যায় — বললে করে দেব।
