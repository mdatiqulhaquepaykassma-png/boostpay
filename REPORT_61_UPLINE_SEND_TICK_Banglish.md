# REPORT 61 — "Allow sending to the upline (refer)" টিক

তারিখ: 2026-11-08 · কমিট `1bc266b` · লাইভ API `v1.2.1794138085` · লাইভ অ্যাডমিন বান্ডল `index-D8_Y310Y.js`

---

## ১. নতুন টিক

`Admin → User Accounts → Manage → MONEY → Send to refer only` কার্ডে এখন **তিনটা টিক/নিয়ন্ত্রণ**:

| কন্ট্রোল | মানে |
|---|---|
| ☑ **Allow sending to the upline (refer)** ← **নতুন** | ইউজার তার **উপরের refer-কে** টাকা পাঠাতে পারবে কি না |
| ☑ **Also allow team members under them** | নিজের নিচের টিম পাঠানোর অনুমতি |
| ☑ **Also apply to whoever receives the money** | নিয়মটা প্রাপকের উপরও চলে |

### কোন টিকে কী হয়

| Upline টিক | Team টিক | ফল |
|---|---|---|
| ☑ | ☐ | শুধু **refer**-কে পাঠাতে পারবে |
| ☑ | ☑ | **refer + নিজের টিম** |
| ☐ | ☑ | **শুধু নিজের টিম** — refer-কে **কখনোই নয়** |
| ☐ | ☐ | **কাউকেই নয়** — পাঠানো পুরো বন্ধ (কার্ডে `Allowed recipients: 0` দেখায়) |

**নিরাপত্তা:** টিকটা শুধু **upline** বন্ধ করে — বাকি নিয়ম (টিম, ক্যাপ, period) আগের মতোই চলে; অ্যাডমিন নিয়ম সরিয়ে দিলে সব দিক আবার খুলে যায়।

## ২. কোথায় দেখা যাবে

- **অ্যাডমিন কার্ডে:** লাইভ প্যানেলে নতুন লাইন — `Upline (refer): allowed / blocked` (বন্ধ হলে লাল)
- **ইউজারের Send শিটে:** ব্যানার লেখা বদলে যায় — *"You can send only to your own team members"* / *"Sending is closed on this account"*, সাথে `Referrer: #U1 (sending to them is off)`
- **সার্ভার মেসেজ:** `…you can only send money to your own team members only (not your referrer). This recipient is not in that list.`
- **audit log:** `… + upline sending blocked` — কে কখন বন্ধ করল

## ৩. ইনহেরিটের সাথে

"also apply to whoever receives the money" টিক চালু থাকলে **upline টিকটাও ইনহেরিট হয়** — অর্থাৎ প্রাপকও তার refer-কে পাঠাতে পারবে না। অ্যাডমিনের হাতে-সেট নিয়ম আগের মতোই অটুট থাকে।

## ৪. টেস্ট (নতুন §23 — ১২ চেক)

- টিক ডিফল্ট **allowed** · টিক অন থাকলে refer-কে পাঠানো সফল
- টিক অফ → refer-কে ৪০৩ (`referSendLimited`) · **টিম মেম্বারকে তখনও পাঠানো যায়** (২০০)
- ইউজারকে বলা হয় (`allowUpline:false` + সঠিক label) · allowed লিস্ট থেকে referrer বাদ পড়ে
- **L1 + upline off → allowed = 0**, আর সব পাঠানো ৪০৩
- টিক বদল audit-এ · নিয়ম সরালে সব দিক আবার খোলে

| টেস্ট | ফল |
|---|---|
| user-journey | **286 pass / 0 fail** |
| regression | 42 / 0 |
| system-check | no problems found |
| build (user + admin) | ক্লিন |
| লাইভ বান্ডল | `upline (refer)` ও `Sent today` দুটোই আছে ✅ |

## ৫. দেখতে না পেলে

`https://admin.boostpay.online` → **Ctrl+Shift+R** (হার্ড রিফ্রেশ) → `User Accounts` → `Manage` → **MONEY** ট্যাব → নিচের ডান কার্ড `Send to refer only`।
