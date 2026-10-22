# Report #9 + #9.1 — Banglish Final Report (2026-10-20)

**Deployed:** `6dba43f` → **Live Version v1.2.1792476848** verified VPS `boostpay-l2q4ry Running 40s ago` `State loaded 23 users 301 tx`

## Ki ki kora hoise (8 tasks + audio→video accept)

**1) Recent Transactions pagination window (5 per page sliding)**
- `RecentTransactionsSection.tsx` crush fix: full list show na kore sliding window `startIndex` 5 per page `Prev | Page x of y | Next` buttons, 5 er kom hole pagination hide. Filter change e auto reset start 0.

**2) Recent Refer Earnings same pagination**
- `ReferView.tsx` recent refer list same 5 per page sliding `recentPage` state, `Prev/Next` disabled logic, small count e auto hide.

**3) Full site renderless realtime**
- `App.tsx` polling `15000 → 4000ms` (4s), plus `storage` event cross-tab, plus manual `boostpay:refresh` dispatch. Kono render block chara silent refresh.

**4) Auto-reload on new deploy**
- `App.tsx` `bootVersion` capture on load, `setInterval 30s` `fetch /api/version` compare → mismatch hole `SW update` + `window.location.reload()`. User puran build e atke thakbe na.

**5) Settings build number**
- `SettingsModal.tsx` open er somoy `fetch /api/version` → `Build v{version.slice(-6)}` na hole `b{bootTime}` fallback. Header er pashe version visible.

**6) Min boosting 0.1**
- `server.ts /api/boost/start` `balance<=0 → <0.1` error `Minimum 0.1 balance required to start Boosting`. `WalletView.tsx` same client check + warning text `Minimum 0.1`.

**7) Min send 0.1**
- `server.ts /api/transfer` + `P2PTransferModal.tsx` same `<0.1` check error `Minimum 0.1`.

**8) Rename compounding → boosting**
- Global sed: `RecentTransactionsSection, PaginatedTransactionsView, WalletView, P2PTransferModal, ReferView, AuthGate, WalletSkeleton, format.ts, types.ts, server.ts` — YIELD alerts + `commissionOnBoosting` alias + `Boosting Cycle Complete` text.

**9.1) Audio theke video te switch accept lagbe (user request)**
- Age auto-renegotiate chilo — ekhon peer ke **Accept/Decline** korte hobe.
- `CallOverlay.tsx`:
  - New states `videoSwitchPrompt`, `waitingForVideoAccept`.
  - `performVideoUpgrade()` alada kora — sudhu accept er por call hoy.
  - `requestVideoSwitch()` pathay `video-request` signal, 30s timeout e auto cancel.
  - Signal handler e `video-request` → prompt UI, `video-accept` → `performVideoUpgrade()`, `video-decline/video-cancel` → error + clear waiting.
  - Receiver er jonno `Peer wants to switch to video — accept?` modal with Accept/Decline buttons, caller er jonno `Waiting for peer to accept video…` + Cancel.
  - Finish/cancel/timeout sob khetre prompt clear kore `finishCall` e reset.

## Build & Deploy
- `tsc --noEmit` OK 0 errors, `vite build` precache 14 entries 852.47 KiB (687.10 kB gz 193.83).
- `git commit 6dba43f feat: audio→video switch requires peer Accept/Decline handshake` ff-only push via `boostpay_deploy` key OK `bfb1423..6dba43f`.
- VPS verify: `docker service ps boostpay-l2q4ry` `rfqjv43j Running 20s ago` `xzo8on Shutdown 16s ago`, `docker logs` `State loaded 23 users 301 tx [Version: v1.2.1792476848]`.

## Constraints maintained
- Zero admin links in user app, admin/DB separate, user names/emails never shown, compounding rates secret, leaderboard sliding 10 window no total count, data/ never treated as test pollution.

---
Next: Video downgrade (video→audio) ekhono direct — chaile same accept flow add kora jabe. P2P voice playback + call ringing sob ager moto intact.
