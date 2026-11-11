# REPORT 72 — Wallet Agent-এর details এখন দুই প্যানেল থেকেই এডিট (Admin + Management)

তারিখ: 2026-11-11 · কমিট: `50cb027` · সার্ভার: `72.60.42.18` (Dokploy, autoDeploy on push)

## 1. আপনি যা চেয়েছিলেন

> "management.boostpay.online থেকে agent er details edit kora jabe — agent er name etc change kora jabe, admin panel theke and management theke."

হয়ে গেছে। **নাম, লগইন ইমেইল, পাসওয়ার্ড, country+method (scope) এবং enable/disable** — এই পাঁচটাই এখন দুটো জায়গা থেকেই বদলানো যায়:

| কী | Admin panel (`admin.boostpay.online` → Wallet Agents) | Management panel (`management.boostpay.online` → **Wallet** ট্যাব) |
|---|---|---|
| Name | ✅ inline "Edit details" | ✅ inline "Edit details" |
| Login email | ✅ | ✅ |
| Password | ✅ (নতুন পাসওয়ার্ড, খালি রাখলে অপরিবর্তিত) | ✅ (একই) |
| Country + payment method | ✅ দুটো select | ✅ দুটো select |
| Enable / Disable | ✅ | ✅ |
| **Create** | ✅ (শুধু admin) | ❌ (আপনার নির্দেশ অনুযায়ী) |
| **Delete** | ✅ (শুধু admin) | ❌ |

Management প্যানেলের Wallet ট্যাবে সার্চ করা যায় নাম/ইমেইল/মেথড/দেশ/ID দিয়ে; প্রতিটি কার্ডে দেখা যায় — নাম, ইমেইল, `BD · bKash`, ACTIVE/DISABLED, কতগুলো deposit/withdraw এখনো pending, last sign-in, মোট decision। সাথে "Copy email" আর "Refresh"।

## 2. টেকনিক্যাল (একই কোড, দুই দরজা)

- `server.ts`-এ নতুন `updateWalletAgentCore(db, agent, body, actor)` — একটাই ইমপ্লিমেন্টেশন, দুই রুট থেকে ডাকা হয়:
  - `PATCH /api/admin/wallet-agents/:id` (actor `admin`)
  - `PATCH /api/management/wallet-agents/:id` (actor `management:<id>`)
- নতুন `GET /api/management/wallet-agents` — এজেন্ট লিস্ট + pending deposit/withdraw কাউন্ট + `countries` ট্রি (কোন দেশে কোন মেথড)।
- যেসব নিয়ম সার্ভারে **জোর করে** বসানো (UI-তে নয়):
  - নাম খালি হলে → `400` (sanitize করা হয়, ৮০ অক্ষর)
  - ইমেইল ফরম্যাট ভুল → `400`; অন্য এজেন্টের ইমেইল → `409`
  - পাসওয়ার্ড ৮ অক্ষরের কম → `400`
  - যে মেথড ওই দেশে সাপোর্টেড না → `400`; মেথড অস্তিত্বহীন → `404`
  - **ইমেইল বা পাসওয়ার্ড বদলালে / disable করলে ওই এজেন্টের সব লাইভ সেশন সাথে সাথে রিভোক** (নতুন ক্রেডেনশিয়াল ছাড়া ঢোকা যাবে না)
  - প্রতিটা পরিবর্তন `WALLET_AGENT_UPDATE` নামে অডিট লগে যায়, `changes[]` রেসপন্সে ফেরত আসে
  - country/method বদলালে পুরোনো pending রিকোয়েস্ট আগের মেথডের সাথেই থাকে (টাকা নড়ে না)

## 3. টেস্টিং — `tools/walletagent-edit-check.py` → **26 pass / 0 fail**

লোকাল ফুল স্ট্যাক (root :3901, admin :3911, management :3931) চালিয়ে আসল ব্রাউজারে:

1. guard rails — ডুপ্লিকেট ইমেইল 409, ছোট পাসওয়ার্ড 400, ভুল দেশ+মেথড 400, খালি নাম 400
2. **admin console (1400px ব্রাউজার)**: Edit details খুলে নাম+ইমেইল বদল → লিস্টে নতুন ভ্যালু
3. **wallet-agent panel**: নতুন ইমেইলে লগইন হয়, পুরোনো ইমেইলে হয় না
4. **management API**: নতুন পাসওয়ার্ড সেট → পুরোনো সেশন ডেড, পুরোনো পাসওয়ার্ড ডেড, নতুন পাসওয়ার্ডে লগইন হয়
5. **management console (430px/mobile)**: লগইন → Wallet ট্যাব → এজেন্ট দেখা যায় → Edit details → নাম বদল → সেভ; panel-এ নতুন নাম দেখায়
6. management থেকে **Disable** → panel লগইন `403`
7. দুই কনসোলেই কোনো uncaught page error নেই

রিগ্রেশনও সবুজ: wallet-agent API 40/0 · panel UI 21/0 · admin→agent 12/0 · country UI 11/0 · payments 40 (no problems)।

স্ক্রিনশট: `report-assets/admin-walletagent-edit.png`, `report-assets/management-walletagent-edit.png`, `report-assets/management-walletagent-disabled.png`।

## 4. টেস্ট করার সময় যে বাগটা ধরা পড়ল (এবং ফিক্স হয়েছে)

Management কনসোলের Wallet ট্যাব **খালি দেখাচ্ছিল** ("No wallet-agent account yet") যদিও অ্যাকাউন্ট ছিল। কারণ: `loadWalletAgents()` mount-এই চলত, তখন টোকেন ছিল না → `401`; ট্যাব খোলার সময় আর কল হতো না। এখন টোকেন থাকলে এবং প্রতিবার Wallet ট্যাব খোলার সময় লোড হয়।

(নোট: management প্যানেলের ডিজাইনই এক-ডিভাইস — নতুন লগইন করলে আগের সেশন রিভোক হয়; টেস্ট স্ক্রিপ্টও সেই অনুযায়ী সাজানো।)

## 5. ডিপ্লয়

- GitHub-এ পুশ `e917f8f → 50cb027` (main)
- Dokploy autoDeploy (push trigger) — চারটি অ্যাপ `done`:
  - `boostpay` 21:56 · `BoostPay Management` 21:57 · `BoostPay Wallet Agent` 21:57 · `BoostPay Admin` 21:57 UTC
- লাইভ যাচাই:
  - `/api/health` চার ডোমেইনেই `200` `v1.2.1794434254`
  - `GET https://management.boostpay.online/api/management/wallet-agents` (টোকেন ছাড়া) → `401` ⇒ রুট লাইভ (আগে হলে 404)
  - management bundle-এ `WALLET-AGENT PANEL ACCOUNTS`, `Edit details`, `New password (min 8)` উপস্থিত
  - admin bundle-এও `Edit details` + `New password (blank = unchanged)` উপস্থিত

## 6. আপনি এখন যা করবেন

1. `https://management.boostpay.online` → লগইন → নিচের নেভে **Wallet** → যেকোনো এজেন্টে **Edit details** → নাম/ইমেইল/পাসওয়ার্ড/দেশ/মেথড বদলে **Save**।
2. পাসওয়ার্ড বা ইমেইল বদলালে এজেন্টের পুরোনো লগইন সাথে সাথে বন্ধ — নতুনটা তাকে জানিয়ে দিন।
3. এজেন্টকে সাময়িক বন্ধ করতে **Disable**; আবার চালু করতে **Enable**।
4. নতুন এজেন্ট বানানো বা ডিলিট করা এখনো শুধু admin panel থেকেই (`Wallet Agents` → Create / Delete)।
