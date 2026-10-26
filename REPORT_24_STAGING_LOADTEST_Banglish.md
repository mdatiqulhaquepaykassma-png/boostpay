# REPORT 24 — Staging load test (আসল সংখ্যা কত?)

**তারিখ:** 2026-10-26 / 27 · **কোথায়:** আলাদা staging container (isolated), production স্পর্শ করা হয়নি
**কোড:** `65d727f` (fix-গুলো আগেই live) · **VPS:** 4 vCPU, 16 GB, একই বক্সে staging চালিয়ে মাপা

---

## ১. কীভাবে টেস্ট করা হয়েছে (method)

| বিষয় | কী করা হয়েছে |
|---|---|
| Environment | Prod-এর **একই Docker image**, কিন্তু আলাদা container + আলাদা port + **আলাদা database** (`boostpay_staging`)। Prod DB একবারও ছোঁয়া হয়নি। |
| ডেটা | Production-এর shape-ই ব্যবহার করা হয়েছে (asli `INITIAL_DB` থেকে field গুলো), কিন্তু **২,০০০ user / ৩০,০০০ transaction / ১,০০০ conversation / ১২,০০০ message** — অর্থাৎ প্রোডের (৯৬ user) প্রায় **২০ গুণ**। |
| Device সিমুলেশন | প্রতি virtual device-এর নিজের token **এবং নিজের IP** (`X-Forwarded-For`) দেওয়া হয়েছে, নইলে একটাই IP-এর 429 rate-limit মাপা হতো, সার্ভার নয়। |
| Asol client timing | `session` টেস্টে অ্যাপের **আসল poll interval**: `/api/db` ৬s, `/api/sync` ২০s, chat ৬s, leaderboard ১৫s |
| মাপা হয়েছে | client-side p50/p95/p99 + achieved req/s + **server container-এর CPU% ও RAM** (2 সেকেন্ড পরপর sample) |
| নিরাপত্তা | সব টেস্ট staging-এ; শেষে container **মুছে ফেলা হয়েছে**; prod এখনো `v1.2.1793031671`, ৫/৫ container Up |

Reproduce: `loadtest/README.md` + VPS-এ `/opt/bp-lt/` (স্ক্রিপ্ট সব ওখানে রাখা আছে)।

---

## ২. মূল ফলাফল — একটা বাক্যে

> **একটা container ≈ ১১০–১২০ req/s-এর বেশি পারছে না, আর ২,০০০ user-এর ডেটা নিয়ে এটা মানে — একসাথে "সক্রিয়" রাখা যায় মাত্র ~১২০–১৫০ জন user।**
> আগের রিপোর্টে যে ২,৫০০–৩,০০০ লেখা ছিল, সেটা **৯৬ user-এর ছোট ডেটায়** মাপা হয়েছিল — user সংখ্যা বাড়লে প্রতিটা request-এর খরচও বাড়ে (নিচে ৩ নম্বর টেবিল), তাই বাস্তব সংখ্যা অনেক কম।

### কেন? প্রতিটা request এখন **মোট user সংখ্যার উপর নির্ভরশীল**:
* `/api/db` প্রতিবার **পুরো user directory** (২,০০০ জনের slim projection) বানিয়ে পাঠায় → response ৩০ KB (gzip)।
* `/api/sync` প্রতিবার **৩০,০০০ transaction**-এর উপর Map + filter + sort বানায় — payload-এ একটা transaction না থাকলেও।
* চ্যাট poll-ও পুরো directory ফেরত দেয় → ২০০ KB/response।

---

## ৩. Endpoint-ভিত্তিক মাপ (২,০০০ user / ৩০,০০০ tx)

| Endpoint | ১টা request-এ CPU | Ceiling (এক container) | Response size |
|---|---|---|---|
| `/api/health` | ~০.৩ ms | **৩,২৭৫ req/s** | ০.১ KB |
| `/api/db` (অ্যাপের মূল poll) | **১২.৮ ms** | **৭০–৮৫ req/s** ⚠️ | ২৯.৮ KB (gzip) |
| `/api/sync` (POST) | **১৭–২০ ms** | **৫০ req/s** ⚠️ | ছোট |
| `/api/chat/messages` | ৪.০ ms | ২৯৩ req/s | **২০০ KB** ⚠️ |
| `/api/leaderboard` | ৩.৬ ms | ৪২২ req/s | ৩৮.৭ KB |
| `/api/chat/send` | ~১ ms | ৯৭৩ req/s | ০.৪ KB |
| `/api/transfer` (burst) | — | ৮৬৪ req/s (৩০০ ok, বাকি ৪০১ কারণ নিচে) | ০.৭ KB |
| `/api/users/login` | **~৪০ ms (scrypt)** | **২৫ req/s** | ০.৫ KB |

### একই কোড, ছোট ডেটা (২০০ user / ৩,০০০ tx) — তুলনা
| Endpoint | ২০০ user | ২,০০০ user | বাড়া |
|---|---|---|---|
| `/api/db` | ১.৯ ms (৪৪৪ req/s) | ১২.৮ ms (৭০ req/s) | **৬.৭×** |
| `/api/sync` | ১.৬ ms (৫৪১ req/s) | ১৮ ms (৫০ req/s) | **১১×** |
| `/api/chat/messages` | ০.৯ ms (৮৭৫ req/s) | ৪.০ ms (২৯৩ req/s) | **৪.৪×** |

**অর্থাৎ ১০ গুণ user = ~৭–১১ গুণ খরচ। এটাই আসল bottleneck — CPU নয়, architecture।**

---

## ৪. আসল ব্যবহারকারীর মতো টেস্ট (`session`)

২,০০০ user-এর ডেটা, আসল poll interval, প্রতিটা device আলাদা user+IP:

| একসাথে খোলা device | achieved | p50 | p95 | container CPU |
|---|---|---|---|---|
| ১০০ | ৫৩ req/s | **১৩.৯ ms** | ৪৬ ms | ~৪৫ % |
| ১৫০ | ৭৭ req/s | **৫১.৬ ms** | ৩৭২ ms | ~১০৫ % (এক core ভরে গেছে) |
| ২০০ | ১০৪ req/s | **৯৩.৪ ms** | ৪১১ ms | ~১১০ % |
| ২৫০ | ৯৮ req/s | **৩৬৯ ms** | ১,০৩৮ ms | ~১০৫ % |
| ৪০০ | ১১২ req/s | **৪০৬ ms** | **১৬.৬ সেকেন্ড** ❌ | ~১০۵ % |

**সিদ্ধান্ত:** ১০০ device → সব ঠিকঠাক। ১৫০-এ গিয়ে latency লাফ দেয়, ২০০+ এ ব্যবহারকারী "ধীর" মনে করবে, ৪০০-এ টাইমআউট।
**নিরাপদ সীমা (এই মুহূর্তে): ~১২০–১৫০ একসাথে সক্রিয় user / container (২,০০০ user-এর ডেটায়)।**

গণিত (per request ms × poll frequency):
`প্রতি device/মিনিট = 10×12.8 (db) + 3×18 (sync) + 10×4.0 (chat) + 4×3.6 (leaderboard) ≈ ২৩৪ ms`
`৬০,০০০ ms ÷ ২৩৪ ms ≈ ২৫৬ device / core` → বাস্তবে measured ~১৫০ (queueing + variance)।

---

## ৫. যা ভালো কাজ করছে ✅

| টেস্ট | ফল |
|---|---|
| **SSE (chat stream)** | **৪,০০০ লাইভ stream একসাথে — ০ ব্যর্থ**, health ২০০, RAM মাত্র **~২৪৬ MB** (≈২৪ KB/stream)। ulimit fix-এর পর socket আর বাধা নয়। |
| **Idle CPU** | ২,০০০ user + ২০০ চালু boost নিয়ে **০.১৪–০.৪১ %** (ticker একদম হালকা) |
| **টাকার হিসাব** (সবচেয়ে জরুরি) | ৩০০টা transfer একসাথে (concurrency ২০): প্রাপক **+৩০.০০ ঠিক Exact (৩০০ × ০.১)**, মোট balance **৫,০৫,৬২২.০৩ → ৫,০৫,৬২২.০৩ অপরিবর্তিত**, transaction +৬০০ (প্রতি transfer-এ ২টা: out+in) — **কোনো double-spend বা লিক নেই** |
| **Transfer limit** | ০.০১ পাঠালে সঠিকভাবে ৪০০ "Minimum transfer is 0.1" |
| **Boost** | ২০০টা boost একসাথে চালু — ২০০/২০০ OK, সব `isActive` |
| **Chat send** | ৪০০/৪০০ OK, p50 ১৩ ms |
| **429 / rate limit** | আলাদা IP+user হলে ঠিকঠাক কাজ করে (একই IP-তে করলে ধরা পড়ে — প্রত্যাশিত) |
| **Session/device cap** | লগইন করলে পুরোনো session সত্যিই revoke হয় (আমার টেস্টেই প্রমাণিত: ১০০ user-এর পুরোনো token 401 হয়ে গেল) |

---

## ৬. যে ৩টা জিনিস এখনই ঠিক করা উচিত (priority order)

| # | Fix | এখন | হওয়ার কথা | কেন safe |
|---|---|---|---|---|
| **A** | `/api/sync`: incoming payload-এ `transactions` না থাকলে ৩০,০০০ tx-এর Map/filter/sort বানানোই বন্ধ (এখন client শুধু নিজের record পাঠায়) | ১৮ ms | **~১ ms** | কোনো rule বদলায় না — যে payload-এ tx নেই, তার জন্য ওই merge-এর ফলাফল already শূন্য |
| **B** | `/api/db` ও চ্যাট poll-এ user directory-র slim projection **১ সেকেন্ড cache** (বা শুধু দরকারি peer + top-N leaderboard) | ১২.৮ ms | **~২ ms** | response-এর field একই থাকবে; boost yield-এ সর্বোচ্চ ১ সেকেন্ড পুরোনো সংখ্যা (চোখে ধরার মতো নয়) |
| **C** | লগইনে `scryptSync` → async `crypto.scrypt` | login-এ পুরো সার্ভার আটকে যায় (২৫ req/s) | ২৫ → ~২০০/s, অন্য user-রা freeze হবে না | হ্যাশ ফরম্যাট একই, শুধু non-blocking |

**A + B করলে প্রত্যাশিত:** per device ২৩৪ ms → ~৯০ ms ⇒ **~১৫০ → ৪০০–৬০০ সক্রিয় user / container** (৩–৪ গুণ, কোডের গঠন না বদলেই)।
**C** করলে লগইন-স্টর্ম বা "সবাই একসাথে সকালে ঢুকছে" পরিস্থিতিতেও কেউ আটকে থাকবে না।

**এর পরেও যা লাগবে (বড় স্কেলের জন্য):** এক প্রসেস = এক core। ৪ core ব্যবহার করতে চাইলে → `transactions/messages/notifications` আলাদা টেবিল (schema split) + write-through + একাধিক replica + Redis pub/sub (SSE-র জন্য sticky/রাউটিং)। ওটাই ১,৫০০–৩,০০০+ সক্রিয় user-এর রাস্তা।

---

## ৭. আগের রিপোর্টের সংশোধন (important)

`REPORT_23`-এ লেখা ছিল "খোলা app ২,৫০০–৩,০০০ / সক্রিয় user ৮০০–১,২০০"। সেটা **৯৬ user-এর prod-আকারের ডেটায়** মাপা হয়েছিল, আর "/api/db-এর খরচ মোট user সংখ্যার সাথে বাড়ে" কথাটা তখন ধরা পড়েনি।
এই লোড টেস্টে সেটা ধরা পড়েছে — তাই **সঠিক সংখ্যা: ~১২০–১৫০ সক্রিয় user / container (২,০০০ user base-এ)**, এবং SSE-এর দিক থেকে ৪,০০০+ কানেকশন (সেটা ঠিকই আছে)।
Fix A+B+C-এর পর ৪০০–৬০০; replica + schema split-এর পর হাজার-হাজার।

---

## ৮. Prod-এ কোনো প্রভাব পড়েছে কি?
* টেস্ট চলাকালীন prod-এ **কোনো write/test call যায়নি**।
* টেস্টের আগে-পরে prod health: `v1.2.1793031671`, চার portal একই version, ৫/৫ container Up, `ulimit -n = 65535` টিকে আছে ✅
* staging container + তার ২টা আলাদা DB এখন **বন্ধ/অপসারিত** (DB গুলো শুধু রেফারেন্সের জন্য রাখা, prod-এর সাথে সম্পর্ক নেই)।
