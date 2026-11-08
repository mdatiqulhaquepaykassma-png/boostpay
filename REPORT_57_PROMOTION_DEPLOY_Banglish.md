# REPORT 57 — `promotion.boostpay.online` ডিপ্লয় (Dokploy, নতুন অ্যাপ)

তারিখ: 2026-11-08 · সার্ভার: `72.60.42.18` (srv2061595) · Dokploy v0.31.0

---

## ১. যা হয়েছে

| ধাপ | ফল |
|---|---|
| Dokploy-তে নতুন Application | **`BoostPay Promotion`** · id `PRMQlI6YijWJw` · appName `boostpay-promotion-h3i10` |
| সোর্স | একই GitHub রিপো `boostpay`, branch `main`, **buildPath `/promo-app`**, buildType **nixpacks** |
| পোর্ট | `3000` (কন্টেইনার), `PORT` ডিফল্টই ৩০০০ |
| API প্রক্সি | `http://boostpay-l2q4ry:3000` (Dokploy নেটওয়ার্কের ভেতরে, ব্রাউজার শুধু একই অরিজিনে কথা বলে) |
| Domain row | `promotion.boostpay.online` → app, port 3000, HTTPS, Let's Encrypt |
| Traefik রাউট | `/etc/dokploy/traefik/dynamic/boostpay-promotion-h3i10.yml` (web → https redirect + websecure) |
| সার্ভিস | `boostpay-promotion-h3i10` — **1/1 running**, লগ: `[boostpay-promotion] listening on :3000` |
| বিল্ড ফিক্স | প্রথম দুবার ক্র্যাশ: `server.ts` কমিট হয়নি, তারপর `express` ডিপেন্ডেন্সি বাদ ছিল — দুটোই ফিক্স করে পুশ করা হয়েছে (`d1a247a`, `0cbed99`) |
| ডক্টর | Dokploy DB-র pg_dump ব্যাকআপ: `/root/backups/dokploy-20261108-073225.sql` (লেখার আগে) |

## ২. এখনকার সত্যিকারের অবস্থা (হোস্ট-লেভেলে টেস্ট করা)

```
https://promotion.boostpay.online/            → 200  (PWA shell)
https://promotion.boostpay.online/manifest.json → 200
https://promotion.boostpay.online/api/health    → {"status":"ok","version":"v1.2.1794123714"}
https://promotion.boostpay.online/api/admin/promo/campaigns → 401 (সুরক্ষিত, ঠিক আছে)
POST /api/admin/login (ভুল পাসওয়ার্ড) → 401 (প্রক্সি কাজ করছে)
```

এখনো **DNS নেই** — তাই এই টেস্টগুলো `--resolve promotion.boostpay.online:443:72.60.42.18`
দিয়ে করা হয়েছে এবং TLS সার্টিফিকেট এখনো Let's Encrypt থেকে ইস্যু হয়নি (DNS ছাড়া হয় না)।

## ৩. আপনার হাত থেকে যা লাগবে (দুটোর যেকোনো একটা)

**A. আমি করে দিচ্ছি** — Cloudflare টোকেন দিলে (`Zone:DNS:Edit` + `Account:Access: Apps and Policies:Edit`):

```bash
CF_API_TOKEN=<token> python3 tools/cf-access-promotion.py \
   --dns --target 72.60.42.18 \
   --access --emails you@example.com --domain boostpay.online
```
স্ক্রিপ্ট তিনটা কাজ করে: A record (proxied), Access application, allow-policy। টোকেন প্রিন্ট করে না।

**B. আপনি নিজে (২ মিনিট)**
1. Cloudflare → DNS → Add record: **A**, name `promotion`, IPv4 `72.60.42.18`, Proxy **Proxied**, TTL Auto.
2. Zero Trust → Access → Applications → Add self-hosted → domain `promotion.boostpay.online` → policy: Allow → Emails আপনি যাদের ঢুকতে দেবেন (One-time PIN দিয়েই চলবে)।
3. SSL/TLS mode: **Full (strict)**, Always Use HTTPS ON।

DNS বসার পর Traefik নিজে থেকেই Let's Encrypt সার্টিফিকেট নিয়ে নেবে (৩০–৬০ সেকেন্ড)।

## ৪. মনে রাখার নোট

- Dokploy UI-তে অ্যাপটা এখন "BoostPay Promotion" নামে boostpay প্রজেক্টে দেখা যাবে — ওখান থেকেই Logs/Deploy/Env সব করতে পারবেন।
- `autoDeploy` চালু রাখা হয়েছে এবং domain row ডাটাবেসে আছে, তাই **পরের push-এ Dokploy নিজেই traefik config নতুন করে লিখবে** (আমার হাতে লেখা `...-h3i10.yml`-টা তখন replace হবে — এটাই কাম্য)।
- কনসোলের ভেতরে কোনো সিক্রেট নেই: শুধু `/api/admin/promo/*`-তে Bearer টোকেন পাঠায়, যা মূল API-তে `requireAdmin + requireSuperAdmin` দিয়ে যাচাই হয়।
- Telegram/নোটিফিকেশন কিছুই এই অ্যাপে যোগ করা হয়নি — শুধু কনসোল।

## ৫. রোলব্যাক (যদি দরকার হয়)

```bash
# অ্যাপ বন্ধ
docker service scale boostpay-promotion-h3i10=0
# সম্পূর্ণ মুছে ফেলা (DB)
docker exec <pgd> psql -U dokploy -d dokploy -c "delete from domain where \"applicationId\"='PRMQlI6YijWJw'; delete from application where \"applicationId\"='PRMQlI6YijWJw';"
rm /etc/dokploy/traefik/dynamic/boostpay-promotion-h3i10.yml
# ডক্টর DB রিস্টোর
docker exec <pgd> psql -U dokploy -d dokploy < /root/backups/dokploy-20261108-073225.sql   # শুধু জরুরি হলে
```
