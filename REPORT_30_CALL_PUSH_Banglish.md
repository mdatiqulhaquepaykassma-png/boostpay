# REPORT 30 — কলের পুশ নোটিফিকেশন (অ্যাপ বন্ধ থাকলেও রিং)

**তারিখ:** 2026-10-31 · **লক্ষ্য:** কেউ কল দিলে অন্য প্রান্তের ফোনে **অ্যাপ বন্ধ থাকলেও** নোটিফিকেশন আসবে, ট্যাপ করলে কলটা ধরা যাবে।

---

## ১. আগে কী হচ্ছিল

কলের সিগন্যাল (offer/answer/ICE) যেত শুধু **SSE লাইভ স্ট্রিমে** — অর্থাৎ **অ্যাপ খোলা থাকলেই**। ফোনের অ্যাপ বন্ধ/ব্যাকগ্রাউন্ডে থাকলে offer-টা কোথাও জমা থাকত না, তাই "missed call" হিসেবে হারিয়ে যেত, কোনো নোটিফিকেশনও আসত না।

## ২. এখন কী হয়

1. কেউ কল দিলে সার্ভার **offer-টা ৯০ সেকেন্ডের জন্য সংরক্ষণ করে** (`db.pendingCalls`) + **Web Push** পাঠায়:
   * Android/Chrome: **📞 Incoming voice call / 📹 Incoming video call** — `User #142 is calling you — tap to answer.` সাথে **Answer** ও **Decline** বাটন, ফোন কাঁপে (দীর্ঘ vibrate), নোটিফিকেশন নিজে থেকে মুছে যায় না (`requireInteraction`)।
   * iPhone: সাধারণ push (Apple-এর নিয়মে action বাটন নেই) — ট্যাপ করলে অ্যাপ খুলে কল স্ক্রিন আসে।
2. **ট্যাপ (Answer বা body)** → অ্যাপ `/?call=<id>` দিয়ে খোলে → `/api/chat/call-pending` থেকে offer নিয়ে সরাসরি **incoming call UI + রিংটোন**, Accept চাপলেই কথা শুরু।
3. **Decline** → সার্ভিস ওয়ার্কার নিজেই caller-কে `reject` পাঠায় (টোকেন IndexedDB থেকে), নোটিফিকেশন বন্ধ — caller-এর স্ক্রিনে "declined"।
4. কল ধরা/বাতিল/কাটা হলে pending offer সাথে সাথে মুছে যায়; ৯০ সেকেন্ড পার হলে আর দেখানো হয় না।
5. একই সুবিধা **agent-এর জন্যও** (user → agent কল, agent অ্যাপ বন্ধ থাকলেও) — সার্ভিস ওয়ার্কার ও pickup agent অ্যাপেও যোগ হয়েছে।
6. বোনাস ফিক্স: ইউজার support কনসোলকে কল দিলে আগে "User not found" আসত; এখন পরিষ্কার বার্তা — *"BoostPay Support cannot be called directly — send a message and staff will call you back."*

## ৩. যাচাই — **১৩/১৩ PASS** (লোকাল, আসল P-256 subscription + লোকাল HTTPS push stand-in)

```
PASS  callee (U2) subscribes a device / agent subscribes a device
PASS  offer accepted
PASS  callee phone gets a call push with the app closed        woke: u2
PASS  callee can fetch the missed offer (callId/from/media/sdp) from=U1 media=video age=1.2s
PASS  another user sees no pending call
PASS  pending endpoint needs auth                             401
PASS  answering clears the pending call
PASS  declining (notification button) clears it
PASS  user -> agent call also pushes the agent phone           woke: agent
PASS  agent can fetch its pending call
PASS  an offer older than 90 s is not delivered
PASS  user -> support gives a clear message (not "User not found")
RESULT 13 pass / 0 fail
```
সাথে আগের user↔user কল টেস্টও আবার চালানো হয়েছে — রিং/answer/৬০ ICE burst/hangup সবই আগের মতোই ঠিক (ওই ৪টি "fail" শুধু এই রানে TURN env ও টেস্ট-ডেটা সেট না থাকায়)।

**Untested (সীমাবদ্ধতা):** আসল ফোনে নোটিফিকেশন থেকে Accept করে মিডিয়া সংযোগ — এখানে ক্যামেরা/মাইক/আসল push সার্ভিস নেই, তাই আপনার ফোনে দেখতে হবে।

## ৪. আপনার ফোনে টেস্ট
1. **B (গ্রহণকারী)** অ্যাপে একবার 🔔 → Turn on (নোটিফিকেশন চালু) — এটা ছাড়া push আসবে না।
2. B-এর অ্যাপ **সম্পূর্ণ বন্ধ** করুন (recent apps থেকে সোয়াইপ) / ফোন লক করুন।
3. **A** থেকে B-কে 📞 বা 🎥 কল দিন → B-এর ফোনে "📞 Incoming voice call — User #A is calling you" আসবে।
4. **Answer** চাপুন (বা নোটিফিকেশনে ট্যাপ) → অ্যাপ খুলে কল স্ক্রিন → Accept → কথা শুরু।
5. **Decline** চাপলে A-এর স্ক্রিনে কল বন্ধ হয়ে "declined" দেখাবে।

> ⚠️ নোটিফিকেশন না এলে: ফোনের Settings → Apps → Chrome → Notifications চালু, এবং battery optimization "Unrestricted" রাখুন। iPhone-এ iOS 16.4+ ও Home Screen-এ install করা লাগবে।

## ৫. কোড
* `server.ts` — `db.pendingCalls` (৯০s TTL), offer-এ caller/callee টার্গেটেড push (`kind: 'incoming_call'`, Answer/Decline meta), answer/reject/cancel/hangup-এ পরিষ্কার, নতুন `GET /api/chat/call-pending` (তিন রোলের জন্যই অনুমোদিত), support-কে কল দিলে পরিষ্কার বার্তা।
* `public/push-sw.js`, `agent-app/public/sw.js`, `management-app/public/sw.js`, `admin-app/public/sw.js`, `support-app/public/sw.js` — push-এ কল ডিটেকশন, Answer/Decline action, `notificationclick`-এ decline → `reject` API কল, বাকি ক্ষেত্রে অ্যাপ খোলা/ফোকাস।
* `src/components/CallOverlay.tsx` ও `agent-app/src/CallOverlay.tsx` — `?call=` বা অ্যাপ ফোরগ্রাউন্ডে এলে `/api/chat/call-pending` পড়ে ইনকামিং কল স্ক্রিন + রিংটোন।
* টাকার হিসাব/boost/commission: **কোনো পরিবর্তন নেই**।
