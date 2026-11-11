# REPORT 73 — Agent-এর details এখন Admin + Management দুই প্যানেল থেকেই এডিট (agent.boostpay.online)

তারিখ: 2026-11-11 · কমিট: `0af7a7b` · সার্ভার: `72.60.42.18` (Dokploy, push-এ autoDeploy)

## 1. আপনার নির্দেশ

> "management.boostpay.online থেকে agent er details edit kora jabe · agent.boostpay.online er details edit korte parbe · agent er name etc change kora jabe · admin panel theke and management theke."

এটা **agent-app অ্যাকাউন্ট** (যারা `https://agent.boostpay.online`-এ লগইন করে) — আগের রিপোর্টে যেটা করেছিলাম সেটা ছিল **wallet-agent** (`walletagent.boostpay.online`)। এবার দুটোই কভার হয়েছে:

| অ্যাকাউন্টের ধরন | লগইন করে | এডিট করা যায় এখন |
|---|---|---|
| **Wallet agent** (`WAG-…`) | `walletagent.boostpay.online` | ✅ admin + management (REPORT 72) |
| **Agent** (`AGT-…`) | `agent.boostpay.online` | ✅ admin + management (**এই রিপোর্ট**) |

## 2. Agent-এর কোন কোন ফিল্ড এডিট হয়

| ফিল্ড | Admin panel | Management panel | নিয়ম |
|---|---|---|---|
| Name | ✅ | ✅ | খালি করা যাবে না (সার্ভার 400) |
| Login email | ✅ | ✅ | শুধু `@gmail.com`; অন্য এজেন্টের ইমেইল হলে 409 |
| Password | ✅ | ✅ | কমপক্ষে ৬ অক্ষর; খালি রাখলে অপরিবর্তিত |
| Enable / Disable | ✅ | ✅ | disable করলে লাইভ সেশন সাথে সাথে বন্ধ |
| Owner (কোন management-এর এজেন্ট) | ✅ (Reassign) | ❌ | ইচ্ছাকৃতভাবে শুধু admin — management নিজের বা অন্যের নেটওয়ার্ক বদলাতে পারবে না |
| Create / Delete | ✅ (প্ল্যাটফর্ম এজেন্ট) | ✅ (শুধু নিজের নিচে তৈরি) | আগের মতোই |

**সেশন রিভোক:** ইমেইল বদলালে বা পাসওয়ার্ড বদলালে ওই এজেন্টের সব লাইভ `AGENT` সেশন সাথে সাথে বাতিল — তাই পুরোনো ট্যাব/ফোন থেকে আর কাজ চলবে না, নতুন ক্রেডেনশিয়াল ছাড়া লগইন হবে না। প্রতিটা পরিবর্তন `AGENT_UPDATE` নামে অডিট লগে যায় (`changes[]` রেসপন্সে কোন কোন ফিল্ড বদলেছে তা ফেরত আসে)।

## 3. কোথায় ক্লিক করবেন

**Admin:** `https://admin.boostpay.online` → **Agents & Management** → যেকোনো এজেন্ট কার্ডে (পাসওয়ার্ড লাইনের ডানে) **Edit details** → নাম / Login email / New password লিখে **Save** বা **Cancel**। (আগের `window.prompt` রিসেট বাটন বাদ — অ্যাডমিন বান্ডলে `window.prompt` এখন ০টি।)

**Management:** `https://management.boostpay.online` → **Agents** ট্যাব → এজেন্টে ট্যাপ (sheet খোলে) → **Edit details** → নাম / email / নতুন পাসওয়ার্ড → **Save**। সাথে আগের মতোই Fund agent / Collect / Show password / Disable agent account। সেভ করার পরে sheet নিজেই নতুন ডেটা দিয়ে রিফ্রেশ হয়।

## 4. টেস্টিং — `tools/agent-edit-check.py` → **31 pass / 0 fail**

লোকাল ফুল স্ট্যাক + আসল ব্রাউজারে:

- **Guard rails:** ডুপ্লিকেট ইমেইল 409 · ছোট পাসওয়ার্ড 400 · খালি নাম 400 · Gmail ছাড়া ইমেইল 400 · **অন্য management-এর এজেন্ট এডিট করতে গেলে 403**
- **Agent app ফলো করে:** পুরোনো ক্রেডেনশিয়ালে লগইন হয় → admin ইমেইল বদলালে লাইভ সেশন ডেড → পুরোনো ইমেইলে 401 → নতুন ইমেইলে একই পাসওয়ার্ডে লগইন হয় → প্রোফাইলে admin-এর দেওয়া নাম দেখায়
- **Management পাসওয়ার্ড:** নতুন পাসওয়ার্ড সেট → লাইভ সেশন ডেড → পুরোনো পাসওয়ার্ড 401 → নতুন পাসওয়ার্ডে লগইন 200
- **Admin console (1400px):** Agents list লোড → Edit details প্যানেল খোলে → নাম বদল → লিস্টে নতুন নাম
- **Management console (430px):** Agents ট্যাব → sheet → inline editor → নাম + পাসওয়ার্ড সেভ → sheet-এ নতুন নাম; ওই পাসওয়ার্ডে agent-app লগইন হয়; disable → 403
- দুই কনসোলেই কোনো uncaught page error নেই

রিগ্রেশন: **wallet-agent এডিট 26/0 · wallet-agent API 40/0 · payments ক্লিন**।

স্ক্রিনশট: `report-assets/admin-agent-edit.png`, `report-assets/management-agent-edit.png`, `report-assets/management-agent-disabled.png`।

## 5. লাইভ

- পুশ: `ebad434 → 0af7a7b` (main)
- Dokploy autoDeploy — চারটি অ্যাপ `done`: `boostpay` 23:00 · **BoostPay Management** 23:00 · **BoostPay Agent** 23:00 · **BoostPay Admin** 23:01 UTC
- `https://{boostpay.online, management, agent, admin}/api/health` → সব `200`, নতুন বিল্ড `v1.2.1794438088`
- লাইভ বান্ডেল যাচাই: management বান্ডেলে নতুন এডিটর টেক্সট আছে; **admin বান্ডেলে `window.prompt` = 0**, নতুন "Edit details" এডিটর আছে

## 6. সংক্ষেপে

- **wallet-agent** অ্যাকাউন্ট: admin + management দুটো থেকেই নাম/ইমেইল/পাসওয়ার্ড/country+method/enable এডিট (REPORT 72) — লাইভ
- **agent** অ্যাকাউন্ট (agent.boostpay.online): admin + management দুটো থেকেই নাম/ইমেইল/পাসওয়ার্ড/enable এডিট — লাইভ
- create/delete ও **owner reassign** শুধু admin; management শুধু নিজের নেটওয়ার্কের এজেন্ট এডিট করতে পারে
