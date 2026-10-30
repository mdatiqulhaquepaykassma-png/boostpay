# BoostPay Support Chat (`supportchat.boostpay.online`)

Mobile-first **PWA** for BoostPay support staff. It shows **only the messages
users send to support** — every other channel (P2P, agent, management) is
filtered out.

* Same-origin proxy to the main API (`/api/*` → `API_PROXY_TARGET`, default
  `http://boostpay-l2q4ry:3000`), exactly like the admin/agent consoles.
* Staff sign in with an **admin console account** (`SUPPORT` or `SUPERADMIN`).
  Sessions are the API's normal device-bound tokens; a login on another device
  revokes the previous one.
* Inbox = `GET /api/chat/messages?userId=ADMIN_SUPPORT` (admin-only on the API),
  filtered client-side to DM threads whose peer is a real user and where the
  user has actually written something. New user messages arrive over
  `/api/chat/stream` (SSE) — no refresh needed.
* Reply = `POST /api/chat/send` as `ADMIN_SUPPORT`. Photos and voice notes that
  users send are rendered inline (`/api/chat/file/<id>`).
* Unread badges use the server's per-conversation read checkpoint
  (`POST /api/chat/read`).

No money logic, no user data beyond the support thread, and nothing is cached
in the service worker except the app shell.

