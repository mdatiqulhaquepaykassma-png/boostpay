# REPORT 63 — "185 number user welcome bonus পায়নি" — কারণ + সমাধান

তারিখ: 2026-11-08 · কমিট `56ae751` · লাইভ API `v1.2.1794164747` · প্রমোশন কনসোল `index-Ck6qwpuG.js`

---

## ১. কেন পায়নি (লাইভ চেক করা)

লাইভে আপনার welcome ক্যাম্পেইনটা এখন আছে:
`bonusPerUser $1 · valid ✔ · slots 499 (এখনো ০ জন নিয়েছে) · stackWithCode = false · transfer ✘ · withdraw ✔ · expiryAction TO_BALANCE`

অর্থাৎ **এখনো পর্যন্ত কোনো ইউজারই এই ক্যাম্পেইন থেকে বোনাস পায়নি** (`remainingSlots` অপরিবর্তিত ৪৯৯)। কারণগুলো একটাই ধরনের:

| কারণ | ব্যাখ্যা |
|---|---|
| **ক্যাম্পেইনটা তৈরি/সক্রিয় হওয়ার আগে অ্যাকাউন্টটা খোলা হয়েছিল** | welcome বোনাস শুধু **নতুন সাইনআপে** দেয় — পুরনো অ্যাকাউন্টে স্বয়ংক্রিয়ভাবে যায় না |
| **সাইনআপ কোড দিয়ে হয়েছে** | আপনার ক্যাম্পেইনে **"If the user also joined with a code = Skip it"** সেট আছে, তাই কোড দিয়ে ঢুকলে welcome বাদ যায় (এটা আপনারই দেওয়া টিক) |
| ক্যাম্পেইন **PAUSED/INACTIVE** ছিল | তখন কেউ পায় না |
| `maxUses` শেষ | ৪৯৯ স্লট — এখনো বাকি |

## ২. সমাধান — নতুন "Give to existing users" বাটন

প্রমোশন কনসোলের welcome ক্যাম্পেইন কার্ডে এখন বাটন: **`Give to existing users`**
(এবং একই কাজ API দিয়েও — নিচে)।

```
POST /api/admin/promo/welcome/backfill
   { dryRun: true }                     → কত জন পাবে, মোট কত টাকা (কোনো টাকা যায় না)
   { confirm: true }                    → সব যোগ্য অ্যাকাউন্টকে দিয়ে দেয়
   { userIds: ["185"], confirm: true }  → শুধু #185 (বা যেকোনো নির্দিষ্ট আইডি)
```

**নিরাপত্তা-নিয়ম:**
- **ড্রাই-রান আগে** — বাটনে চাপলে আগে দেখায় "Would pay N account(s) · total $X", আপনি OK দিলে তবেই টাকা যায়
- **যে পেয়েছে তাকে আর দেয় না** (ইদেম্পোটেন্ট — দুইবার চালালেও ডাবল পে হয় না)
- **ব্লকড, ভুল দেশ, বা স্লট শেষ** হলে বাদ যায় (`skipped` লিস্টে কারণসহ)
- ক্যাম্পেইনটাই **PAUSED/expired** হলে backfill-ই চলে না (আগে Activate)
- প্রতিটা রান **audit log**-এ: `WELCOME_BACKFILL — $1.00 given to N existing account(s) (targeted: 185)`
- শুধু **SUPERADMIN** — সাধারণ ইউজার ৪০১

## ৩. #185-কে এখনই বোনাস দিতে

**সহজ পথ:** `promotion.boostpay.online` → Campaigns → welcome কার্ড → **Give to existing users** → কনফার্ম।
এতে **সব যোগ্য পুরনো ইউজার** পাবে (শুধু ১৮৫ নয়) — টাকা কত যাবে সেটা কনফার্ম বক্সেই দেখাবে।

**শুধু #185 চাইলে** (নিরাপদ, টার্গেটেড):

```bash
curl -X POST https://boostpay.online/api/admin/promo/welcome/backfill \
  -H "authorization: Bearer <admin-token>" -H "content-type: application/json" \
  -d '{"userIds":["185"],"dryRun":true}'      # আগে দেখে নিন
# ঠিক থাকলে:
curl -X POST https://boostpay.online/api/admin/promo/welcome/backfill \
  -H "authorization: Bearer <admin-token>" -H "content-type: application/json" \
  -d '{"userIds":["185"],"confirm":true}'
```

## ৪. ভবিষ্যতে #185-এর মতো কেস এড়াতে

- ক্যাম্পেইন **আগে** বানিয়ে রাখুন, পরে অ্যামাউন্ট বদলালেও সমস্যা নেই (edit করা যায়)
- যদি চান **কোড দিয়ে ঢুকলেও welcome পাবে** → ক্যাম্পেইন এডিটে **"If the user also joined with a code" = Give the welcome bonus too** করুন
- নতুন অ্যাকাউন্টের বোনাস **সাইনআপের সাথেই** আসে; পুরনোদের জন্য এই backfill বাটনটাই ব্যবহার করবেন

## ৫. টেস্ট (নতুন §25 — ১০ চেক)

- welcome ক্যাম্পেইন লাইভ · পুরনো অ্যাকাউন্টে বোনাস নেই (শুরুতে)
- **ড্রাই-রান কিছুই দেয় না** · কত জন/কত টাকা ঠিক দেখায়
- **টার্গেটেড backfill** ঠিক ১ জনকে দেয় · **টাকাটা সত্যিই ওয়ালেটে ঢোকে**
- **দুইবার চালালে ডাবল পে হয় না** · অজানা ক্যাম্পেইন ৪০৪ · সাধারণ ইউজার ৪০১ · audit এন্ট্রি

| টেস্ট | ফল |
|---|---|
| user-journey | **312 pass / 0 fail** |
| regression | 42 / 0 |
| system-check | no problems found |
| build (user + admin + promo) | ক্লিন |

## ৬. লাইভ

কমিট `56ae751` পুশ (force ছাড়া) → ডিপ্লয়, `/api/health` = `v1.2.1794164747`, `/api/admin/promo/welcome/backfill` → 401 (সুরক্ষিত), প্রমোশন কনসোল নতুন বিল্ডে।
