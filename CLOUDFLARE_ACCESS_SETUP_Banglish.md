# Cloudflare — স্থায়ী অ্যাক্সেস (একবার টোকেন, বারবার আর লাগবে না)

তারিখ: 2026-11-11 · কমিট `0e9d40f` · হেল্পার: `tools/cf.sh`, `tools/cf-token-save.sh`

---

## ১. কী বানানো হলো

| ফাইল | কাজ |
|---|---|
| `tools/cf.sh` | সব Cloudflare কাজের এক দরজা। টোকেন তিন জায়গা থেকে খোঁজে: (১) `CF_API_TOKEN` env → (২) **`/home/user/.cloudflare/api_token`** (লোকাল ভল্ট) → (৩) **VPS-এর `/root/.cloudflare/api_token`** (ssh দিয়ে পড়ে) |
| `tools/cf-token-save.sh` | টোকেন একবার লিখে রাখে — ইনপুট hidden, echo হয় না, shell history-তে যায় না, ফাইল **mode 600**, আর রিপো-র **বাইরে** থাকে |
| `tools/cf-access-promotion.py --full` | এক কমান্ডে: grey-cloud A রেকর্ড → সার্টিফিকেটের জন্য অপেক্ষা → Proxy ON → Access app + Allow policy |

টোকেন কখনো প্রিন্ট হয় না, কখনো `git`-এ যায় না — `.gitignore`-এ `.cloudflare/`, `api_token`, `*.cf-token` যোগ করা আছে, আর আসল ফাইলটা রিপো ফোল্ডারেরও বাইরে।

## ২. টোকেনটা কোথায় রাখব — ২টি উপায় (দুটোই একবারের কাজ)

### উপায় A — আপনার VPS-এ (সবচেয়ে স্থায়ী, স্যান্ডবক্স রিসেটেও টিকে থাকে)

VPS-এ একবার চালান (আপনি নিজে, ssh দিয়ে):

```bash
mkdir -p /root/.cloudflare && chmod 700 /root/.cloudflare
printf '%s' 'PASTE_TOKEN_HERE' > /root/.cloudflare/api_token
chmod 600 /root/.cloudflare/api_token
```

এরপর আমি কোনোদিন টোকেন চাইব না — `tools/cf.sh` নিজেই ssh দিয়ে পড়ে নেবে
(`credential=server:root@72.60.42.18:/root/.cloudflare/api_token` — এই লেখাটাই প্রমাণ)।

### উপায় B — এই ওয়ার্কস্পেসে (আজকের সেশন/কথোপকথনে স্থায়ী)

শুধু একবার চ্যাটে টোকেনটা দিন, আমি এই কমান্ড দিয়ে সেভ করব:

```bash
printf '%s' '<token>' | sh tools/cf-token-save.sh   # → /home/user/.cloudflare/api_token (600)
```

সতর্কতা: একেবারে নতুন কোনো কথোপকথন (নতুন স্যান্ডবক্স) শুরু হলে লোকাল ভল্টটা থাকবে না —
তাই **A + B দুটোই** রাখলে সবচেয়ে নিরাপদ।

## ৩. টোকেনটা কীভাবে বানাবেন (২ মিনিট)

Cloudflare → My Profile → **API Tokens** → Create Token → **Custom token**:

| Permission | Scope |
|---|---|
| Zone → **DNS** → Edit | `boostpay.online` |
| Zone → **Zone** → Read | `boostpay.online` |
| Account → **Access: Apps and Policies** → Edit | (পুরো অ্যাকাউন্ট) |

- **TTL: No expiry** (তাহলেই "বারবার টোকেন" সমস্যা শেষ)
- Zone Resources: Include → Specific zone → `boostpay.online`
- ইচ্ছা করলে একই টোকেনে `SSL and Certificates: Read` দিতে পারেন (সার্টিফিকেট স্ট্যাটাস দেখতে সুবিধা)

**যা দেওয়া যাবে না / লাগবে না:** Global API Key (পুরো অ্যাকাউন্টের চাবি), Account:Edit, Billing — এসব লাগবে না, দেবেন না।

## ৪. একবার টোকেন পেলে আমি যা চালাব (walletagent-এর জন্য)

```bash
CF_HOST=walletagent.boostpay.online CF_APP_NAME="BoostPay Wallet Agent" \
sh tools/cf.sh --full --target 72.60.42.18 --emails <আপনার ইমেইল>
```

ভেতরে যা হয়:
1. `A walletagent → 72.60.42.18` **grey cloud** (নাহলে প্রথম সার্টিফিকেটে 526)
2. `https://walletagent.boostpay.online/api/health` = 200 না হওয়া পর্যন্ত পোল (সর্বোচ্চ ৪ মিনিট)
3. সফল হলেই **Proxy ON (orange)**
4. **Access app** (`self_hosted`, 24h session) + **Allow policy** (আপনার ইমেইল → One-time PIN)
5. লাইভ ভেরিফাই: `/` = 200, `/api/health` ok, `/api/walletagent/me` = 401

## ৫. ভবিষ্যতে নতুন হোস্ট (একই টোকেনেই)

```bash
CF_HOST=<new-host>.boostpay.online CF_APP_NAME="BoostPay <Name>" \
sh tools/cf.sh --full --target 72.60.42.18 --emails <আপনার ইমেইল>
# শুধু proxy বদলাতে:
CF_HOST=... sh tools/cf.sh --proxied      # orange
CF_HOST=... sh tools/cf.sh --no-proxied   # grey
```

## ৬. যা ইতিমধ্যে করা হয়েছে (2026-11-11)

| ধাপ | ফল |
|---|---|
| ভল্ট | Global API Key পেয়ার (`/home/user/.cloudflare/api_email` + `api_key`, 600) — `cf.sh` এখন key-first |
| যাচাই | `--verify`: user, account, zone `boostpay.online`, SSL mode `strict` — সব OK |
| DNS | `A walletagent → 72.60.42.18` (grey) → সার্টিফিকেট → **Proxied ON** |
| Zero Trust | `POST /accounts/{id}/access/organizations` → **চালু** · `auth_domain = boostpay.cloudflareaccess.com` |
| IdP | **One-time PIN** তৈরি (`onetimepin`) — ইমেইলে কোড যায় |
| Access app | `BoostPay Wallet Agent` (`walletagent.boostpay.online`) · 24h session |
| Policy | Allow → `mdatiqulhaquepaykassma@gmail.com` (নতুন ইমেইল যোগ করতে: `sh tools/cf.sh --access --emails <ইমেইল>`) |
| বাইপাস | `walletagent.boostpay.online/api/health` → **bypass** (uptime monitor/login ছাড়া) |

⚠️ Cloudflare error 9999 `access.api.error.not_enabled` আসলে সমাধান `--full` নয়, বরং org তৈরি করা — `cf.sh --full` এখন আগে সেটাই চেষ্টা করে, না হলে স্পষ্ট মেসেজ দেয়।

## ৭. টোকেন বাতিল করতে চাইলে

Cloudflare → API Tokens → ওই টোকেনের **Roll** (নতুন টোকেন, পুরনো সাথে সাথে মৃত) বা **Delete**।
তারপর VPS-এর ফাইলটা মুছে দিন: `rm -f /root/.cloudflare/api_token` — ব্যস, আমার কাছে আর কোনো অ্যাক্সেস নেই।
