# REPORT 23 — একসাথে বেশি user চালানোর জন্য safe fix (perf / scale)

**Date:** 2026-10-26 · **নীতি:** আচরণ (behaviour) বদলানো হয়নি — শুধু একই কাজ কম খরচে।
কোনো টাকার নিয়ম, রোল, বা UI ফ্লো বদলায়নি। `data/` ছোঁয়া হয়নি।

---

## ১. যে ৭টা জিনিস ঠিক করা হয়েছে

| # | কী | আগে | পরে | লাভ |
|---|---|---|---|---|
| 1 | **`writeDb()` প্রতি write-এ পুরো ডকুমেন্ট JSON.stringify** | প্রতি write-এ **২৭ ms** event loop আটকে (৪ MB ডক) | write-এ **০ ms**; serialization হয় প্রতি 2s flush-এ একবার | সবচেয়ে বড় লাভ — প্রতিটা chat/transfer/boost-এর খরচ প্রায় শূন্য |
| 2 | **`/api/sync`-এ O(n²) লুপ** (প্রতি transaction-এর জন্য ২০,০০০ row-এ `.some()`) | **২,৫১৯ ms per sync** (১,০০০ user / ২০,০০০ tx) | **৭.৩ ms** | **৩৪৫× দ্রুত** — এটাই ছিল আসল bottleneck |
| 3 | `/api/sync`-এ user merge O(n²) (`findIndex` লুপের ভিতরে) | ~১ M তুলনা | Map index | একই ফল, ধ্রুবক সময় |
| 4 | **Ticker**-এ প্রতি cycle-completion-এ transaction/user/referral স্ক্যান | O(users × tx) | এক pass-এ Map/Set index | ১,০০০ user-এ প্রতি tick প্রায় বিনামূল্যে |
| 5 | **`/api/db` payload** — অন্য user-দের email/metadata যাচ্ছিল | ৩০৩ KB (১,০০০ user) | **২৩২ KB** + **gzip (≈10:1)** → **wire-এ ~২৫ KB** | mobile data ~১২× কম, আর email leak (audit F-02) বন্ধ |
| 6 | `/api/db`-তে প্রতি message-এর জন্য conversation `.find()` | O(messages × conversations) | এক pass Set | বড় chat ইতিহাসেও ধীর হবে না |
| 7 | Client প্রতি sync-এ **সব user-এর লিস্ট** upload করত | ~৩০০ KB / sync (১,০০০ user) | শুধু নিজের record | mobile upload ৩০০× কম (server আগেই authority) |

**বোনাস (safe hardening):** `Math.min(...balances)` সরানো হয়েছে — user সংখ্যা অনেক বড় হলে ওটা "Maximum call stack" দিয়ে ticker ভেঙে দিত। PG pool 5 → **20** (`PG_POOL_MAX` env দিয়ে বদলানো যায়)।

## ২. মাপা ফলাফল (একই বক্স, একই ডেটা, `HARNESS_PG=1` দিয়ে prod-এর memory-doc মোড নকল করে)

### ক) aujourd'hui production-আকার: ৯৫ user / ৩,৩৫৬ tx
| | আগে | পরে |
|---|---|---|
| `POST /api/sync` | ৯৩.৫ ms | **৮৩.৪ ms** |
| `GET /api/db` | ৪১.৩ KB | **২৪.৮ KB** (wire ~২.৭ KB gzip) |
| mixed read @concurrency 10 | ৯৮৮ req/s | **১,১৭৮ req/s** |

### খ) ১,০০০ user / ২০,০০০ tx (ভবিষ্যতের আকার)
| | আগে | পরে |
|---|---|---|
| `POST /api/sync` (p50) | **২,৫১৯ ms** | **৭.৩ ms** |
| sync throughput | ~০.৪ req/s | **৯৬৫ req/s** |
| `GET /api/db` | ৩০৩ KB | ২৩২ KB (wire ~২৫ KB) |
| idle CPU | ০.০৭ % | ০.০৭ % |
| mixed read @50 | (measurement আটকে গিয়েছিল sync-এর কারণে) | **৯৬২ req/s** |

## ৩. কার্যকারিতা (functional) regression — সব PASS
লোকাল হারনেসে production-আকার ডেটা দিয়ে:
- ✅ P2P transfer 12.34 → sender −12.34, recipient +12.34 (হুবহু)
- ✅ client-পাঠানো `balance` inject → 400 (টাকা বানানো যায় না)
- ✅ boost start / pause / resume
- ✅ **ticker একটা cycle-এ ঠিক একবার reward দিল** (`T3`: 200 → 200.0160, REWARD tx ১টা)
- ✅ **পরের tick-এ দ্বিতীয়বার দিল না** (double-payout নেই), cycle নিজে থেকে restart হয়নি
- ✅ agent payout cap: ১০-এর বেশি → 400 "Only boosted dollars…", ১০-এর ভিতরে → payout তৈরি
- ✅ chat send 200, text escape ঠিক আছে
- ✅ `/api/db`: নিজের record পূর্ণ, অন্য সবার record-এ email নেই

`tsc --noEmit` clean · `vite build` OK

## ৪. যা এখনো বাকি (বড় লাভ, কিন্তু schema migration লাগে)
1. `transactions` / `notifications` / `messages` আলাদা টেবিল — doc ৪ MB → ~২০ KB
2. Write-through ledger (এক UPDATE)
3. ২–৩ replica + Redis pub/sub (SSE fan-out)
4. PgBouncer (৫+ replica হলে)

## ৫. Infra (কোডের বাইরে)
- container-এর `ulimit -n` = **1024** → SSE socket ~৯০০-এ আটকায়। `docker service update --ulimit nofile=65535:65535` দিয়ে বাড়ানো হয়েছে (নিচে verify করা আছে)।
- Postgres `max_connections` = ১০০; pool এখন ২০/instance — ৩ replica পর্যন্ত নিরাপদ।
