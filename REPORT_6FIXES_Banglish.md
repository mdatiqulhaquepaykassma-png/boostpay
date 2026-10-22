# BoostPay 6-Fix Report — Banglish (2026-10-20)

**Version:** `98b74e2` → `v1.2.1792473688` live on `boostpay.72-60-42-18.sslip.io` + GitHub `main` ff-only pushed  
**Status:** Build `677KB (gzip 192KB)` pass, `tcs --noEmit 0 errors`, auto-deploy `done`

---

## 1. Recent Refer Earnings — Date+Time + Full Details Modal ✅
**Problem chilo:** List e `toLocaleDateString()` diye sudhu date dekhato, time missing. Modal e commission ID / balanceAfter chilo na.

**Fix korlam:**
- `ReferView.tsx:279` → `toLocaleString()` — ekhon date+time both dekhabe.
- Modal e add korlam: `Commission ID`, `Date & Time`, `Source TX`, `Day Key`, `Balance After` + duplicate block note.
- Upline card eo `toLocaleString()` diye time show.

**Test:** ReferView recent commission list e click → full modal with all fields visible.

---

## 2. Refer Live-Remaining / Boosting Bug ✅
**Problem chilo:** Server `/api/refer/my` e `ru.boostState.elapsedMs` stale value return korto — `liveBoostState(ru)` use korto na, tai live countdown drift korto. Client progress bar `elapsedMs/cycleDurationMs` diye static, live tick add chilo na. Paused thakle `Live Remaining` e `—` dekhato.

**Fix korlam:**
- `server.ts:5033` → `liveBoostState(ru)` use kore `elapsedMs`, `cycleDurationMs`, `boostActive` fresh calculate. Ekhon pause/resume accurate.
- Client `ReferView.tsx:190` badge e `Boosting • {formatDuration(remaining)}` e `nowTick - lastFetch` delta add, paused hole frozen remaining show `Paused • Xm Ys`.
- `Live Remaining` card eo same logic: `boostActive ? liveRemaining : boostPaused ? frozenRemaining : '—'` + color fix.
- Progress bar `width: (elapsedMs + (boostActive?delta:0))/cycleDurationMs` diye live animates.

---

## 3. Recent Transactions — Compounding ON e Stable ✅
**Problem chilo:** Compounding cycle cholle new `REWARD` tx ashle list e reorder / flicker hoto kina audit korte bola hoise.

**Check korlam:** `RecentTransactionsSection.tsx` memo sudhu `transactions+userId` er upor depend kore, `boostState` er upor na. `WalletView.tsx` theke `BoostPayStore.getTransactions()` same reference pass kore — polling e new tx na ashle re-render e bails out. `visibleCount` internal state, compounding tick e reset hoy na. Filter `userId===userId` only diye duplicate removed (`c033686` already).

**Result:** Compounding ON thakleo recent list stable — sudhu new `REWARD` tx add hole top e ashe, baki gulo shift hoy na.

---

## 4. Compounding Balance Security Check ✅
**Hardening add korlam ticker e (`server.ts:1215-1309`):**
- **PriorBal snapshot:** `priorBal = Number(user.balance)||0` store kore rakhi.
- **Amount bounds:** `finalYield` must be `finite && >0 && <= priorBal*0.5+1e-6` — abnormal yield block + warn log. Secret rate leak na kore generous 50% cap.
- **BalanceAfter verify:** `expectedBal = priorBal + finalYield` diye set, tarpor `Math.abs(balance - expectedBal)>1e-6` hole correct kore di.
- **Duplicate TX guard:** `TX-` ID generate loop 5 try porjonto collision check `db.transactions.some(t.id===txId)` — collision hole skip + warn.
- **Referral commission eo same:** `commission <= finalYield*0.1001` (max 10% rate), rate 1-10 check, `priorRefBal` verify, `RC-` ID duplicate check, `commTx` duplicate check. `balanceAfter` field both tx te add.

**Log:** Abnormal yield hole `[ticker] blocked abnormal yield` diye block, cycle complete kore infinite loop avoid.

---

## 5. Message Referred User from ReferView ✅
**Add korlam:** `ReferView.tsx` e `MessageCircle` import + protita referral card e `Message` button (active/paused hole). Click korle `onMessageUser(referredId)` call → `App.tsx` e `setActiveTab('MESSENGER')` + `chatTargetPeerId` set.

**Flow:** User Refer tab e giye tar refer kora friend er card e `Message` chap dile direct Messenger e chole jabe, oi peer er chat open.

---

## 6. Message Upline from ReferView ✅
**Add korlam:** Upline card e `Message Upline` full-width button (`sky-500/15` style). Click → same `onMessageUser(referrerId)` → Messenger.

**Prop plumbing:** `ReferView: FC<{userId:string; onMessageUser?:(id:string)=>void}>` + `App.tsx:472` e prop pass.

---

## Extra Polish
- Upline `Joined` date eo `toLocaleString()` time soho.
- Commission modal text e `duplicate blocked server-side` note.
- Build `191KB gzip` unchanged, no admin leak (client bundle 0 admin URLs).
- `liveBoostState` null fallback safe.

## Deploy
- `git commit 98b74e2` + `GIT_SSH_COMMAND="ssh -i boostpay_deploy" git push origin HEAD:main` ff-only success.
- Dokploy autoDeploy triggered `W7GTLDtc6DkokfS0dF3Uh` → `done` in 2 min, new task `82dec7d4a3a9` running `v1.2.1792473688` State `23u 299tx`.

**Next step:** User app e test korun — Refer live countdown ekhon second e second update, paused e frozen, earnings modal e full details, compounding e balance jump audit log e verify.

