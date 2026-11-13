# APK ডাউনলোড হচ্ছিল না — কারণ ও সমাধান

তারিখ: ২০২৬-১১-১৩ · Live (সব ৭টি APK আবার ডাউনলোড হচ্ছে)

---

## ১. সমস্যাটা ঠিক কী ছিল

পেজ (`app.boostpay.online`) খুলছিল, **কিন্তু ফাইল নামলে 404** — পেজে লেখা আসত:
**"Not ready — … এখনো আপলোড হয়নি"**।

কারণ (পরীক্ষা করে নিশ্চিত):

- ওই সাইটটা Dokploy-এর একটা **নিজস্ব অ্যাপ**, যেটা নিজের Docker image বানিয়ে চালায়।
- ওই image-এর ভেতরে **APK ফাইলগুলো ছিল না** (বিল্ডে ফাইল কপি হচ্ছিল না)।
- অথচ Traefik সেই image-কেই পাঠাচ্ছিল → পেজ দেখাত, ফাইল দিত 404।
- দুইবার "ডিপ্লয় ঠিক" করার পরও একই — কারণ সমস্যা ছিল image-এর ভেতরে, ডিপ্লয়ে নয়।

---

## ২. যা করেছি (স্থায়ী সমাধান)

1. **পোর্টাল এখন আর image-এর ওপর নির্ভর করে না।** APK-গুলো রাখা হয়
   `/opt/boostpay-apks/` — **git checkout-এর বাইরে**, শুধু পড়ার জন্য (read-only) কন্টেইনারে মাউন্ট।
   ফলে কোনো ডিপ্লয়/`git reset` আর ফাইল মুছতে পারবে না।
2. **নিজের কন্টেইনার** `boostpay-apk-portal` (node:20-alpine, `--restart unless-stopped`) —
   সার্ভার রিবুট হলেও নিজে উঠে আসবে।
3. **Traefik রাউট** এখন সরাসরি এই কন্টেইনারে (`http://boostpay-apk-portal:3000`);
   পুরোনো ভাঙা সার্ভিসটা **0 রেপ্লিকা** করে বন্ধ করা হয়েছে (বেকআপ: `/root/traefik-apk-portal.yml.bak`)।
4. **`/api/health` এখন সত্যি বলে** — কোন ফাইল নেই থাকলে 503 + `missing:[…]` (নীরবে 404 আর হবে না)।
5. **Range/resume সাপোর্ট** — মোবাইল নেটওয়ার্ক কেটে গেলে ৪ MB আবার শুরু থেকে নয়, যেখানে ছিল সেখান থেকেই চলবে।
6. **এক কমান্ডে নতুন বিল্ড প্রকাশ:** `sh apk-portal/deploy-vps.sh` — রিপো থেকে ফাইল কপি করে কন্টেইনার রিস্টার্ট করে।

---

## ৩. যাচাই (সব লাইভ, Cloudflare হয়ে)

```
/api/health → {"status":"ok","apps":7,"apkDir":"/apks","missing":[]}

boostpay-user.apk          200  4,203,603 B   application/vnd.android.package-archive
boostpay-ussd-nagad.apk    200     64,155 B   (2.1.7)
boostpay-ussd-payout.apk   200     64,191 B   (2.1.7)
boostpay-sms-relay.apk     200     19,136 B
boostpay-agent.apk         200  3,962,498 B
boostpay-management.apk    200  3,953,288 B
boostpay-admin.apk         200  4,086,609 B

Range: bytes=0-1023  → 206 · 1,024 B        (resume কাজ করছে)
HEAD                 → 200
/nagadpayout/download→ 200 · 64,155 B
/api/apks            → userapk 1.1 · ussdpayout 2.1.7 · nagadpayout 2.1.7 …
পুরো 4.2 MB ডাউনলোড   → 200 · 4,203,603 B · badging = com.boostpay.app 1.1
```

---

## ৪. এখন ডাউনলোড করুন

| অ্যাপ | লিংক |
|---|---|
| Payout – Nagad **2.1.7** | `https://app.boostpay.online/apks/boostpay-ussd-nagad.apk` |
| Payout – bKash **2.1.7** | `https://app.boostpay.online/apks/boostpay-ussd-payout.apk` |
| ইউজার অ্যাপ **1.1** | `https://app.boostpay.online/apks/boostpay-user.apk` |
| SMS Relay | `https://app.boostpay.online/apks/boostpay-sms-relay.apk` |
| পেজ | `https://app.boostpay.online` |

ফোনের ব্রাউজারে খুলে **Download** চাপুন; ফাইল নামার পর "Open" → ইনস্টল।
Chrome-এ "এই ধরনের ফাইল ক্ষতিকর হতে পারে" এলে **Download anyway** — এটি আপনার নিজের সাইন করা APK।

> Git: `945d140` (range), `77bc066` (APK_DIR + health + deploy-vps.sh)
