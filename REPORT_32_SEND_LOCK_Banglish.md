# REPORT 32 — Admin panel: "Sent Money Temporary Lock" (ইউজারভিত্তিক)

**তারিখ:** 2026-11-01 · **কোথায়:** Admin console → Users → **Manage** → **Sent Money Lock** কার্ড (ডেস্কটপে চতুর্থ অপারেশন কার্ড, মোবাইলে Manage → **Money** ট্যাবের একদম উপরে)

---

## ১. যা যা করা যায়

| অপশন | ফলাফল |
|---|---|
| **Hold an amount** ($ লিখে) | শুধু ওই অ্যামাউন্ট আটকে থাকবে — বাকি টাকা দিয়ে ইউজার **সেন্ড করতে পারবে**। যেমন ব্যালেন্স $100, hold $30 → ইউজার সর্বোচ্চ $70 পাঠাতে পারবে |
| **Full lock** | **সেন্ড করা সম্পূর্ণ বন্ধ** — P2P ট্রান্সফার ও "Pay an Agent" দুটোই আটকে যাবে |
| **Release** | লক তুলে দেওয়া — সাথে সাথে আবার সেন্ড করা যাবে |
| **Reason** (ঐচ্ছিক) | শুধু অ্যাডমিন দেখে (ইউজার দেখে না, DB Studio-তে দেখা যায়) |

কার্ডে লাইভ দেখা যায়: **Balance · Held (locked) · Can still send** — আর ইউজার লিস্টে পাশে ছোট চিপ: `🔒 HOLD $30.00` বা `🔒 SEND LOCKED`।

## ২. লক কার্যকর হয় কোথায় (সার্ভারে জোরপূর্বক)

* `POST /api/transfer` — P2P সেন্ড
* `POST /api/user/send-to-agent` — Pay an Agent (অ্যামাউন্ট + ফি দুটোই হিসাবে ধরা হয়)

ইউজারের অ্যাপ থেকে কোনোভাবে বাইপাস করা যায় না — অ্যাপ শুধু নোটিশ দেখায়, চেক সবসময় সার্ভারে হয়।
**লক করে রাখলে যা বন্ধ হয় না:** টাকা **রিসিভ** করা, boost চালানো, অ্যাডমিনের ক্রেডিট/ডেবিট, চ্যাট, কল।

ইউজারের Wallet-এ ছোট কমলা নোটিশ আসে:
> 🔒 `$30.00 of your balance is temporarily held by support. You can send up to $70.00.`
> (full lock হলে: *"Sending money is temporarily locked by support."*)

সেন্ড করতে গেলে সার্ভারের বার্তা:
> `$30.00 of your balance is temporarily held by administration. You can send up to $65.00 right now.`
> full lock: `Sending money is temporarily locked on this account by administration. Please contact support.`

## ৩. যাচাই — **২০/২০ PASS** (লোকাল, আসল API)

```
PASS  admin MFA unlock (console-এর মতোই setup → verify → token)
PASS  before any lock a transfer works
PASS  admin can hold an amount — sendable=$65
PASS  sending above the sendable amount is refused — 403 "$30.00 … You can send up to $65.00"
PASS  the refused transfer did not move money
PASS  the rest of the balance can still be sent
PASS  the user sees the held amount + what they can send — {"full":false,"amount":30,"sendable":60}
PASS  pay-an-agent also respects the hold
PASS  admin can apply a full lock — sendable=$0
PASS  full lock blocks every transfer — 403 "Sending money is temporarily locked…"
PASS  full lock blocks pay-an-agent too — 403
PASS  money can still be RECEIVED while locked
PASS  release restores sending — transfer=200
PASS  lock amount above balance refused (400) · zero/negative refused (400)
PASS  unknown user 404 · bad mode 400 · a normal user cannot lock anyone (401)
PASS  admin user list carries the lock + sendable balance
RESULT 20 pass / 0 fail
```
`tsc` + `vite build` (user ও admin app) ক্লিন।

## ৪. ✅ MFA (আপনার নির্দেশে সরানো হয়েছে)

**এই নির্দিষ্ট অ্যাকশনটা এখন MFA-মুক্ত** (আপনার অনুরোধে): শুধু লগইন করা SUPERADMIN হলেই লক দেওয়া/তোলা যাবে, কোনো ৬ ডিজিট কোড/৫ মিনিট আনলক লাগবে না।

🔒 **বাকি টাকা-সংক্রান্ত অ্যাকশনগুলো আগের মতোই MFA-সুরক্ষিত** — treasury Credit/Debit, Freeze, Delete, Backup restore। (যাচাই করা: `/api/admin/adjust` এখনো `428 MFA setup required` দেয়।) প্রতিটি লক-পরিবর্তন **audit log**-এ (`USER_SEND_LOCK`) লেখা থাকে — কে, কখন, কত আটকেছে।

## ৪ক. Pay an Agent-এও একই লক

* সার্ভারে `POST /api/user/send-to-agent`-এ লক আগেই চেক হতো; এখন **boost-নীতির আগেই** চেক হয়, তাই বার্তাটা সঠিক কারণ দেখায়:
  * `$60.00 of your balance is temporarily held by administration. You can send up to $40.00 right now.`
  * full lock: `Sending money is temporarily locked on this account by administration. Please contact support.`
* ইউজারের **Pay an Agent স্ক্রিনেও** এখন কমলা ব্যানার: `🔒 Temporarily held by support — $x held, you can still send up to $y` (বা full lock-এ *"Sending locked by support"*), আর অ্যামাউন্ট লিখে Submit চাপলে একই ভাষায় ব্লক হয়।
* boost-এর নিয়ম (শুধু boost-প্রফিট তোলা যাবে) আগের মতোই অপরিবর্তিত — লক তার **উপরে** কাজ করে।

## ৫. কোড

| ফাইল | কী |
|---|---|
| `server.ts` | `sendLockOf / sendableBalance / sendLockError` হেল্পার · `POST /api/admin/users/send-lock` (`requireSuperAdmin` + `requireMfa` + audit log `USER_SEND_LOCK`) · `/api/transfer` ও `/api/user/send-to-agent`-এ এনফোর্সমেন্ট · `adminUserView`-এ `sendLock` + `sendableBalance` · `publicUser`-এ ইউজারের নিজের `sendLock {full, amount, sendable}` |
| `admin-app/src/components/SendLockCard.tsx` (নতুন) | লক সেট/রিলিজ কার্ড (ডেস্কটপ + মোবাইল Money ট্যাব) |
| `admin-app/src/services/store.ts` | `adminSetSendLock()` — freeze/treasury-র মতো একই admin+MFA হেডার ব্যবহার করে |
| `admin-app/src/components/AdminPortal.tsx` | কার্ড বসানো + ইউজার লিস্টে `🔒 HOLD / SEND LOCKED` চিপ |
| `src/components/WalletView.tsx` | ইউজারের Wallet-এ "temporarily held" নোটিশ |

**টাকার হিসাব, boost, commission — কোনো লজিক বদলানো হয়নি**; শুধু সেন্ডের আগে একটা চেক যোগ হয়েছে।

---

## ৬. 🚨 জরুরি — deploy যাচাই করতে গিয়ে ধরা পড়ল: `binanceusdtpay.io` domain এখন **suspend**

| প্রমাণ (read-only, RDAP + DNS) | মান |
|---|---|
| ডোমেইন | `binanceusdtpay.io` (registrar: **HOSTINGER**) |
| **status** | **`client hold`** + `client transfer prohibited` |
| শেষ পরিবর্তন | **2026-11-01 00:51 UTC** |
| মেয়াদ | 2027-10-20 (**মেয়াদ শেষ নয়**) |
| DNS | apex ও sub — দুটোই **NXDOMAIN** (কোনো রেকর্ড নেই) |

`client hold` = registrar নিজেই ডোমেইনটি DNS থেকে সরিয়ে দিয়েছে (সাধারণত abuse/ট্রেডমার্ক কমপ্লেইনের কারণে)। REPORT 31-এ যে ঝুঁকি লিখেছিলাম (§১ — নামে "binance" থাকা), ঠিক সেটাই ঘটেছে।

**তবে অ্যাডমিন কনসোল DOWN নেই** — প্রতিটি অ্যাপের একটা করে ফলব্যাক হোস্টনেম আছে:

| অ্যাপ | ✅ এখন কাজ করছে এমন লিংক | ❌ বন্ধ |
|---|---|---|
| **Admin** | **`https://admin.72-60-42-18.sslip.io`** | `admin.boostpay.binanceusdtpay.io` |
| Agent | `https://agent.72-60-42-18.sslip.io` | — |
| Management | `https://management.72-60-42-18.sslip.io` | — |
| DB Studio | `https://db.72-60-42-18.sslip.io` | — |
| User | `https://boostpay.online` | — |
| Support chat | `https://supportchat.boostpay.online` | — |

যাচাই: `admin.72-60-42-18.sslip.io` → **200**, `/api/health` → `v1.2.1793546017`, নতুন Send-Lock কার্ড ও `/api/admin/users/send-lock` বান্ডলে আছে, unauth কল **401** ✓ · ৭টি Swarm সার্ভিস **1/1**।

### স্থায়ী সমাধান (আপনার ২ মিনিট লাগবে)
1. **প্রথমে নতুন লিংকে অ্যাডমিন প্যানেল ব্যবহার করুন:** `https://admin.72-60-42-18.sslip.io` (সব ফিচার একই)।
2. **Hostinger DNS-এ একটা A রেকর্ড যোগ করুন** — `admin` → `72.60.42.18` (boostpay.online জোনে)। বলুন, তারপর আমি `admin.boostpay.online` Dokploy-তে যোগ করে Let's Encrypt সার্টিফিকেট নিয়ে দেব — তখন আর sslip.io লিংক লাগবে না।
3. **`binanceusdtpay.io` আর ফেরত আনার চেষ্টা না করাই ভালো** — নামেই "binance" থাকায় এটা বারবার কমপ্লেইনের লক্ষ্য হবে। Hostinger-কে একবার জিজ্ঞেস করতে পারেন `client hold` কেন (তারা নোটিশ/ইমেইল পাঠিয়ে থাকে, abuse@ inbox-এ উত্তর দিলে কখনো কখনো ছাড়ে), কিন্তু নতুন দরকারি হোস্টনেম হিসেবে `admin.boostpay.online`-ই ব্যবহার করুন।
4. মনে রাখুন: `boostpay.online` (মূল ডোমেইন) সম্পূর্ণ স্বাভাবিক — ইউজার, এজেন্ট, ম্যানেজমেন্ট, সাপোর্ট চ্যাট সবই চলছে।

---

## ৭. ২য় রাউন্ডের যাচাই — **৯/৯ PASS** (MFA-মুক্ত + Pay-an-Agent)

```
PASS  send lock works with NO MFA code/token                 status=200
PASS  response reports the hold + what is still sendable     held=$60 sendable=$40
PASS  Pay-an-Agent blocked when the amount eats into the held part
      → 403 "$60.00 of your balance is temporarily held by administration. You can send up to $40.00 right now."
PASS  a payment inside the sendable part still works         (200)
PASS  full lock blocks Pay-an-Agent                          → 403 "Sending money is temporarily locked…"
PASS  treasury adjust still requires MFA (nothing else loosened)   428
PASS  normal user still cannot lock (401)
PASS  release restores Pay-an-Agent (boost rules unchanged)   (200)
RESULT 9 pass / 0 fail
```
আগের পূর্ণ স্যুটও আবার চালানো হয়েছে — **২০/২০ PASS**।
