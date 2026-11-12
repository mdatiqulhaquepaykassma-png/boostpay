# v1.4.0 — মেনু পড়ে নিজেই সিদ্ধান্ত নেয় (ড্রাই-রান ফিক্স)

**আপডেট:** `https://app.boostpay.online/nagadpayout` · `https://app.boostpay.online/ussdpayout`

---

## ১. আপনার লগে যা হয়েছিল

```
14:00:37 ⇦ Carrier info · Nagad · 1. Cash Out 2. Send Money … 8. PIN Reset · Cancel · Send
14:00:37 ⏸ DRY RUN: this screen asks for the PIN — a dry run stops here
```

মেইন মেনুর **"8. PIN Reset"** শব্দে `PIN` আছে — অ্যাপ ভেবেছিল এটা PIN চাওয়ার স্ক্রিন, তাই
প্রথম স্ক্রিনেই থেমে গেছে। নম্বর/টাকা টাইপ করার প্রশ্নই আসেনি।

**অর্থাৎ আপনার সেটআপ/Method B ঠিকই ছিল — ভুলটা ছিল মেনু চেনার নিয়মে।**

---

## ২. যা বদলাল

### (ক) মেনু আর PIN-প্রম্পট আলাদা করা যায়
- স্ক্রিনে **২টার বেশি নম্বরওয়ালা অপশন** (`1. … 2. … 3. …`) বা একাধিক মেনু-শব্দ থাকলে ⇒ এটা **মেনু**, PIN চাওয়া নয়
- PIN ধরা হয় শুধু তখন, যখন সত্যিই "PIN দিন / Enter your PIN" ধাঁচের স্ক্রিন — আর
  `PIN Reset`, `Change PIN`, `পিন রিসেট`, `পিন পরিবর্তন` **বাদ**

### (খ) মেনু থেকে নিজেই Send Money বেছে নেয় (এই আপডেটের সবচেয়ে বড় লাভ)
এখন অ্যাপ মেনুর লেখা পড়ে **যে অপশনে "Send Money" লেখা, তার নম্বরটাই** চাপে —
`1. Cash Out 2. Send Money …` ⇒ **2** চাপবে, নিজে থেকে।
মেনু নম্বর বদলালে (1 হোক বা 2 বা 3) কোড বদলাতে হবে না — এজন্যই পরে আর এই ভুল হবে না।
সাব-মেনু এলে (`1. To Nagad Account 2. To Bank Account`) সেখানেও **Nagad Account**-এর অপশনটা বেছে নেয়।

### (গ) নম্বর → টাকা → PIN — আগের মতোই ধরে
`Enter Nagad Account Number` ⇒ নম্বর · `Enter amount` ⇒ টাকা · `Enter PIN` ⇒ **ড্রাই রানে এখানেই থামে**।

---

## ৩. নতুন টেস্ট (আপনার আসল স্ক্রিন দিয়ে)

`tools/PlanTest.java` — **34 pass / 0 fail**, এর মধ্যে আপনার লগের হুবহু টেক্সট:

| টেস্ট | ফল |
| --- | --- |
| মেইন মেনুকে মেনু হিসেবে ধরে | PASS |
| `PIN Reset` দেখেও PIN-প্রম্পট ভাবে না | PASS |
| ড্রাই রানে **2 (Send Money)** বেছে নেয়, থামে না | PASS |
| সাব-মেনুতে `To Nagad Account` (1) বেছে নেয় | PASS |
| আসল PIN স্ক্রিনে ড্রাই-রান থামে / লাইভে PIN বসায় | PASS |
| Change-PIN স্ক্রিনকে পেমেন্ট-PIN ভাবে না | PASS |
| ডুয়াল-সিম লজিক (আগের ১০টা টেস্ট) | PASS |

---

## ৪. এবার ড্রাই রান চালালে এমন দেখবেন

```
▶ mode: Accessibility · DRY RUN (no PIN, no money) · subId 3
⇦ Carrier info · Nagad · 1. Cash Out 2. Send Money … 8. PIN Reset · Cancel · Send
⇨ 2   · menu: picked that option
⇦ Enter Nagad Account Number … · Cancel · Send
⇨ 01XXXXXXXXX · receiver prompt
⇦ Enter amount … · Cancel · Send
⇨ 20 · amount prompt
⇦ Enter your Nagad PIN … · Cancel · Send
⏸ DRY RUN: this screen asks for the PIN — a dry run stops here, nothing is sent
```

শেষের `⏸` লাইনটা এলেই বুঝবেন **পুরো পথ কাজ করছে**, এক টাকাও যায়নি।
তারপর **② SEND REAL MONEY** → `20 5678` টাইপ → Send now। গণ্ডগোল হলে **⛔ STOP**।

---

## ৫. যদি এরপরও কোথাও আটকায়

`Copy log` করে পুরোটা পাঠান — বিশেষ করে:
- `⇨ …` লাইনগুলো (কী টাইপ করেছে)
- `· reply box not ready, retry 1/3` বা `Could not find the USSD reply box … Screen was: …`

সাথে ফোনের মডেল + Android ভার্সন। ওই লেখা দেখে রিডারটা আপনার ফোনের ডায়ালগের জন্য একদম মিলিয়ে দেব।
