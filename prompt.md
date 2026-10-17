# BoostPay — Master Prompt History & Specification Document (`prompt.md`)

This document maintains the complete, chronological history of all user prompts, design clarifications, error fixes, database configurations, and architectural specifications for **BoostPay**.

---

## Quick Navigation & Prompt Index

| # | Prompt Title / Focus | Type | Key Outcomes & Directives |
|---|----------------------|------|---------------------------|
| **1** | Initial Concept & Feature Brief | Feature Request | Boost button (1% yield over 1m–24h), Admin panel (% config, user manage), Dokploy self-hosting readiness, high concurrency, activity logging, dark mode, responsive design, USD currency. |
| **2** | BoostPay Identity & Mechanics | System Redesign | Renamed to **BoostPay**, logo set, no fake balances, remove deposit/payout buttons, millisecond compounding engine, dynamic boost time based on relative balance (highest = 24h, lowest = 1m), numeric IDs, Web3 12-word phrase auth, P2P transfers, detailed transaction & profit history, real-time leaderboard with chat & scam awareness warning. |
| **3** | Plan Approval | Approval | Official sign-off to proceed with BoostPay architecture. |
| **4** | Admin Portal & Strict Restrictions | Security & Rules | Dedicated Admin login (`admin@gmail.com` / `123456`), removal of "Admin" label in user app, unlimited treasury generator, P2P message monitoring, remove demo data, disable transfers while boost is active, click-to-copy IDs, session yield vs ledger commit rules. |
| **5** | Clarifications: Balance Threshold & Usernames | Clarification | Highest balance gets 24h dynamically; completely remove usernames and display names across the entire codebase (numeric IDs only). |
| **6** | Plan Approval | Approval | Confirmation of Auth Gate, removal of usernames, dynamic duration curve, scam warning, P2P transfer lock during active boost. |
| **7** | Error Fix: Room Schema Mismatch | Bug Fix | Database migration handling for Room database versioning and schema integrity. |
| **8** | Messenger Inbox & UI Declutter | UI/UX Refinement | Zero-balance boosting prevention; full-page conversion inbox with conversation IDs; reward credit strictly upon full cycle completion; "Start Boost" & "Pause Boost" (no stop boost); remove admin credit filter; info-icon clean typography; admin full user controls (block, unblock, debit/credit, password change); millisecond yield rate (~0.000000026742%/ms); server-side background simulation. |
| **9** | Clarifications: Passkey Auth & Cycle Timing | Clarification | Web3 wallet passkey/mnemonic login; dynamic cycle dependent on relative balance; Messenger as dedicated bottom navigation tab. |
| **10** | Custom Compound Rate & Yield Renaming | Engine Update | Admin custom compounding engine rate input; rename realtime yield to **Reward**; keep background boost running through logout; modern P2P UI. |
| **11** | Clarifications: Rate Input & P2P Keypad | Clarification | Hourly percentage decimal rate input in Admin; modern sliding bottom sheet with instant numeric keypad for P2P; auto-credit completion banner on login. |
| **12** | Create Prompt Documentation File | Meta Directive | Mandated creation and continuous updating of `prompt.md` with every prompt list. |
| **13** | Dokploy PostgreSQL Credentials | Database Config | Production Dokploy database setup: IP `72.60.42.18`, host `boostpay-eoqehk`, port `5432`, db `boostpaydb`, user `boostpaydbuser`, pass `123456`, connection URL `postgresql://boostpaydbuser:123456@boostpay-eoqehk:5432/boostpaydb`. |
| **14** | Dokploy Dual-Mode Backend Connection | Clarification & Plan | Auto-detect internal hostname on Dokploy vs external IP; auto-init tables and indexes on backend startup; sync REST API with local cache. |
| **15** | Android Soft Keyboard Insets (IME) Fix | Bug Fix | Configured `adjustResize` and IME window insets padding to resolve FrameTracker timeout crashes. |
| **16** | Database Connection Verification Query | Inquiry | Added visual verification to confirm live Dokploy PostgreSQL connectivity. |
| **17** | Live PostgreSQL Status Badge | Clarification | Added live connection status badge in top navigation bar probing `http://72.60.42.18:3000`. |
| **18** | Schema Definition for UserBalance & Transaction | Database Schema | Initial schema definition matching Dokploy PostgreSQL tables for user balances and transactions. |
| **19** | Login Screen DB Connection Indicator | UI Feature | Display live database connection status badge directly on the Auth / Login screen. |
| **20** | Dokploy Docker Hostname & SSL Rules | Database Config | Set Docker internal hostname to `boostpay-eoqehk`, port `5432`, SSL disabled for internal Docker bridge network. |
| **21** | UserBalance Entity Specification | Data Layer | UserBalance entity created with `userId`, `balance`, `compoundingRate`. |
| **22** | Room Migration Version Increment | Bug Fix | Upgraded database version from 6 to 7 with fallback to destructive migration for clean schema reset. |
| **23** | Secure P2P Transfer Screen Component | Feature Request | Dedicated P2P transfer screen with recipient input, USD amount, active boost checks, and confirmation modal with biometric/password validation. |
| **24** | Recent Transactions Section Component | Feature Request | List component on the main screen fetching and displaying transaction records (type, USD amount, formatted timestamp, newest first). |
| **25** | Master `prompt.md` File Generation & App Sync | Documentation | Compile the comprehensive `prompt.md` documentation and synchronize full application state. |
| **26** | One-Click Direct App Install | PWA Feature | 1-click install button with zero popup modals, auto-triggering native installation, standalone manifest, and home screen PWA icons. |
| **27** | Navbar One-Click PWA Install Button | UI & Native Prompt | Direct PWA 'Install' button in the Navbar triggering browser's native install prompt for the BoostPay app with no popups. |
| **28** | Mobile Android Fintech Transformation | Full-Stack & UI Overhaul | Bottom nav with centered install button & Messenger; high-precision enlarged main balance decimals; admin recovery phrase & password inspection; password authentication for signup/login; dedicated `/admin` URL route; prompt.md hidden from frontend UI; full-stack Express backend with disk persistence (`data/boostpay_db.json`); eradicated AI-generated fluff ("USD Strict", fake connection chips). |
| **29** | Leaderboard Re-Integration & Responsive Layout | Feature & Layout | Re-integrated Leaderboard with 4-tab bottom navigation (`Wallet`, `Leaderboard`, `Install`, `Messenger`); balance ranking with numeric ID, lifetime profit, and direct peer chat trigger; removed artificial mobile-only viewport frame ("no need mobile only framing") for a modern responsive design. |
| **30** | Dokploy Nixpacks Node.js 20 Upgrade | Deployment Fix | Added `nixpacks.toml` configuration specifying Node.js 20.x LTS, Bun, and Caddy to resolve the Node.js 18 End-Of-Life build error on Dokploy. |
| **31** | Nixpacks Caddy Conflict Removal | Deployment Fix | Removed `caddy` from `nixpacks.toml` nixPkgs to prevent systemd service file conflict during Dokploy Nixpacks build, ensuring execution runs exclusively via Node.js/Express server. |
| **32** | Full-Stack Server Boosting & Robust Fixes | Full-Stack Overhaul | Server-side background boosting ticker in `server.ts` processing active boosts in real time while offline or logged out; persistent session recovery on reload; robust clipboard copy helper; PWA install button displaying "Open" without popups when installed; full-stack backend admin operations. |
| **33** | Sequential User IDs Starting from 1 | Identity & Data Layer | Transformed user IDs from random 6 digits to sequential serial numbers starting from 1 (1, 2, 3...); automated server & client auto-increment allocation; migrated legacy database and local storage records. |
| **34** | Email & Password Authentication | Authentication | Replaced 12-word recovery phrase login and signup with standard Email and Password authentication while retaining sequential numeric User IDs (1, 2, 3...). |

---

## Detailed Prompt Logs

### Prompt 1: Initial Concept & System Architecture
* **Original User Input:**
  > "make app, app e boost button thakbe , boost e click korle balance e joto tk thakbe sei takar 1% kore add hote thakbe 1 minute theke 24 gontar jonno , admin penal banate hobe alada kore jate apps manage kora jay , admin penal e % set kora jabe , apps ta dockpoly self hosted er jonno ready korte hobe , and provide a secure authentication system for user profiles. Ensure the database is encrypted and supports high concurrent user traffic. Also, implement comprehensive activity logging and real-time transaction monitoring features. Finally, ensure the UI is fully responsive across all device types. for seamless accessibility on desktop, tablet, and mobile platforms. This should optimize the overall user experience and reliability. Integrate OAuth 2.0 for secure, scalable authentication throughout. Additionally, incorporate dark mode support to accommodate varied user preferences and lighting conditions. Furthermore, include real-time push notifications to keep users engaged with critical updates. Finally, ensure comprehensive data encryption at rest and in transit. These measures will ensure both user privacy and high platform accessibility. Are there any specific frameworks or backend services you recommend using for this?"
* **Core Requirements:**
  - Boost button that compounds existing balance at 1% for a duration ranging between 1 minute to 24 hours.
  - Dedicated Admin Panel for managing the app and configuring compounding percentage rates.
  - Ready for self-hosted Dokploy deployment with high concurrent user traffic.
  - Secure profile authentication, activity logging, and real-time transaction monitoring.
  - Responsive design across desktop, tablet, and mobile.
  - Dark mode support and USD currency standard.

---

### Prompt 2: BoostPay Branding, Compounding Mechanics & P2P Features
* **Original User Input:**
  > "no fake or demo balance , need sent money , need auth signup login , balance e j0oto tk thakbe seitar opor compound hobe , payout ,deposit button thakbe na , payout deposit , codebase theke remove kore dan , apps compress klore small size korte hobe , boost korle proti milisecount e balance barteh thakbe , apps er nam boostpay koren , apps er logo o boost pay koren , boost stop korle automatic sei time theke start hobe , boost balance er opor depend kore automatic time set kore debe , jar sobcheye besi balance tare 24 hour debe jar balance sobcheye kom tare 1 minute kore debe , maje jar balance joto sei onojaiye time set kore debe , user er jonno alada user id lagbe , and username lagbe , signup login trust wallet er moto phrese and password deye hobe , transection history thakbe , history te transection er full details thakbe , sent money , and mining/ boost er history alada vave filtered thakbe , transection e click korle full details show korbe , profit history thakbe , today profit , 7 days profit , lifetime profit , date wise profit selections , life time , currency only usd thakbe , leaderboard lagbe , jar balance besi take 1e rakbe , jar balance kom se niche thakbe , user tar raknk koto number e ache seita dekte parbe , realtime leadderboard hote hobe , leader board theke user der message korte parbe , and message korle akta warnig asbe be awer from scammer akta details awarness warning asbe jate oporichito karo sathe arthik lenden na kore,"
* **Key Decisions & Requirements:**
  1. Name: **BoostPay**, with custom BoostPay branding.
  2. No fake/demo balance. Real persistent ledger only.
  3. Complete removal of deposit/payout buttons from the codebase.
  4. Real-time compounding simulation running at millisecond intervals.
  5. Dynamic boost duration proportional to user balance relative to the community: highest balance receives 24 hours, lowest receives 1 minute, interpolated dynamically.
  6. Pause and resume capabilities preserving elapsed duration.
  7. Trust Wallet-style 12-word mnemonic phrase authentication.
  8. P2P "Send Money" transfers.
  9. Transaction history with modal detail drilldown.
  10. Filtered profit metrics: Today's Profit, 7-Day Profit, and Lifetime Profit.
  11. Real-time leaderboard ranked by main balance, displaying rank, numeric ID, and lifetime profit.
  12. Direct messaging from leaderboard with mandatory anti-scam awareness warning curtain.

---

### Prompt 3: Plan Approval
* **Original User Input:**
  > "Proceed with BoostPay execution."
* **Result:** Initial foundational architecture created.

---

### Prompt 4: Admin Portal Separation, User ID Standardization & Rule Enforcement
* **Original User Input:**
  > "logout button lage , login signup button lagbe , login /signup chara ko account e dokte parbe na , admin@gmail.com password 123456 deye admin e login korte parbe , user app theke admin likhe remove kore dete hobe , admin unlimited balance genarate korte parbe , and user der dete parbe , massage inbox lagbe , leaderboard e user er lifetime er profit o show korbe , but ranking show hobe only account er main balance er vitti te , only admin can join as a supposrt , another user cant join as s suppost , massender e sob message er list thakbe , sob fake user demo user demo data remove kore dan code base theke , atat production ready app kore dan , only real user thakbe , username minimum 5 and max 8 hote hobe , user id only numberic hote hobe , sah-256 valid agula ojotha likha golo remove kore dan , boosting time dinamicly hobe , jar balance besi tahre boosting time 24 gonta dibe , jar balance kom tare 1 min dibe , milisecond compounding ei likha ta fix kekon valo akta nam dan , sent money p2p page er ui fix koren , apps er joto error ache fix koren , admin penal e login korle full admin penal pabe , admin penal kono user er opor depend kore hobe na , admin penal thake full apss er sob kiche control kora jabe , user e jodi admin penal theke manusl deposit daye tahole ledger e admin credit filter show korbe , leaderboard er nam show korbe na , boost stop korle ledger e and profit e add hobe , boost on korle sent money kora jabe na , sent money recive hole automaticly boost time dynamicly bere jabe , balance kome gale dynamicly boosting time kome jabe , id number and username e click korle copy hoye jabe ,"
* **Key Decisions:**
  - Login gate: App is inaccessible without login/signup.
  - Admin credentials: `admin@gmail.com` with password `123456`.
  - Removal of "Admin" labels/links from user interface.
  - Unlimited Treasury for Admin to credit balances directly to users.
  - Only Admin can join chats as official Verified Support.
  - Messenger Inbox consolidating all conversations.
  - Numeric-only User IDs with click-to-copy feature.
  - Strict prohibition: **Users cannot send money while their boost is running**.
  - Dynamic boosting duration recalculates when balance changes via transfers.

---

### Prompt 5: Clarifications on Duration & Username Elimination
* **Q1:** What balance threshold should qualify a user for the maximum 24-hour boost duration?
  - **User Answer:** *Relative ranking where highest balance in leaderboard gets 24 hours.*
* **Q2:** How should new users register their account on the login and signup screen?
  - **User Answer:** *Do not need username, sob agar motoi thakbe username lagbe na, username remove kore dan codebase theke, username feature codebase theke remove kore dan.* (Complete elimination of usernames; numeric ID only).

---

### Prompt 6: Plan Approval
* **Original User Input:**
  > "Proceed with BoostPay execution"
* **Result:** Implemented pure numeric IDs, removed all username references, enabled relative ranking calculation, and added the transfer-lock during boost.

---

### Prompt 7: Error Fix — Room Schema Mismatch
* **Error Encountered:** `FATAL EXCEPTION: Room cannot verify the data integrity. Identity hash mismatch.`
* **Resolution:** Upgraded database version to 3 with `.fallbackToDestructiveMigration(dropAllTables = true)` for clean table re-creation.

---

### Prompt 8: Messenger Inbox Overhaul & Zero-Balance Guard
* **Original User Input:**
  > "do not need display name in signup page , and do not need name in full app codebase , do not start boosting on 0 balance user , massage e click korle full page conversion asbe , direct inbox e asbe , full boost compleate na hole profit e and ledger e reward add hobe na , profit history te and ledger e only reward nam show korbe , boost button e reusme boost , start boost thakbe , stop boost thakbe na , only puse boost thakbe , push boost korle sent money korte parbe , admin chaille p2p message e giye chat korte parbe , full messanger er moto koren , jate chat er vitor dokle conversion dekha jay , proti conversion er id thakbe jate admin search kore khoje paye ,
Ffilter theke admin credit button remove kore dan .
full codebase theke unnessery likha golo remove kore dan jmon live yield streaming , realtime , information text golo i button e dokiye ui fresh and clean rakhon ,
apps e kono error thakle fix koren admin access portal autofill ata remove kore dan , admin penal theke user er full control lagbe , block , unblock , temporary block , debit and credit balance , password change , id password deye only admin login korte parbe , user id email paasword deye login korte parbe na , userid search deye message kora jabe inbox theke , boost প্রতি মিলিসেকেন্ডে প্রায় ০.০০০০০০০২৬৭৪২%। barte thakbe , sob kichu server e count hobe , jate apps close holeo sob cholte thake ."
* **Key Directives:**
  1. No display names or usernames anywhere in the codebase.
  2. **Do not start boosting on 0 balance users.**
  3. Boost controls: **"Start Boost"**, **"Pause Boost"**, **"Resume Boost"** (no "Stop Boost").
  4. If paused, user is allowed to send money.
  5. Profit/Ledger credit rule: Yield is only committed to main balance and ledger once the full cycle completes.
  6. Ledger and profit label must be simply **"Reward"**.
  7. Messenger: Full conversation screen with unique Conversation IDs searchable by Admin and users.
  8. Admin user management: Block, unblock, temporary lock, manual credit/debit, passkey resets.
  9. Compounding rate: ~0.000000026742% per millisecond (~1% per hour).
  10. Server-authoritative compounding persistence.

---

### Prompt 9: Clarifications — Web3 Passkey & Navigation
* **Q1:** How should regular users access their wallet if credential login is reserved for admin?
  - **User Answer:** *Web3 wallet address or mnemonic passkey.*
* **Q2:** What cycle duration should be required to complete a full boost before rewards credit?
  - **User Answer:** *Dynamic cycle depend on balance.*
* **Q3:** Where should the Messenger be positioned in the main navigation?
  - **User Answer:** *Dedicated bottom navigation tab.*

---

### Prompt 10: Custom Compound Rate & Session Yield Renaming
* **Original User Input:**
  > "compound engine rate ami type kore dete chai , fix conversion inbox ,
main balance e boosting balance realtimer show hobe na session yield e show hobe and atar nam reward kore dan , boosting server e cholbe jate logout korleo boosting cholte thake , p2p money transfer er ui fix koren ,"
* **Key Directives:**
  - Admin custom compounding rate input.
  - Main balance does not tick in real time; real-time gain is shown under "Reward" session yield card.
  - Background server boost continues uninterrupted even if logged out.
  - Improved P2P transfer interface.

---

### Prompt 11: Clarifications on Admin Input & P2P Keypad
* **Q1:** How would you like to enter the custom compounding engine rate in Admin Panel?
  - **User Answer:** *Hourly percentage rate with decimal input.*
* **Q2:** Which style do you prefer for the P2P money transfer UI?
  - **User Answer:** *Modern sliding bottom sheet with instant numeric keypad.*
* **Q3:** When a user logs in after a boost finishes in background, how should the reward be presented?
  - **User Answer:** *Auto-credit with completion banner upon login.*

---

### Prompt 12: Prompt Document Requirement
* **Original User Input:**
  > "create prompt.md file and update every prompt list"
* **Directive:** Maintain `prompt.md` in repository tracking all user instructions and system specifications.

---

### Prompt 13: Dokploy PostgreSQL Configuration
* **Original User Input:**
  ```text
  docpoly
  72.60.42.18
  Internal Credentials
  boostpaydbuser
  boostpaydb
  123456
  5432
  boostpay-eoqehk
  postgresql://boostpaydbuser:123456@boostpay-eoqehk:5432/boostpaydb
  ```
* **Database Parameters:**
  - **Host / Docker Network Host:** `boostpay-eoqehk`
  - **External Server IP:** `72.60.42.18`
  - **Port:** `5432`
  - **Database Name:** `boostpaydb`
  - **Username:** `boostpaydbuser`
  - **Password:** `123456`
  - **Full Connection URI:** `postgresql://boostpaydbuser:123456@boostpay-eoqehk:5432/boostpaydb`

---

### Prompt 14: Dokploy Dual-Mode Backend Connection
* **Decisions:**
  - Auto-detect hostname: Internal Docker container `boostpay-eoqehk` when running inside Dokploy; external IP `72.60.42.18` when running external client.
  - Auto-initialize tables (`users`, `balances`, `transactions`, `conversations`, `messages`, `system_config`) on startup.
  - Dual sync between local storage and backend.

---

### Prompt 15: Error Fix — Android IME Insets
* **Issue:** `FrameTracker: force finish cuj, time out: J<IME_INSETS_SHOW_ANIMATION>`
* **Fix:** Applied `adjustResize` soft input mode and `WindowInsets.safeDrawing` + `imePadding()` to handle smooth on-screen keyboard animations.

---

### Prompt 16 & 17: Database Connection Indicator
* **Original User Input:**
  > "apps databse er sathe conncet hoyse kina bojbo kivave?"
* **Resolution:** Implemented live PostgreSQL connection badge in top navigation bar probing Dokploy status at `http://72.60.42.18:3000` with visual green/orange status chip.

---

### Prompt 18: Initial Schema Setup
* **Directive:** Defined schema for `UserBalance` and `Transaction` compatible with PostgreSQL on Dokploy.

---

### Prompt 19: Login Screen Database Status
* **Directive:** Display live database connectivity status badge on the Auth/Login screen so users can verify connection before authentication.

---

### Prompt 20: Dokploy Docker Hostname & SSL Rules
* **Configuration:** Host `boostpay-eoqehk`, port `5432`, SSL disabled for internal Docker bridge network.

---

### Prompt 21: UserBalance Entity Specification
* **Fields:** `userId` (numeric string), `balance` (double/numeric USD), `compoundingRate` (hourly percentage).

---

### Prompt 22: Room Version 7 Upgrade
* **Fix:** Incremented schema version to 7 with destructive migration fallback to resolve integrity hash mismatches.

---

### Prompt 23: Secure P2P Transfer Screen Component
* **Features:** Dedicated P2P transfer interface with recipient address input, USD amount, active boost checks, and confirmation modal with biometric/passkey validation.

---

### Prompt 24: Recent Transactions Section Component
* **Features:** Transaction history list component displaying transaction type (Transfer, Reward), amount formatted in USD, formatted timestamp, and drilldown details.

---

### Prompt 25: Master `prompt.md` Creation & System Alignment
* **Directive:** Create and keep up to date the complete `prompt.md` tracking all prompts and system requirements.

---

### Prompt 26: One-Click Direct App Install
* **Original User Input:**
  > "make install button , one click install no need popup"
* **Key Requirements & Implementation:**
  - One-click PWA app installation button directly mounted in the Navbar and AuthGate screen.
  - Zero intermediary popups or confirmation dialogs — clicking immediately triggers native browser installation (`deferredPrompt.prompt()`).
  - Integrated `vite-plugin-pwa` with auto-updating Service Worker, Web App Manifest (`standalone` mode), and standard icons (192x192, 512x512, maskable, apple-touch-icon).
  - Clean visual feedback displaying "Installed" / "Installed!" badge when the app is running in standalone mode or immediately after install.

---

### Prompt 27: Navbar One-Click PWA Install Button
* **Original User Input:**
  > "Add a one-click PWA 'Install' button to the Navbar component that triggers the browser's native install prompt for the BoostPay app."
* **Key Requirements & Implementation:**
  - Verified and enhanced the one-click PWA 'Install' button (`id="pwa-install-button"`) located directly in the Navbar header.
  - Connected directly to the browser's `beforeinstallprompt` event so that a single click directly fires the browser's native installation prompt.
  - Avoided any custom confirmation dialogs or intermediary popups.
  - Automatically indicates active install loading, success state, and suppresses the install action when already running in standalone mode.

---

### Prompt 28: Mobile Android Fintech Transformation & Persistent Architecture
* **Original User Input:**
  > "make it non scorable apps , install button niche middle e messanger er sathe shift koren , main balance er decimal boro korte hobe jate 1 dollar er reward o dekha jay , admin penal theke phrese dekha jete hobe , signup /login e password lagbe , admin panel /admin url e kore dan , domain/admin login , prompt.md file e only prompt golo save kore rakben , ata website e show korar dorkar nai , all database e rakte hobe jate update dele kono user er kono data remove ba missing na hoy, ui fix koren , USD Strict er moto ai generated unnecessary likha golo remove kore clean ui kore dete hobe , make smart fintech app banking level easy ui , mobile screen er bire jeno kono ui design na hoy , make perfect ui for only mobile , look like android app ."
* **Key Requirements & Implementation:**
  1. **Non-Scorable App:** Removed game-like leaderboards and score rank widgets from both the navigation and view hierarchy.
  2. **Shifted Bottom Install Navigation:** 3-tab mobile navigation bar featuring **Wallet**, centered elevated **Install App** button, and **Messenger**.
  3. **High-Precision Main Balance:** Balance rendered with large prominent whole numbers and clear 6-decimal expansion (`$250.000000`) so even micro-yield and $1 rewards are immediately visible.
  4. **Admin Phrase & Password Inspection:** Admin portal User Directory displays user recovery phrases and security passwords with reveal and copy triggers.
  5. **Password Authentication:** Both signup and login require user-configured security passwords alongside 12-word recovery seed phrases.
  6. **Dedicated `/admin` URL Route:** Separate administrative URL routing (`/admin` and `#/admin`) with dedicated administrator credentials (`admin@gmail.com` / `123456`).
  7. **Internal `prompt.md` Storage:** Removed prompt viewer modal and triggers from the user interface; maintained file strictly as the codebase specification reference.
  8. **Permanent Server Database:** Full-stack Express backend with disk persistence (`data/boostpay_db.json`) preventing data wipes on client reload or updates.
  9. **Anti-Slop Clean UI:** Removed "USD Strict", fake connection chips, pulse dots, and artificial status clutter.

---

### Prompt 29: Leaderboard Re-Integration & Responsive Layout
* **Original User Input:**
  > "leadderboard feature missing"
* **User Feedback on Plan:**
  > "no need mobile only framing"
* **Key Requirements & Implementation:**
  1. **Leaderboard Re-Integration:** Brought back the real-time community Leaderboard ranked by main balance, displaying user ranks, numeric IDs (`#849201`), active balances with high decimal precision, and lifetime compounding profits.
  2. **Direct Peer Chat Action:** Each leaderboard entry features a direct **Chat** button that immediately switches to the Messenger view and focuses a conversation with that peer.
  3. **4-Tab Bottom Navigation Bar:** Reconfigured navigation with 4 balanced items: **Wallet**, **Leaderboard**, **Install**, and **Messenger**.
  4. **Responsive Layout (No Mobile-Only Framing):** Removed artificial 430px mobile device framing and fake status bar mockup per user directive ("no need mobile only framing"), allowing the app to render responsively across mobile, tablet, and desktop viewports.

---

### Prompt 30: Dokploy Nixpacks Node.js 20 Upgrade
* **Deployment Error Addressed:**
  > `error: Node.js 18.x has reached End-Of-Life and has been removed`
* **Resolution & Implementation:**
  - Created root `nixpacks.toml` specifying `nodejs_20`, `bun`, and `caddy`.
  - Ensures Nixpacks builder on Dokploy correctly builds using Node.js 20.x LTS and Bun.

---

### Prompt 31: Nixpacks Caddy Conflict Removal
* **Deployment Error Addressed:**
  > `error: Unable to build profile. There is a conflict for the following files: /nix/store/.../caddy.service`
* **Resolution & Implementation:**
  - Removed `caddy` from `nixpacks.toml` `nixPkgs` array (retaining `["nodejs_20", "bun"]`).
  - Eliminates the service file collision and allows the app to serve requests entirely through the Node.js/Express server (`server.ts`).

---

## Technical Specifications Summary

### 1. Identity & Security Rules
- **No Usernames / No Display Names:** Users are identified strictly by numeric User IDs (e.g. `983421`, `541290`).
- **User Authentication:** 12-word Web3 mnemonic phrase generator and passkey import.
- **Admin Authentication:** Email `admin@gmail.com` with password `123456`.
- **Admin Separation:** User app contains no "Admin" buttons or text links. Access is through the login credential gate.
- **Support Chat Restriction:** Only Admin can represent official Verified Support in chat threads.

### 2. Compounding Engine
- **Base Rate:** Default ~1% per hour (~0.000000026742% per millisecond), configurable by Admin via decimal hourly percentage input.
- **Dynamic Cycle Duration:** Relative ranking based on balance:
  $$\text{Duration} = 1\text{m} + \left(\frac{\text{Balance} - \text{MinBalance}}{\text{MaxBalance} - \text{MinBalance}}\right) \times (24\text{h} - 1\text{m})$$
- **Zero-Balance Guard:** Boosting cannot be started on accounts with $0.00 balance.
- **Commit Rule:** Accrued yield is shown in real time as **Reward**, but is only credited to main balance and ledger once the full cycle is successfully completed.
- **Boost Controls:** **Start Boost**, **Pause Boost**, **Resume Boost**.
- **P2P Lock:** Transfers cannot be sent while boost is actively running; pausing allows transfers.

### 3. Database Architecture (Dokploy PostgreSQL)
- **Host:** `boostpay-eoqehk` (Internal) / `72.60.42.18` (External)
- **Port:** `5432`
- **Database:** `boostpaydb`
- **User:** `boostpaydbuser`
- **Password:** `123456`
- **Tables:** `users`, `user_balances`, `transactions`, `conversations`, `messages`, `system_config`.

---

### Prompt 32: Full-Stack Server Boosting & Robust Fixes
* **Key Fixes & Enhancements:**
  1. **Robust Copy Helper:** Implemented `copyToClipboard` utility with `navigator.clipboard.writeText` and fallback to `document.execCommand('copy')`.
  2. **Session Persistence:** App restores `boostpay_current_user_v3` on reload, preventing logout.
  3. **Dynamic Boost Duration:** Community-relative calculation (highest balance = 24h, lowest = 1m).
  4. **PWA Install / Open Button:** Detects installation; when installed, displays "Open" button launching app without popups.
  5. **Full-Stack Admin Backend:** Admin CRUD operations, credits/debits, block/unblock, and phrase/password inspection routed via backend APIs and persisted to `data/boostpay_db.json`.
  6. **Server-Side Background Boosting:** `server.ts` runs a periodic background ticker updating user boost progress in real time. When completed, rewards are credited to main balance and ledger automatically, even while users are offline or logged out.

---

### Prompt 33: Sequential User IDs Starting from 1
* **Original User Input:**
  > "fix userid"
  > Clarification: "userid seriall onojaiye hote hobe, 1 theke start hobe"
* **Key Requirements & Implementation:**
  1. **Sequential Identification Engine:** Replaced random 6-digit number generation with auto-incrementing serial IDs starting from integer `1` (`1`, `2`, `3`, ...).
  2. **Server & Client Next-ID Resolution:** Added `getNextSequentialUserId` resolving `Math.max(...numericIds) + 1` across both backend `/api/users/register` and frontend `BoostPayStore.registerUser`.
  3. **Non-Destructive Legacy Data Migration:**
     - In `data/boostpay_db.json`, mapped user `849201` -> `1` and user `223344` -> `2`.
     - Automatically updated all linked transactions (`userId`, `senderId`, `recipientId`), notifications, conversations, and transaction notes.
     - Added client-side migration in `BoostPayStore` so active user sessions in browser `localStorage` upgrade seamlessly without requiring re-login.
  4. **P2P Transfers & Auth:** Supports instant lookup and transfers to recipient IDs (e.g. `1`, `2`) and login via sequential ID or mnemonic phrase.

---

### Prompt 34: Email & Password Authentication
* **Original User Input:**
  > "remove phrese login and impilement email signup login"
  > Clarification: "Login with Email and Password", "Auto-assign next sequential numeric ID on email signup"
* **Key Requirements & Implementation:**
  1. **Email & Password Auth Gate:** Removed 12-word recovery phrase generation and copy-phrase boxes. Implemented clean Email address and Security Password inputs for both Sign In and Create Account.
  2. **Sequential ID Integration:** New sign-ups with email automatically receive the next sequential numeric ID (`1`, `2`, `3`, ...).
  3. **Backend & Store Support:** Updated `registerUser` and `loginUser` in `BoostPayStore` and `server.ts` to authenticate using email address, numeric ID, or legacy phrases.
  4. **Admin Portal Inspection:** Updated the Admin User Directory table to display user Email Addresses alongside their sequential User ID, balances, and profits.

---
