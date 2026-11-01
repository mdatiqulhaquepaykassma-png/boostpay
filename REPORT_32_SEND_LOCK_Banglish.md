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

---

# ৮. 🆕 Pay an Agent Lock — আলাদা (স্বাধীন) temporary lock

আপনার নির্দেশ: **Manage → Pay an Agent-এর জন্য আলাদা temporary lock**, amount ধরে রাখা যাবে, full lock দিলে agent-কে টাকা দেওয়া বন্ধ, amount lock দিলে শুধু ওই অংশ আটকে বাকিটা যাবে।

## কীভাবে কাজ করে (দুইটা আলাদা লক, দুইটা আলাদা চ্যানেল)

| লক | কোথায় | কী বন্ধ করে | কী বন্ধ করে না |
|---|---|---|---|
| **Sent Money Lock** | Manage → *Sent Money Lock* কার্ড | শুধু **P2P (user→user) transfer** | agent payment, receive, boost |
| **Pay an Agent Lock** (নতুন) | Manage → *Pay an Agent Lock* কার্ড | শুধু **Pay an Agent** | P2P transfer, receive, boost |

* **Allowed per channel = balance − held.** উদাহরণ: ব্যালেন্স $100, agent lock $60 → ইউজার agent-কে সর্বোচ্চ **$40** দিতে পারবে, বাকি $60 আটকে থাকবে।
* **Full agent lock** → agent-কে এক পয়সাও দেওয়া যাবে না (`Payments to an agent are temporarily locked on this account by administration.`), কিন্তু P2P send আগের মতোই চলবে।
* দুইটাই **স্বাধীন** — একটা দেওয়া/তোলা করলে অন্যটা বদলায় না (টেস্টে প্রমাণিত)।
* 🔒 **নিরাপত্তার ওভারল্যাপ (জেনে রাখুন):** একটা **Sent Money** hold সক্রিয় থাকলে সেটা agent payment-কেও ক্যাপ করে (কারণ ওটা সাধারণ "বাইরে যাওয়া টাকা" ধরে রাখা)। তখন ইউজার যে মেসেজ দেখবে সেটা বলবে কোন লক) কারণে আটকেছে (`cause: "send"` vs `"agent"`)। চাইলে এই ওভারল্যাপটা পুরো বাদ দিয়ে দুইটাকে ১০০% আলাদা করে দিতে পারি — শুধু বলবেন।

## অ্যাডমিন কনসোলে

* **Manage → Money** (মোবাইল) এবং ডেস্কটপ Manage প্যানেলে এখন **দুইটা কার্ড**: *Sent Money Lock* + *Pay an Agent Lock*। দুইটাতেই — Balance / Held / Can still pay an agent, *Hold an amount*, *Full lock*, *Apply hold*, *Release*, আর internal note (ইউজার এই নোট দেখে না)।
* **User list**-এ এখন দুইটা চিপ: `🔒 HOLD $30.00` / `🔒 SEND LOCKED` (orange) এবং `🔒 AGENT HOLD $60.00` / `🔒 AGENT LOCKED` (magenta)।
* **MFA লাগে না** (আপনার আগের নির্দেশ মতো)। শুধু লগইন করা SUPERADMIN; প্রতিটি পরিবর্তন audit log-এ `USER_AGENT_LOCK` নামে লেখা হয়।

## ইউজারের অ্যাপে

* **Pay an Agent** স্ক্রিনে গোলাপি/ম্যাজেন্টা ব্যানার: *"Agent payments held by support — $60.00 is held for agent payments. You can still pay an agent up to $40.00."* (full lock হলে *"Agent payments locked"*)।
* ভুল অ্যামাউন্ট দিলে সাবমিটেই একই ভাষায় ব্লক, আর **Max** বাটন now hold-এর পরের সঠিক সংখ্যাটাই বসায়।
* Wallet-এও একটা ছোট গোলাপি লাইন যোগ হয়েছে (Send hold-এর নিচে)।
* boost-এর নিয়ম (শুধু boost-প্রফিট তোলা যাবে) অপরিবর্তিত — লক তার উপরে কাজ করে; Boost Pause নিয়মও আগের মতো।

## যাচাই — **২১/২১ PASS** (নতুন স্যুট, `/tmp/agent_lock_test.cjs`)

```
PASS  baseline: pay an agent works
PASS  agent lock applied with NO MFA code/token
PASS  card numbers: held $60, remainder = balance - 60  ($94.90 - 60 → $34.90)
PASS  paying more than the allowed part is refused (403)
      → "$60.00 of your balance is temporarily held for agent payments. You can still pay an agent up to $34.90."
PASS  refusal names the agent hold + the real remainder
PASS  refusal says which lock caused it (cause=agent)
PASS  a smaller agent payment inside the allowed part works
PASS  P2P transfer is UNAFFECTED by the agent lock            ← স্বাধীনতার প্রমাণ
PASS  user payload exposes agentLock {full,amount,sendable,cause}
PASS  full agent lock blocks Pay an Agent                    → 403
PASS  P2P still works under a full agent lock
PASS  release restores Pay an Agent
PASS  sent-money hold caps P2P (80 > 50.70 refused)          → 403
PASS  under the sent-money hold the payload reports cause=send
PASS  small agent payment still allowed under a $30 send hold
PASS  amount 0 / amount > balance / bad mode / unknown user / normal user  → 400/400/400/404/401
PASS  admin user list carries agentLock + agentSendable
RESULT 21 pass / 0 fail
```
পুরোনো স্যুটও আবার চালানো হয়েছে — **৯/৯** (MFA-মুক্ত + Pay an Agent) এবং **২০/২০** (সেন্ড-লক)।

## প্রযুক্তিগত বিবরণ (deploy-এর জন্য)

* `user.agentLock = { mode:'amount'|'full'|'off', amount, note, setBy, setAt }` — `user.sendLock`-এর পাশে আলাদা ফিল্ড, তাই পুরোনো ডেটা/মাইগ্রেশন লাগে না।
* নতুন রুট: `POST /api/admin/users/agent-lock` (`requireSuperAdmin`, MFA-মুক্ত) — body `{userId, mode, amount?, note?}`। ভুল মোড/০/ব্যালেন্সের বেশি → 400, অজানা ইউজার → 404, সাধারণ ইউজার → 401।
* এনফোর্সমেন্ট: `POST /api/user/send-to-agent` (amount + fee মিলিয়ে চেক)। `agentPayInfo()` দুই লকের মধ্যে **যেটা ছোট সেটাই** ক্যাপ হিসেবে ধরে, আর `cause` দেয় (`send` / `agent`) যাতে মেসেজ সঠিক হয়।
* `publicUser` এখন `agentLock: { full, amount, sendable, cause }` পাঠায় (sendable = এখন সত্যিই agent-কে দেওয়া যাবে এমন সর্বোচ্চ); `adminUserView`-এ `agentLock` + `agentSendable` যোগ হয়েছে।
* `SendLockCard.tsx` এখন `kind="send" | "agent"` নেয় — একই কম্পোনেন্ট দুই লকের জন্য (ডুপ্লিকেট কোড নেই)।

## ⚠️ ছোট নোট
* এই কাজের টেস্টের সময় লোকাল ওয়ার্কস্পেসের ডেভ-ডেটাবেস (`data/boostpay_db.json`) টেস্ট ইউজার দিয়ে বদলে গিয়েছিল (ফাইলটা gitignored, রিপোতে যায় না)। **প্রোডাকশন ডেটাবেস কিছুই হয়নি** — সেখানে কোনো লেখা/টেস্ট চালানো হয়নি।

---

# ৯. 🆕 MFA — পুরোটা OFF / ON করার সুইচ

আপনার নির্দেশ: **"mfa fully disable / enable er system"**। এখন কনসোলের ভেতরেই একটা মাস্টার সুইচ — এক ট্যাপে MFA পুরো বন্ধ, আরেক ট্যাপে আবার চালু।

## কোথায়
**Admin → Admins → Two-Factor Authentication (MFA)** কার্ডের সবচেয়ে উপরে নতুন ব্লক — **"MFA for the whole console"**:
* সবুজ পিল = **MFA ON** → ট্রেজারি credit/debit, freeze, delete, backup restore, DB Studio write — সব ৬ ডিজিটের কোড চায় (আগের মতোই)।
* লাল পিল = **MFA OFF** → কোনো কোড চায় না; শুধু লগইন করা অ্যাডমিন সেশন দিয়েই সব কাজ। বাটন: **"Turn MFA OFF (no codes anywhere)"**।
* **MFA OFF অবস্থায় পুরো কনসোলের উপরে একটা লাল ব্যানার** থাকে — *"🔓 MFA is OFF — treasury, freeze, delete and DB writes run without a code"* + এক ট্যাপে Admins ট্যাবে নিয়ে যায়। যাতে ভুলে না যান।

## কীভাবে কাজ করে
| অবস্থা | কী হয় |
|---|---|
| **ON** (ডিফল্ট) | treasury, freeze, delete, backup restore, DB Studio → ৬ ডিজিটের কোড / ৫ মিনিটের unlock বাধ্যতামূলক |
| **OFF** | এগুলোর কিছুই কোড চায় না — শুধু SUPERADMIN সেশন |
| **সবসময়** | Send Money Lock ও Pay an Agent Lock — কোনোটাতেই কোড লাগে না (আগের নির্দেশ মতো) |

* **বন্ধ করার সময় একটা সুরক্ষা:** আপনার ট্রুথেন্টিকেটর সেট থাকলে **একটা চলমান ৬-ডিজিটের কোড লাগবে** (অথবা ৫ মিনিটের unlock টোকেন)। কারণটা পরিষ্কার — কেউ আপনার অ্যাডমিন সেশন চুরি করলেও চুপচাপ 2FA বন্ধ করতে পারবে না। অথেন্টিকেটর সেট না থাকলে কিছু প্রমাণ করার নেই, তাই সোজা বন্ধ হয়ে যায়।
* **চালু করার সময় কোড লাগে না** (বন্ধ থাকা অবস্থায় দাবি করার কিছু নেই)। তবে চালু করার সময় অথেন্টিকেটর সেট না থাকলে কনসোল বলে দেবে *"no authenticator is set up yet — scan the QR below"*।
* **পুরোনো ডেটাবেস নিরাপদ:** ফিল্ডটা না থাকলে ডিফল্ট = **ON**। অর্থাৎ কোনো ডেটাবেস আপডেট ছাড়াই MFA আগের মতোই কড়া থাকে।
* 🔒 প্রতিটা বদল **audit log**-এ: `MFA_POLICY → "Global MFA DISABLED/ENABLED by <email>"`।
* অ্যাডমিন ছাড়া কেউ এই সুইচ ছুঁতে পারে না — রোল SUPERADMIN, আর মফা সুইচে ইউজার টোকেন দিলে **401**।
* **ফোন হারালে কী করবেন?** কোড ছাড়া বন্ধ করা যাবে না — তখন VPS-এ `/home/user/.../data/.admin-mfa.json` ফাইলটা সরিয়ে দিলে সিক্রেট মুছে যায় (অথবা Admins → *Generate new secret* দিয়ে নতুন QR)। এই কারণেই অন্য কোনো তালা এখানে নেই।

## যাচাই — **১৬/১৬ PASS** (`/tmp/mfa_switch_test.cjs`)

```
PASS  default policy = MFA ON (পুরোনো কড়া আচরণ অটুট)
PASS  treasury blocked before setup (428)
PASS  authenticator set up (codeSample issued)
PASS  switching OFF without a code is refused (401 + mfaCodeRequired)
PASS  wrong code refused
PASS  switching OFF with the right code works
PASS  status reports globalEnabled=false
PASS  treasury credit works with NO code (was 428)
PASS  freeze works with NO code
PASS  config write works with NO code
PASS  DB Studio rows read works with NO code
PASS  a normal user still cannot touch the policy (401)
PASS  send-money lock still needs no MFA (unchanged)
PASS  switching ON needs no code
PASS  treasury is guarded again (401 without a code)
PASS  right code lets treasury through again
RESULT 16 pass / 0 fail
```
আগের সব স্যুটও আবার চালানো হয়েছে — **২১/২১** (agent-lock), **২০/২০** (send-lock), **৯/৯** (MFA-মুক্ত লক)।

## প্রযুক্তিগত
* ফ্ল্যাগ: `db.config.mfaEnabled` (`false` = বন্ধ)। `adminMfaGlobalEnabled()` সব `requireMfa` গেটের শুরুতে চেক হয় — বন্ধ থাকলে `next()`; ভেতরের কোনো লজিক বদলায়নি।
* নতুন রুট: `GET /api/admin/mfa/policy` (যেকোনো লগইন করা অ্যাডমিন, শুধু পড়া) এবং `POST /api/admin/mfa/policy` (`requireSuperAdmin`, body `{globalEnabled, mfaCode?}`)।
* `GET /api/admin/mfa/status`-এ নতুন `globalEnabled` ও `guardsActive` ফিল্ড (পুরোনো ফিল্ড আগের মতোই আছে, তাই আগের UI ভাঙে না)।
* store: `adminMfaPolicy()`, `adminSetMfaPolicy(enabled, code?)`; `adminAuthHeaders()` আগের মতোই কোড/টোকেন পাঠায়।
