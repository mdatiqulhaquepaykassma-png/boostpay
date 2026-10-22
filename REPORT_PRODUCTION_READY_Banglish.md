# BoostPay — Production Ready Fix (Banglish Report)

Date: 2026-10-20 | Commit: `5711e7a` | Prev pool commit: `6362e01`

## Ki leak chilo?
- Screenshot e dekhacchilo `Code sent to inbox (demo: 200351)` — OTP API response e `token/debugToken=code` leak korto, abar Inbox `pushNotification` e `Your code: 200351` + metadata te code jaito. Demo mode er moto.
- `AuthGate` modal chilo kintu Sign In page e **Forgot password?** link chilo na — user click korte parto na.
- `SettingsModal` e `demo: 123456` dekhaito, `MessengerView` e `demo nearby` lekha chilo.

## Ki fix kora hoise?

### 1) Backend `server.ts` — OTP ar API te leak bondho
- `POST /api/users/forgot-password`:
  - Age: `res.json({token: code, debugToken: code,...})` + `pushNotification(... Your code: ${code})`
  - Ekhon: `await sendMail(email, 'Password Reset Code', htmlWithCode)` → Gmail SMTP pool (round-robin 500/day auto failover). `res.json({success:true, message:'Reset code sent to your email. Please check inbox/spam folder.'})` — **kono token/code API te nai**. Inbox notification ekhon shudhu generic fallback jodi `mailRes.ok===false` + `fallbackToInbox !== false` hoy: `Email delivery failed... contact support` — kono code nai.
- `POST /api/users/me/verify-email`:
  - Age: `debugCode: code` + `pushNotification(... code)` always
  - Ekhon: email-only via `sendMail`, fallback inbox shudhu fail hole, `res.json({success:true, message:'Verification code sent to your email. Please check inbox/spam.'})`

### 2) Frontend `AuthGate.tsx`
- `handleForgotRequest` success msg change: `Code sent to your email. Please check inbox/spam folder.` (token ar use nai)
- `store.ts` `forgotPassword` / `requestVerifyEmail` return type theke `token/debugCode` sorano — backward compat kintu ar expose kore na.
- Sign In form er **Sign In to Wallet** button er niche `Forgot password?` link add — click korle modal khule (`setShowForgot(true)`), Email → Code → New Password flow.
- Modal footer text change: `Code sent to your email inbox. Check spam folder if not found.` (demo word bad)

### 3) `SettingsModal.tsx` + `MessengerView.tsx`
- `Code sent to inbox (demo: ...)` → `Code sent to your email. Check inbox/spam.`
- `Users near you (random sample — demo nearby).` → `Users near you`

### 4) SMTP Pool ager motoi ache (production)
- Unlimited Gmail add via `POST /api/admin/smtp/accounts` — pool round-robin, daily 500/account, quota sesh hole auto next account e failover (Gmail error `quota/limit/quotaExceeded/too many` detect).
- Rate-limit: per-email 3 req / 15min, per-IP 20/hr → `429 + Retry-After` headers.
- Gmail 465 SSL `nodemailer`, HTML code design (monospace 22px gold/green), `smtpDayKey()` daily reset UTC.
- Admin panel `Email / SMTP` tab (admin-app) monitoring: live accounts, dailyCount/500 progress, totalSent/Failed, byDay chart, Enable toggle, Reset Daily, Add/Remove, Test Email, config editor + fallbackToInbox switch + easy setup guide.

## Build & Deploy
- `npx tsc --noEmit` main ✅ admin ✅
- `npm run build` main `335.66 kB (gzip 97.57)` admin `444.32 kB` — bundle leak 0 (user app e admin link nai)
- `git push` ff-only success `6362e01..5711e7a` via `boostpay_deploy` key — Dokploy auto-rebuild trigger hoise, `docker logs boostpay-l2q4ry` e `[SMTP] ready joypaykassma@gmail.com via smtp.gmail.com:465` already dekha gese, next image e leak-free OTP asbe.

## Kivabe test korben?
1. Sign In page → **Forgot password?** → email din → `Send Reset Code` → toast `Code sent to your email...` dekhabe, kintu API response e code thakbe na (Network tab e check korle `message` only).
2. Email inbox e HTML code asbe (gold box). Inbox tab e kono code jabe na — jodi SMTP fail hoy tahole generic `Email delivery failed` notification jabe.
3. Settings → Verify Email → same behavior.
4. Admin → Email / SMTP → Add Account (appPassword 16char no space), Test kore dekhun, byDay stats barbe.

## Baki security mone rakhben
- `data/` DB gitignored — kokhono `checkout -- data/...` korben na.
- VPS SSH `root@72.60.42.18` key `~/.ssh/boostpay_vps`, deploy key `boostpay_deploy`.
- Header logo only, bottom nav inbox nai, ID top-right e, compounding rate secret, leaderboard 10-sliding no total count — sob ager moto thik ache.
