# BoostPay — Promotional & Referral Management System (PWA)

Standalone app → **promotion.boostpay.online** (its own Dokploy application).

* Own login screen, same admin credentials as the BoostPay console (validated by
  `POST /api/admin/login` on the main API).
* Screens: Campaigns (dashboard) · Campaign editor · Fraud reviews · Leaderboard · Grants.
* PWA: `manifest.json` + `sw.js` (shell cache only — `/api` is never cached, money
  data must always be live). Installable on Android/Chrome and iOS/Safari
  ("Add to Home Screen").
* This app holds **no keys and no database**: it is a UI over
  `/api/admin/promo/*`, `requireAdmin + requireSuperAdmin` guarded, every write
  audit-logged on the main API.

## Local
```bash
cd promo-app
npm install --legacy-peer-deps
npm run build
PORT=3903 API_PROXY_TARGET=http://127.0.0.1:3901 npm start   # http://127.0.0.1:3903
```

## Deploy (Dokploy, new application in the boostpay project)
1. New Application → source: same GitHub repo, **Base directory: `promo-app`**
   (or Dockerfile path `promo-app`), build with its `nixpacks.toml`:
   `bun install` → `bun run build` → `bun run start`.
2. Environment:
   - `PORT=3000`
   - `API_PROXY_TARGET=http://<main-api-service>:3000`
   (the console proxies every `/api/*` call to the main API, so the browser only
   ever talks to one origin and no CORS rule is needed).
3. Domains → add `promotion.boostpay.online`, enable HTTPS (Let's Encrypt).
4. Cloudflare DNS: `A promotion` → the Dokploy server IP, **proxied (orange)**,
   SSL mode Full (strict), always-use-HTTPS on. Optional: Cloudflare Access on
   this host so it is not public.
