# REPORT 29 — user↔user অডিও/ভিডিও কল ফিক্স (রিং বাজে, connect হয় না)

**তারিখ:** 2026-10-31 · **উপসর্গ:** ইউজার A থেকে ইউজার B-কে কল দিলে রিং বাজে কিন্তু কল কখনো connect হয় না।

---

## ১. আসল কারণ (Confirmed)

সার্ভারের সিগন্যালিং রুট `/api/chat/call-signal`-এ user→user কল **সরাসরি ব্লক** করা ছিল:

```ts
// user <-> user direct calls remain admin-only
return res.status(403).json({ error: 'Direct voice/video calls to other users are admin-only…' });
```

কিন্তু চ্যাট স্ক্রিনে (Messenger → যেকোনো 1:1 thread) ভয়েস/ভিডিও বাটন দেখা যেত। ফলে বাটনে চাপলে ফোনে "Calling…" ও রিংটোন বাজত (ক্লায়েন্ট দিকেই), অথচ offer সার্ভারে 403 খেয়ে বাতিল হতো — অন্য প্রান্তে কিছুই পৌঁছাত না। **ঠিক আপনার বর্ণনার মতোই।**

সাথে আরও দুটি সমস্যা পাওয়া গেছে:

1. **ICE candidate সীমা ৪০/মিনিট** — একটা কলেই ২০–৬০টি candidate যায় (মোবাইল ডেটায় আরও বেশি), নেটওয়ার্ক দুর্বল হলে ICE restart-ও হয়। তাই হ্যান্ডশেক মাঝপথে throttle হয়ে যেত → "rings but never connects"-এর দ্বিতীয় কারণ।
2. **শুধু STUN, TURN রিলে নেই** — মোবাইল ডেটা/CGNAT-এ দুই ফোন সরাসরি পথ পায় না, তখন STUN দিয়ে কখনো connect হয় না (Wi-Fi-তে ঠিক, ডেটায় ব্যর্থ)।

---

## ২. কী ঠিক করা হয়েছে

### (ক) user → user কল চালু (গার্ড সহ)
* টার্গেট ইউজার থাকতে হবে, **suspended নয়**, এবং তার **"Calls" সুইচ বন্ধ নয়** (`allowVoiceCall` — Settings-এর গোপনীয়তা সুইচ)।
* **আগে অন্তত একবার দুজনের মধ্যে মেসেজ চলাচল করতে হবে** (1:1 conversation থাকতে হবে) — আইডি বলে অচেনা কাউকে cold-call করা যাবে না, স্প্যাম/হ্যারাসমেন্ট বন্ধ।
* কল করা ইউজার নিজেও blocked হলে 403।
* বাকি সব আগের মতোই: নিজেকে কল 400, ভুল signal type 400, agent↔user কল আগের মতোই কাজ করে।

### (খ) ICE লিমিট ঠিক
`/api/chat/call-signal` লিমিট **৪০ → ৩০০/মিনিট** (প্রতি কলে যত candidate যায় তার জন্য যথেষ্ট, তবু স্প্যাম-সুরক্ষা আছে)।

### (গ) TURN রিলে সাপোর্ট (কোডে)
* নতুন endpoint **`GET /api/rtc/ice`** (লগইন লাগে) — STUN তালিকা + **TURN থাকলে তার ঠিকানা ও ক্রেডেনশিয়াল** দেয়; ক্রেডেনশিয়াল শুধু সার্ভারে থাকে, বান্ডলে যায় না।
* সার্ভারে TURN চালু করতে শুধু env:
  ```
  TURN_URLS=turn:টার্ন-হোস্ট:3478,turns:টার্ন-হোস্ট:5349
  TURN_USERNAME=boostpay
  TURN_CREDENTIAL=<পাসওয়ার্ড>
  ```
  (কোড বদলানো লাগবে না, redeploy-এ env বসালেই সব অ্যাপ নতুন ঠিকানা নেবে।)
* ক্লায়েন্ট এখন কল শুরুর আগে এই কনফিগ নেয়, `bundlePolicy: max-bundle` + `iceCandidatePoolSize: 4` সহ; কনফিগ না পেলে আগের STUN-এ ফলব্যাক।

### (ঘ) কানেক্ট ওয়াচডগ
উত্তর দেওয়ার পর **১০ সেকেন্ডেও মিডিয়া connect না হলে** ICE নিজে থেকে restart হয় (caller আবার offer পাঠায়) এবং স্ক্রিনে দেখায় *"Still connecting… weak network"* — আগে চুপচাপ "connected" স্ক্রিনে বসে থাকত।

---

## ৩. যাচাই — **১৩/১৩ PASS** (সিগন্যালিং লেয়ার, লোকাল)

```
PASS  /api/rtc/ice serves STUN + the configured TURN relay (turn:…:3478, turns:…:5349)
PASS  TURN credentials present but only for a signed-in caller
PASS  /api/rtc/ice anonymous -> 401
PASS  user -> user offer accepted (was 403 "admin-only" before)      status=200
PASS  U2 receives the ring over its live stream                     from=U1 callId=… media=video
PASS  U1 receives the answer
PASS  60 ICE candidates in one burst are not throttled               accepted=60/60
PASS  candidates reach the callee in order                          received=59
PASS  a user who switched calls OFF is protected                    403 "disabled voice and video calls"
PASS  calling a stranger (no conversation) is refused politely       403 "…send a message first"
PASS  hangup delivered
PASS  user -> agent call path still works                            200
PASS  self-call refused / unknown signal / missing target            400, 400, 400
```
`tsc --noEmit` ক্লিন, `vite build` সফল। **Untested:** দুটি ফোনে আসল মিডিয়া সংযোগ (এখানে ক্যামেরা/মাইক নেই) — নিচের ধাপ আপনার ফোনে দেখবেন।

---

## ৪. আপনার ফোনে যাচাইয়ের নিয়ম
1. দুইটা ইউজার অ্যাকাউন্ট, দুটোতেই একবার অন্তত একটা মেসেজ (নাহলে কল ব্লক হবে — ইচ্ছাকৃত)।
2. দুটো ফোনেই অ্যাপ খোলা রাখুন → একজনের চ্যাট থেকে 📞/🎥 চাপুন → অন্যজনের ফোনে রিং আসবে → রিসিভ → কথা হবে।
3. **ইউজারের Settings → Calls বন্ধ** থাকলে কল যাবে না (আগের মতোই)।
4. ইনবক্স/চ্যাটে কল রেকর্ড থাকবে: `📞 Voice call · 0:42` / `Missed voice call`।

### তবুও connect না হলে (শুধু মোবাইল ডেটায়) — TURN লাগবে
আপনার VPS-এ coturn বসিয়ে নিজের রিলে দেওয়া যায় (বাইরের সার্ভিসে কলের অডিও না পাঠিয়ে)। এতে **VPS-এ পোর্ট খোলা/ফায়ারওয়াল বদলানো** লাগে (3478 UDP/TCP + 49152–65535 UDP) — তাই আপনার অনুমতি ছাড়া করিনি। বললে স্ক্রিপ্ট + env সহ করে দেব।

---

## ৫. ফাইল
* `server.ts` — user→user কল অনুমোদন + গার্ড, `call-signal` লিমিট ৩০০/মিনিট, নতুন `/api/rtc/ice` (STUN/TURN কনফিগ)।
* `src/components/CallOverlay.tsx` — ডাইনামিক ICE কনফিগ, connect ওয়াচডগ + auto ICE-restart, "Still connecting…" বার্তা।
* টাকার হিসাব/boost/commission: **কোনো পরিবর্তন নেই**।
