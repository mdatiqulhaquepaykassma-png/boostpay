# REPORT 74 — `walletagent.boostpay.online` থেকে Cloudflare Access সরানো হয়েছে

তারিখ: 2026-11-11 · নির্দেশ: **"cloudflareaccess.com লাগবে না"** · সার্ভার: `72.60.42.18`

## ১. কী হলো

`walletagent.boostpay.online`-এর সামনে থাকা **Cloudflare Access** (One-time PIN / `boostpay.cloudflareaccess.com` লগইন) সম্পূর্ণ **মুছে ফেলা হয়েছে**। এখন কোনো এজেন্ট `cloudflareaccess.com`-এ যাবে না — সরাসরি প্যানেলের নিজের লগইন পেজ পাবে।

| আগে | এখন |
|---|---|
| `https://walletagent.boostpay.online/` → **302** → `boostpay.cloudflareaccess.com` → ইমেইলে ৬ ডিজিট কোড → তারপর প্যানেল | `https://walletagent.boostpay.online/` → **200** → সরাসরি **BoostPay Wallet Agent** লগইন (ইমেইল + পাসওয়ার্ড) |
| নতুন এজেন্টের ইমেইল আলাদা করে Access-এ allow করতে হতো | অ্যাকাউন্ট বানালেই এজেন্ট ঢুকতে পারে — **কোনো বাড়তি ধাপ নেই** |
| `/api/health` বাইপাস অ্যাপ রাখতে হতো | বাইপাসের দরকার নেই, `/api/health` → 200 |

যা মুছে গেছে: Access app `BoostPay Wallet Agent` (`d305b772-…`, 24h session) + তার allow policy (`77986eec-…`), এবং বাইপাস app `BoostPay Wallet Agent — health (public)` (`4cad203e-…`)। অ্যাকাউন্টে এখন **০টি Access app** — `--verify`-এ প্রমাণ।

## ২. নিরাপত্তা — এখন কী আগলে রাখছে

Cloudflare Access ছিল প্যানেলের *সামনের* তালা; এখন সেই তালা প্যানেলের **নিজের ভেতরে**:

- ইমেইল + পাসওয়ার্ড লগইন (অ্যাডমিন শুধু ৮+ অক্ষরের পাসওয়ার্ড সেট করতে পারে)
- লগইন rate-limit (প্রতি মিনিটে সীমিত চেষ্টা) + ভুল ক্রেডেনশিয়ালে 401
- অ্যাকাউন্ট disable করা যায়; ইমেইল/পাসওয়ার্ড বদলালে বা disable করলে চলতি সেশন **সাথে সাথে বাতিল**
- টোকেন ছাড়া কোনো API খোলে না — deposit/withdraw দেখতে ও সিদ্ধান্ত দিতে `WALLET_AGENT` টোকেন লাগে
- এজেন্ট শুধু তার **এক দেশ + এক মেথড** দেখে (সার্ভার-সাইডে এনফোর্সড, UI-তে নয়)
- প্রতিটি সিদ্ধান্ত ও প্রতিটি অ্যাকাউন্ট-পরিবর্তন অডিট লগে (`WALLET_AGENT_REVIEW`, `WALLET_AGENT_UPDATE`)

## ৩. নতুন কমান্ড

```bash
# Access সরানো (এখন করা হয়েছে; আবার চালালে "nothing to remove")
CF_HOST=walletagent.boostpay.online sh tools/cf.sh --no-access

# ভবিষ্যতে আবার Access চালু করতে চাইলে (একই কমান্ড, idempotent)
CF_HOST=walletagent.boostpay.online sh tools/cf.sh --access --emails you@example.com

# কে কে ঢুকতে পারে / কোন অ্যাপ আছে দেখা
CF_HOST=walletagent.boostpay.online sh tools/cf.sh --verify
```

`--add-email` / `--remove-email` (গত ধাপে যোগ করা) এখন অপ্রয়োজনীয়, তবে ভবিষ্যতে Access ফিরিয়ে আনলে কাজে লাগবে।

Zero Trust org ও One-time PIN IdP অক্ষত আছে — অন্য কোনো হোস্টে Access দরকার হলে নতুন করে বানাতে হবে না।

## ৪. যাচাই (লাইভ)

| পরীক্ষা | ফল |
|---|---|
| `curl -I https://walletagent.boostpay.online/` | **200**, কোনো 302 নেই |
| পেজের টাইটেল | `BoostPay Wallet Agent` |
| স্ক্রিন (Playwright, 430px) | সরাসরি "Sign in with the account your administrator created for you" — EMAIL + PASSWORD + Sign in |
| `https://walletagent.boostpay.online/api/health` | `200 {"status":"ok","version":"v1.2.1794439958"}` |
| Access apps (API) | `[]` — শূন্য |
| `cf.sh --no-access` পুনরায় | `... no Access app on walletagent.boostpay.online — nothing to remove` |

স্ক্রিনশট: `report-assets/walletagent-login-no-access.png`

## ৫. টেস্ট (লোকাল ফুল স্ট্যাক)

wallet-agent API **40/0** · প্যানেল UI **21/0** · admin→panel **12/0** · edit details **26/0** — সব সবুজ। admin প্যানেলের টেক্সটও বদলানো হয়েছে: "Create an account"-এর নিচে এখন লেখা *"The panel has its own email + password login (no Cloudflare Access in front of it) — create the account, hand over the credentials and the agent can sign in right away."*

## ৬. ডকুমেন্ট হালনাগাদ

- `HOWTO_WALLET_AGENT_ACCOUNT_Banglish.md` — ধাপ ৪ (Access allow) বাদ, বদলে "আর কোনো বাড়তি ধাপ নেই"; ট্রাবলশুটিং টেবিলও আপডেট
- `CLOUDFLARE_ACCESS_SETUP_Banglish.md` — নতুন **§৬.১** (কী সরানো হলো, `--no-access`, ফেরানোর উপায়)
- `REPORT_71_WALLET_AGENT_Banglish.md` — উপরে হালনাগাদ নোট

## ৭. এখন এজেন্ট বানানোর পুরো প্রক্রিয়া (সংক্ষেপে)

1. `admin.boostpay.online` → **Wallet Agents**
2. name + login email + password (৮+) + Country + Payment method → **Create wallet agent**
3. এজেন্টকে লিংক + ইমেইল + পাসওয়ার্ড দিন
4. সে `https://walletagent.boostpay.online`-এ ঢুকে শুধু তার মেথড/দেশের deposit-Withdraw দেখবে — **আর কোনো কোড বা Access ধাপ নেই**
