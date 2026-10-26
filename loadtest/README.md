# Staging load test kit (BoostPay)

Isolated by design: never runs against production.

* `seed.py <users> <tx_per_user> <conversations> <out.json>` — builds a production-shaped
  `app_state` document (user shapes taken from the real `INITIAL_DB` in `server.ts`,
  `template.json`). Antifraud/ip-block are switched **off in the seed only**, because the
  generator is a single host and would otherwise measure the 429 limiter.
* `lt.mjs <scenario> ...` — dependency-free load generator (node 20). Every virtual device
  gets its own bearer token **and** its own `X-Forwarded-For`, so per-IP / per-user rate
  limits behave like real phones.
  Scenarios: `read <path> <conc,...> <secs>`, `post <path> <conc,...> <secs>`,
  `session <devices> <secs>` (real poll intervals: db 6s, sync 20s, chat 6s, leaderboard 15s),
  `sse <conc,...> <secs>`, `write <n> <conc>`, `post-n <n> <conc>` (chat send),
  `login <n> <conc>`, `boost <n>`.
* Env: `BASE`, `SECRET` (must equal the staging container's `API_SECRET`), `USERS`, `AMT`.

Setup used for the 2026-10-26 run is on the VPS in `/opt/bp-lt/`
(`start-staging-big.sh`, `start-staging-small.sh`, `sample.sh`, `lt_run.sh`).
Two throw-away databases live in the existing Postgres container: `boostpay_staging`
(2,000 users) and `boostpay_staging_small` (200 users). Nothing else was touched.
