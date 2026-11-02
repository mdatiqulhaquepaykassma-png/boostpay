#!/usr/bin/env python3
"""
tools/user-journey.py — walk through BoostPay exactly like a user, against a LOCAL
server, and report what breaks.

    python3 tools/seed-local-db.py 100
    ADMIN_EMAIL=admin@boostpay.local ADMIN_PASSWORD=AdminPass123 PORT=3901 \
      API_SECRET=test-secret NODE_ENV=production DATABASE_URL= HOST_WATCHDOG=off \
      ./node_modules/.bin/tsx server.ts &
    python3 tools/user-journey.py

Never pointed at production: it registers users, sends money, pays agents and
locks accounts. Each test uses its own fake client IP (via x-forwarded-for) so
the server's per-IP rate limits / lockouts do not bleed into the next test.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get('API', 'http://127.0.0.1:3901')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
U1 = ('u1@gmail.com', 'Staging123!')
U2 = ('u2@gmail.com', 'Staging123!')
U3 = ('u3@gmail.com', 'Staging123!')
AGENT = ('agent1@gmail.com', 'Staging123!')

PASS, FAIL, PROBLEMS = 0, 0, []
_ip_counter = [0]


def ip():
    """A fresh fake client IP per test — keeps rate-limit buckets independent."""
    _ip_counter[0] += 1
    return f'10.9.{_ip_counter[0] // 250}.{_ip_counter[0] % 250 + 1}'


def req(path, body=None, token=None, ip_addr=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'content-type': 'application/json'}
    if token:
        headers['authorization'] = 'Bearer ' + token
    if ip_addr:
        headers['x-forwarded-for'] = ip_addr
    r = urllib.request.Request(API + path, data=data, method='POST' if body is not None else 'GET', headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=25) as x:
            return x.status, json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}


def login(creds, ip_addr=None):
    s, j = req('/api/users/login', {'email': creds[0], 'password': creds[1]}, ip_addr=ip_addr or ip())
    return j.get('token'), j.get('user') or {}


def ck(name, ok, detail='', sev='MEDIUM', problem=None):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ''))
    else:
        FAIL += 1
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ''))
        if problem:
            PROBLEMS.append({'sev': sev, 'title': name, 'detail': problem})


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def section(t):
    print(f"\n[{t}]")


# ── 1. brand new user ────────────────────────────────────────────────────────
section('1. a new user installs the app and signs up')
new_email = f'ujourney{int(time.time()) % 100000}@gmail.com'
my_ip = ip()
s, j = req('/api/users/register', {'email': new_email, 'password': 'Journey123!', 'phrase': 'testphrase'}, ip_addr=my_ip)
ck('signup works', s in (200, 201) and (j.get('success') or j.get('user')), f"{s} {str(j)[:70]}", 'HIGH',
   'No new user can get in.')
tok_new = j.get('token')
if not tok_new:
    s, j = req('/api/users/login', {'email': new_email, 'password': 'Journey123!'}, ip_addr=my_ip)
    tok_new = j.get('token')
ck('the new account can log in', bool(tok_new), f"{s}", 'HIGH', 'Login fails right after signup.')
my_id = (j.get('user') or {}).get('id') or (req('/api/db?slim=1&only=stream', token=tok_new, ip_addr=ip())[1].get('me') or {}).get('id')
s, j = req('/api/db?slim=1', token=tok_new, ip_addr=ip())
users = j.get('users') or []
ck('first screen loads (slim bootstrap)', s == 200 and j.get('slim') is True, f"{s} {len(users)} users", 'HIGH',
   'The home screen cannot load for a fresh account.')
me_bal = (req('/api/db?slim=1&only=stream', token=tok_new, ip_addr=ip())[1].get('me') or {}).get('balance')
ck('the new account starts at exactly $0', me_bal == 0, f"balance={me_bal}", 'HIGH',
   'A new account must start at zero.')

# ── 2. privacy ───────────────────────────────────────────────────────────────
section('2. what can one user see about the others?')
others = [u for u in users if u.get('id') != my_id]
leak = [k for u in others for k in ('email', 'password', 'passwordPlain', 'phrase', 'passwordHash') if u.get(k)]
ck('no e-mails / passwords / phrases of other users', not leak, f"{len(others)} other users, leaked={sorted(set(leak))}", 'CRITICAL',
   'Users’ e-mail addresses reach every phone — that is a data leak, not just a privacy smell.')
extra = sorted({k for u in others for k in u.keys()})
ck('directory entries are a short, fixed shape', len(extra) <= 12, f"fields={extra}", 'LOW',
   f'Directory entries carry {len(extra)} fields.')

# ── 3. sending money ─────────────────────────────────────────────────────────
section('3. sending money')
t1, u1 = login(U1)
b1 = float(u1.get('balance') or 0)
ck('a returning user logs in', bool(t1), f"balance=${b1}", 'HIGH', 'A returning user cannot log in.')
send_ip = ip()
cases = [
    ('sending to yourself is refused', {'senderId': 'U1', 'recipientId': 'U1', 'amount': 1, 'idempotencyKey': 'c1'}, (400,), 'HIGH'),
    ('an unknown recipient is refused', {'senderId': 'U1', 'recipientId': 'NOPE-9', 'amount': 1, 'idempotencyKey': 'c2'}, (404,), 'HIGH'),
    ('amount 0 is refused', {'senderId': 'U1', 'recipientId': 'U2', 'amount': 0, 'idempotencyKey': 'c3'}, (400,), 'HIGH'),
    ('a negative amount is refused', {'senderId': 'U1', 'recipientId': 'U2', 'amount': -5, 'idempotencyKey': 'c4'}, (400,), 'HIGH'),
    ('a text amount is refused', {'senderId': 'U1', 'recipientId': 'U2', 'amount': 'abc', 'idempotencyKey': 'c5'}, (400,), 'HIGH'),
    ('more than the balance is refused', {'senderId': 'U1', 'recipientId': 'U2', 'amount': b1 + 50, 'idempotencyKey': 'c6'}, (400, 403), 'CRITICAL'),
]
for name, body, expect, sev in cases:
    s, j = req('/api/transfer', body, t1, ip_addr=send_ip)
    ck(name, s in expect, f"{s} {(j.get('error') or '')[:56]}", sev, f'{name} → HTTP {s}')
key = 'dup-' + str(int(time.time()))
s1, j1 = req('/api/transfer', {'senderId': 'U1', 'recipientId': 'U2', 'amount': 2, 'idempotencyKey': key}, t1, ip_addr=ip())
s2, j2 = req('/api/transfer', {'senderId': 'U1', 'recipientId': 'U2', 'amount': 2, 'idempotencyKey': key}, t1, ip_addr=ip())
t1, u1b = login(U1)
b2 = float(u1b.get('balance') or 0)
ck('a double-tapped Send charges once', s1 == 200 and abs((b1 - b2) - 2) < 0.001,
   f"first={s1} second={s2} duplicate={j2.get('duplicate')} balance {b1}→{b2}", 'CRITICAL',
   'A double tap moved money twice.')
ck('the amount is charged exactly, no fees hidden', abs((b1 - b2) - 2) < 0.001, f"{b1} → {b2}", 'CRITICAL',
   'The balance moved by more or less than the amount sent.')

# ── 4. boosting ──────────────────────────────────────────────────────────────
section('4. boosting')
t1, _ = login(U1)
bip = ip()
s, j = req('/api/boost/start', {'userId': 'U1'}, t1, ip_addr=bip)
started = ((j.get('user') or {}).get('boostState') or {})
ck('Boost starts a cycle', s == 200 and started.get('isActive') is True, f"{s} active={started.get('isActive')}", 'HIGH',
   'The Boost button does nothing.')
started_at = started.get('startedAt')
s2, j2 = req('/api/boost/start', {'userId': 'U1'}, t1, ip_addr=bip)
st2 = ((j2.get('user') or {}).get('boostState') or {})
ck('tapping Boost again does not restart the cycle', st2.get('startedAt') == started_at,
   f"startedAt {started_at} → {st2.get('startedAt')}", 'HIGH', 'A second tap restarted the cycle (lost or duplicated yield).')
s, j = req('/api/transfer', {'senderId': 'U1', 'recipientId': 'U2', 'amount': 1, 'idempotencyKey': 'bd' + str(int(time.time()))}, t1, ip_addr=ip())
ck('money cannot move while the boost is running', s == 400, f"{s} {(j.get('error') or '')[:52]}", 'LOW',
   'Sending is allowed mid-boost (double-dip risk).')
s, j = req('/api/boost/pause', {'userId': 'U1'}, t1, ip_addr=ip())
ck('pause works', s == 200, f"{s}", 'MEDIUM', 'A running cycle cannot be paused.')
s, j = req('/api/transfer', {'senderId': 'U1', 'recipientId': 'U2', 'amount': 1, 'idempotencyKey': 'bp' + str(int(time.time()))}, t1, ip_addr=ip())
ck('sending works again after pause', s == 200, f"{s}", 'HIGH', 'Money is stuck after a pause.')
s, j = req('/api/boost/resume', {'userId': 'U1'}, t1, ip_addr=ip())
ck('resume works', s == 200, f"{s}", 'MEDIUM', 'Resume does nothing.')
s, j = req('/api/boost/start', {'userId': 'U2'}, t1, ip_addr=ip())
ck('a user cannot boost somebody else’s account', s == 403, f"{s}", 'CRITICAL', 'Cross-account money control.')
req('/api/boost/pause', {'userId': 'U1'}, t1, ip_addr=ip())

# ── 4b. the compact "today" strip ────────────────────────────────────────────
section('4b. the today strip on the dashboard')
s, plan = req('/api/user/boost-plan?tz=360', token=t1, ip_addr=ip())
raw = json.dumps(plan)
cyc = plan.get('cycle') or {}
td = plan.get('today') or {}
ck('the strip gets its numbers', s == 200 and 'today' in plan and 'cycle' in plan, f"{s} keys={sorted(plan)[:6]}",
   'HIGH', 'The dashboard strip cannot load, so the user sees nothing about today.')
ck('the paused cycle keeps its checkpoint', cyc.get('paused') is True and num(cyc.get('elapsedMs')) > 0,
   f"paused={cyc.get('paused')} elapsed={cyc.get('elapsedMs')}ms", 'MEDIUM',
   'A paused cycle shows as idle in the strip (looks like the earnings vanished).')
ck('the cycle money adds up', abs(num(cyc.get('projectedIncome')) - (num(cyc.get('accruedIncome')) + num(cyc.get('remainingIncome')))) < 1e-12,
   f"{cyc.get('accruedIncome')} + {cyc.get('remainingIncome')} vs {cyc.get('projectedIncome')}", 'HIGH',
   'Accrued + remaining does not equal the cycle total — the strip would show money that does not exist.')
ck('today adds up', abs(num(td.get('projectedTotal')) - (num(td.get('earned')) + num(td.get('remainingIncome')))) < 1e-12
   and num(td.get('cyclesPossible')) == num(td.get('cyclesDone')) + num(td.get('cyclesRemaining')),
   f"earned {td.get('earned')} + toGo {td.get('remainingIncome')} = {td.get('projectedTotal')}; cycles {td.get('cyclesDone')}/{td.get('cyclesPossible')}",
   'HIGH', "Today's earned + still-to-come does not match the day total the strip prints.")
ck('the compounding rate never leaves the server',
   not re.search(r'rate(Per|Percent|per|Percent)|minuteRate|hourlyRate', raw, re.I),
   'response has no rate field', 'CRITICAL',
   'The strip endpoint leaks the secret compounding rate to the phone.')
s2, idle = req('/api/user/boost-plan?tz=360', token=login(U2)[0], ip_addr=ip())
ck('an idle user sees the duration the next tap would really get',
   s2 == 200 and (idle.get('cycle') or {}).get('durationMs') == (idle.get('nextCycle') or {}).get('durationMs'),
   f"cycle {(idle.get('cycle') or {}).get('durationMs')}ms vs next {(idle.get('nextCycle') or {}).get('durationMs')}ms",
   'MEDIUM', 'A finished cycle leaves a stale duration behind, so an idle user is shown a false cycle length.')
s3, plan2 = req('/api/user/boost-plan?tz=0', token=login(U1)[0], ip_addr=ip())
ck('the day follows the phone, not the server clock',
   s3 == 200 and num(plan2.get('dayStart')) == num(plan.get('dayStart')) + 360 * 60000,
   f"dayStart {plan.get('dayStart')} (tz=+360) vs {plan2.get('dayStart')} (UTC)", 'MEDIUM',
   "'Today' is anchored to UTC, so a Dhaka user's day flips at 6 am.")
s4, j4 = req('/api/user/boost-plan?tz=360', ip_addr=ip())
ck('the strip needs a signed-in user', s4 == 401, f"{s4}", 'HIGH', 'Anonymous callers can read a user boost plan.')
agent_tok, _ = login(AGENT, ip_addr=ip())
s5, j5 = req('/api/user/boost-plan?tz=360', token=agent_tok, ip_addr=ip())
ck('an agent cannot read a user plan with their own token', s5 == 401, f"{s5}", 'HIGH',
   'Agent tokens are accepted by the user-only strip endpoint.')

# ── 5. chat ──────────────────────────────────────────────────────────────────
section('5. chat')
t1, _ = login(U1)
cip = ip()
s, j = req('/api/chat/send', {'senderId': 'U1', 'senderRole': 'USER', 'recipientId': 'U2', 'text': 'journey hello'}, t1, ip_addr=cip)
msg_id = ((j.get('message') or {}).get('id'))
ck('a text message sends', s == 200 and bool(msg_id), f"{s} id={msg_id}", 'HIGH', 'Chat does not send.')
s, j = req('/api/chat/messages?peerId=U2&limit=5', token=t1, ip_addr=ip())
ck('the message comes back in the thread', 'journey hello' in json.dumps(j), f"{s} {len(json.dumps(j))}B", 'HIGH',
   'A sent message never appears.')
s, j = req('/api/chat/send', {'senderId': 'U1', 'recipientId': 'U2', 'text': 'hi', 'voiceData': 'data:audio/webm;base64,AAAA'}, t1, ip_addr=cip)
ck('voice notes send', s == 200, f"{s}", 'MEDIUM', 'Voice messages are broken.')
s, j = req('/api/chat/send', {'senderId': 'U1', 'recipientId': 'U2', 'text': 'photo', 'photoData': 'data:image/png;base64,' + 'A' * 8000}, t1, ip_addr=cip)
ck('photos send', s == 200, f"{s}", 'MEDIUM', 'Photo messages are broken.')
s, j = req('/api/chat/send', {'senderId': 'U9', 'recipientId': 'U2', 'text': 'spoof'}, t1, ip_addr=cip)
ck('nobody can send as another user', s == 403, f"{s}", 'CRITICAL', 'Impersonation in chat.')
s, j = req('/api/chat/send', {'senderId': 'U1', 'recipientId': 'U2', 'text': ''}, t1, ip_addr=cip)
ck('an empty message is refused', s == 400, f"{s}", 'LOW', 'Empty bubbles are stored.')
s, j = req('/api/chat/send', {'senderId': 'U1', 'recipientId': 'U2', 'text': 'x' * 5000}, t1, ip_addr=cip)
ck('a 5 000-character message is refused', s in (400, 413), f"{s}", 'LOW', 'Huge messages are accepted and blow up the sync payload.')

# ── 6. agent pay ─────────────────────────────────────────────────────────────
section('6. paying an agent')
t1, _ = login(U1)
s, j = req('/api/user/send-to-agent', {'agentId': 'AGT-1', 'amount': 5000, 'idempotencyKey': 'ag-over'}, t1, ip_addr=ip())
ck('paying an agent more than the balance is refused', s in (400, 403), f"{s} {(j.get('error') or '')[:60]}", 'CRITICAL',
   'Money can leave an account without the balance to cover it.')
s, j = req('/api/user/send-to-agent', {'agentId': 'AGT-1', 'amount': 5, 'idempotencyKey': 'ag' + str(int(time.time()))}, t1, ip_addr=ip())
code = j.get('claimCode') or (j.get('payout') or {}).get('code')
ck('paying an agent produces a claim code', s == 200 and bool(code), f"{s} code={code}", 'HIGH', 'The agent payout cannot complete.')
s, j = req('/api/agent/login', {'email': AGENT[0], 'password': AGENT[1]}, ip_addr=ip())
at = j.get('token')
ck('an agent can log in to the agent app', bool(at), f"{s}", 'HIGH', 'Agents cannot sign in.')
if at and code:
    s, j = req('/api/agent/redeem', {'code': code}, at, ip_addr=ip())
    ck('the agent redeems the code', s == 200, f"{s} {(j.get('error') or '')[:50]}", 'HIGH', 'Claim codes cannot be redeemed.')
    s, j = req('/api/agent/redeem', {'code': code}, at, ip_addr=ip())
    ck('the same code cannot be redeemed twice', s in (400, 404, 409), f"{s}", 'CRITICAL', 'A code paid the agent twice.')
s, ju = req('/api/agent/users', token=at, ip_addr=ip())
ck('the agent app shows IDs only, never e-mails', not re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', json.dumps(ju)),
   json.dumps(ju)[:90], 'CRITICAL', 'Agents can read users’ e-mail addresses.')

# ── 7. admin console + audit trail ───────────────────────────────────────────
section('7. admin console and its audit trail')
s, a = req('/api/admin/login', ADMIN, ip_addr=ip())
atk = a.get('token')
ck('admin login works', bool(atk), f"{s}", 'HIGH', 'Nobody can administer the system.')
if atk:
    for path in ['/api/admin/stats', '/api/admin/users', '/api/admin/audit-logs', '/api/admin/sessions',
                 '/api/admin/mfa/status', '/api/admin/analytics', '/api/admin/reconciliation']:
        s, j = req(path, token=atk, ip_addr=ip())
        ck(f'{path} answers', s == 200, f"{s}", 'HIGH', f'The admin screen calling {path} shows an error.')
    before = req('/api/admin/audit-logs', token=atk, ip_addr=ip())[1].get('total')
    req('/api/admin/users/send-lock', {'userId': 'U3', 'mode': 'full', 'note': 'journey'}, atk, ip_addr=ip())
    time.sleep(0.4)
    logs = req('/api/admin/audit-logs', token=atk, ip_addr=ip())[1]
    after = logs.get('total')
    mentioned = any('lock' in json.dumps(l).lower() for l in (logs.get('logs') or []))
    ck('the send-lock shows up in the audit trail', after > before and mentioned, f"entries {before}→{after}", 'HIGH',
       'An admin lock was applied but nothing was written to the audit trail — the action cannot be traced later.')
    t3, _ = login(U3, ip_addr=ip())
    s, j = req('/api/transfer', {'senderId': 'U3', 'recipientId': 'U2', 'amount': 1, 'idempotencyKey': 'lk' + str(int(time.time()))}, t3, ip_addr=ip())
    ck('a locked user really cannot send', s == 403, f"{s} {(j.get('error') or '')[:50]}", 'CRITICAL', 'The admin lock does nothing.')
    req('/api/admin/users/send-lock', {'userId': 'U3', 'mode': 'off'}, atk, ip_addr=ip())

# ── 8. brute force / lockout blast radius ────────────────────────────────────
section('8. wrong passwords: who gets locked out?')
victim_ip = ip()
codes = [req('/api/users/login', {'email': U2[0], 'password': 'wrong%d' % i}, ip_addr=victim_ip)[0] for i in range(10)]
immediate = req('/api/users/login', {'email': U2[0], 'password': U2[1]}, ip_addr=victim_ip)[0]
bystander = req('/api/users/login', {'email': U3[0], 'password': U3[1]}, ip_addr=victim_ip)[0]
ck('guessing is stopped', any(c == 429 for c in codes), f"statuses={codes}", 'HIGH', 'Nothing stops password guessing.')
ck('an innocent user on the same network is NOT locked out', bystander == 200, f"{bystander}", 'HIGH',
   'After 8 wrong passwords every account behind that IP is blocked — with carrier NAT one attacker can '
   'lock out a whole city.')
ck('the blocked owner only waits a short cool-off', immediate == 429, f"{immediate} (expected a short 429)", 'HIGH',
   'Lockout is instantaneous-but-not-limited, or not applied at all.')
print('  … waiting out the 60 s first cool-off …')
time.sleep(62)
real = req('/api/users/login', {'email': U2[0], 'password': U2[1]}, ip_addr=victim_ip)[0]
ck('after the cool-off the real owner can log in again', real == 200, f"{real}", 'HIGH',
   'The account stays locked for 30 minutes after a few typos.')

# ── 9. privileges & sessions ─────────────────────────────────────────────────
section('9. privilege and session handling')
t1, _ = login(U1, ip_addr=ip())
for path, body in [('/api/admin/users', None), ('/api/admin/stats', None),
                   ('/api/admin/adjust', {'userId': 'U1', 'amount': 1000, 'type': 'CREDIT'})]:
    s, j = req(path, body, t1, ip_addr=ip())
    ck(f'a user token is rejected on {path}', s in (401, 403), f"{s}", 'CRITICAL', f'{path} accepted a normal user token.')
s, j = req('/api/db', token='forged-token', ip_addr=ip())
ck('a forged token is rejected', s == 401, f"{s}", 'CRITICAL', 'A forged token works.')
s, j = req('/api/users/me/sessions', token=t1, ip_addr=ip())
ck('the device list loads', s == 200 and isinstance(j, dict), f"{s}", 'MEDIUM', 'The devices screen is broken.')
t1_again, _ = login(U1, ip_addr=ip())
s, j = req('/api/db?slim=1&only=stream', token=t1, ip_addr=ip())
ck('signing in on a new phone signs the old one out', s == 401, f"{s}", 'LOW',
   'Only one device per account is allowed by design — worth telling users, because it looks like a crash.')

# ── 10. rate limit burn ──────────────────────────────────────────────────────
section('10. does a fumbled send use up the user’s quota?')
t1, _ = login(U1, ip_addr=ip())
burn_ip = ip()
statuses = []
for i in range(9):
    s, j = req('/api/transfer', {'senderId': 'U1', 'recipientId': 'U1', 'amount': 1, 'idempotencyKey': f'rl{i}'}, t1, ip_addr=burn_ip)
    statuses.append(s)
    if s == 429:
        break
ck('failed attempts do not eat the send quota', 429 not in statuses, f"statuses={statuses}", 'MEDIUM',
   f'A user who taps Send wrong {len(statuses)} times in a minute is blocked with 429, even though no money moved.')

print(f"\nRESULT {PASS} pass / {FAIL} fail")
if PROBLEMS:
    order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
    print('\nPROBLEMS FOUND:')
    for p in sorted(PROBLEMS, key=lambda x: order.get(x['sev'], 9)):
        print(f"  [{p['sev']:8}] {p['title']}\n             {p['detail']}")
else:
    print('\nNo problems found.')
json.dump(PROBLEMS, open('/tmp/journey_problems.json', 'w'), indent=1)
