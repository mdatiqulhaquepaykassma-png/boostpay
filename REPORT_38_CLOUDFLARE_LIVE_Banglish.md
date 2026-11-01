# REPORT 38 — Cloudflare CDN চালু: মাপা ফলাফল

তারিখ: ২ নভেম্বর ২০২৬ · zone `boostpay.online` (`ea7c014fb0e4daaa3b9599148862aab9`) · plan Free · লাইভ API `v1.2.1793567140`

---

## ১. সংক্ষেপে

> **Cloudflare এখন লাইভ।** `server: cloudflare`, প্রতিটি রেসপন্সে `cf-ray`, স্ট্যাটিক বান্ডল এজ থেকে ক্যাশ (`cf-cache-status: HIT`), আর **API কখনো ক্যাশ হয় না** (`DYNAMIC`)।
> প্রথম সংযোগের সময় **০.৪৯ s → ০.৩০ s** (TLS হ্যান্ডশেক ০.৩৩ s → ০.০৬ s), স্ট্যাটিক JS **১১২ KB → ০.১৩ s, এজ থেকে**।
> সবকিছু `tools/cloudflare-setup.py` দিয়ে বসানো হয়েছে — dry-run দেখিয়ে, তারপর apply।

---

## ২. যা বসানো হলো (সব API দিয়ে, ড্যাশবোর্ডে হাতে কিছু করা লাগেনি)

**DNS**
| রেকর্ড | মান | অবস্থা |
|---|---|---|
| `A @` | 72.60.42.18 | Proxied ✅ (আগেই ছিল) |
| `CNAME www` | boostpay.online | Proxied ✅ |
| `A agent` | 72.60.42.18 | Proxied ✅ (আগেই ছিল) |
| **`A supportchat`** | 72.60.42.18 | **নতুন যোগ করা হয়েছে** (Cloudflare zone-এ রেকর্ডটাই ছিল না!) — Proxied ✅ |

**Zone settings**
| সেটিং | আগে | এখন | কেন |
|---|---|---|---|
| SSL/TLS | Full | **Full (strict)** | অরিজিন সার্ট Let's Encrypt, বৈধ ১৯ Jan 2027 পর্যন্ত — তাই strict নিরাপদ |
| Always Use HTTPS | off | **on** | যেকোনো http লিংক নিজে থেকে https |
| Min TLS | 1.0 | **1.2** | পুরোনো দুর্বল TLS বন্ধ |
| Browser Cache TTL | 4 ঘণ্টা | **Respect origin** | আমরা নিজেরাই `immutable` হেডার দিই — CF যেন তা না ভাঙে |
| Rocket Loader | off | **off (নিশ্চিত)** | চালু হলে React অ্যাপ ভাঙে — এটাই সবচেয়ে বড় ফাঁদ |
| HTTP/3, Brotli, WebSockets, IPv6 | on | on | কল (WS) ও দ্রুত ট্রান্সফার |
| 0-RTT | — | **off** | `POST /api/*` রিপ্লে-ঝুঁকি এড়াতে |

**Cache rules (৩টি)**
1. `starts_with(uri.path, "/api/")` → **Bypass** — এক ইউজারের ডেটা আরেকজনের এজে যাওয়া **অসম্ভব**।
2. `starts_with(uri.path, "/assets/")` → Cache, **Edge TTL ১ বছর**, browser TTL respect-origin।
3. `/`, `*.html`, `/sw.js`, `/manifest.webmanifest` → **Bypass** — নতুন বিল্ড সাথে সাথে পাওয়া যায়, PWA পুরোনো ক্যাশে আটকে থাকে না।

---

## ৩. মাপা ফল (আমার স্যান্ডবক্স → SJC এজ; ঢাকা থেকে ডাকার এজ আরও কাছে)

| রুট | Cloudflare-এর আগে | এখন | ملاحظة |
|---|---|---|---|
| `GET /api/health` | ০.৪৯ s (TLS ০.৩৩ s) | **০.৩০ s** (TLS ০.০৬ s) | ~৪০% দ্রুত |
| `GET /` (index.html) | ০.৫২ s | **০.৩১ s** | DYNAMIC = ক্যাশ হয় না (ঠিক আছে) |
| `GET /assets/index-*.js` | ০.৪৫ s (অরিজিন) | **০.১৩ s (HIT, এজ থেকে)** | প্রথমবার MISS ১.৫ s (এজ অরিজিন থেকে তুলছে), তারপর HIT |
| `GET /api/db?slim=1` | — | ০.৩২ s, **DYNAMIC** | ক্যাশ হচ্ছে না ✅ |
| `GET /sw.js`, `/manifest` | — | ০.৩১ s, **DYNAMIC** | পুরোনো SW আটকে থাকবে না ✅ |
| `http://` → `https://` | 301 | 301 (একবারই, **লুপ নেই**) | ✅ |
| `supportchat.boostpay.online` | — | ২০০, `server: cloudflare` | ✅ |

---

## ৪. যা এখনো বাকি — ১টি সার্ভার সেটিং (আপনার অনুমোদন দরকার)

**`TRUST_CF_IP=1`** (env) — কোডটা আগের commit-এ (`785dc8a`) ঢোকা আছে, ডিফল্ট **বন্ধ**।

- **সমস্যা:** CF চালু হওয়ায় সার্ভার এখন সব ইউজারের বদলে **CF এজের আইপি** দেখছে। আমাদের antifraud/লগইন-স্প্যাম কাউন্টার **per-IP**, তাই একজনের গোলমালে পুরো অঞ্চলের ইউজার ব্লক হয়ে যেতে পারে — এটা এড়ানো **দরকার**।
- **সমাধান:** env-এ `TRUST_CF_IP=1` দিলে `cf-connecting-ip` (CF-এর দেওয়া আসল ইউজার আইপি) ব্যবহার হবে, নকল হেডার CF নিজেই মুছে দেয়।
- **সীমা (সৎভাবে):** কেউ Cloudflare বাইপাস করে সোজা `72.60.42.18`-এ হিট করে হেডার নকল করলে ভুল আইপি দেখাতে পারে। সম্পূর্ণ ঠেকাতে **Authenticated Origin Pulls** বা ফায়ারওয়ালে শুধু CF রেঞ্জ — দুটোই আপনার নিয়ম অনুযায়ী অনুমোদন ছাড়া আমি করব না (আর sslip.io ফলব্যাক হোস্টও ভেঙে যাবে)।
- **সিদ্ধান্ত:** চালু করব কি? রিস্টার্ট লাগবে (~১ মিনিট), ফিরিয়ে আনা এক env বদল।

---

## ৫. রোলব্যাক (যদি দরকার হয়)

| স্তর | কী করবেন |
|---|---|
| শুধু কিছুক্ষণ বন্ধ | Cloudflare → DNS → `A @` ও `supportchat`-এর **কমলা মেঘ ধূসর** করুন (proxy off, ~১ মিনিট) |
| পুরো CF বাদ | Hostinger → Nameservers → `helios/aster.dns-parking.com` (~৫ মিনিট) |
| ক্যাশ পরিষ্কার | CF → Caching → Purge Everything |
| Rocket Loader দুর্ঘটনায় চালু হয়ে গেলে | Speed → Rocket Loader **off** → Purge |

সার্ভার কোড, ডেটা, ডেটাবেস — কোনোটাই বদলায়নি; CF শুধু সামনের স্তর।

---

## ৬. নিরাপত্তা ও টোকেন

- টোকেন শুধু environment variable দিয়ে স্ক্রিপ্টে গেছে — **কোথাও ফাইলে লেখা হয়নি, লগে ছাপা হয়নি**।
- কাজ শেষ — **এখনই Cloudflare → My Profile → API Tokens → ওই টোকেনটি Delete/Revoke করুন**। পরে আবার লাগলে নতুন বানালেই হবে।
- স্ক্রিপ্ট: `tools/cloudflare-setup.py` (ডিফল্ট dry-run; `status / dns / settings / rules / verify`) — ভবিষ্যতে নিজেও চালাতে পারবেন।

---

## ৭. পরের ধাপ

1. **`TRUST_CF_IP=1` চালু করব?** (আপনার হ্যাঁ/না)
2. চাইলে আমি আরও দুটো ছোট কাজ করে দিতে পারি: `/api/mobile/hosts`-এ CF-হোস্টকে `primary` রাখা, আর CF এজে `supportchat`-এর জন্যও একই ক্যাশ নিয়ম যাচাই (এখন সেটাই ডিফল্টে আছে — ২০০ পাচ্ছে)।
3. পরে চাইলে: **Authenticated Origin Pulls** (অরিজিন শুধু CF থেকে গ্রহণ করবে — স্পুফিং পুরো বন্ধ), অথবা অরিজিন-IP সম্পূর্ণ গোপন করতে **Cloudflare Tunnel**।
