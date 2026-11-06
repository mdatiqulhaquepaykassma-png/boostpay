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
# A local midnight must (a) be a whole local day, (b) contain "now", and (c) differ
# from the UTC midnight. Comparing the two day-starts by a fixed +6h offset is wrong
# once the UTC clock passes 18:00 (the offset legitimately becomes -18h).
_ds_dhaka = num(plan.get('dayStart'))
_ds_utc = num(plan2.get('dayStart'))
ck('the day follows the phone, not the server clock',
   s3 == 200
   and (_ds_dhaka + 360 * 60000) % 86400000 == 0            # Dhaka local midnight
   and _ds_utc % 86400000 == 0                              # UTC midnight
   and _ds_dhaka <= num(plan.get('serverTime')) < _ds_dhaka + 86400000
   and _ds_dhaka != _ds_utc,
   f"dayStart {_ds_dhaka} (tz=+360) vs {_ds_utc} (UTC), now {plan.get('serverTime')}", 'MEDIUM',
   "'Today' is anchored to UTC, so a Dhaka user's day flips at 6 am.")
s4, j4 = req('/api/user/boost-plan?tz=360', ip_addr=ip())
ck('the strip needs a signed-in user', s4 == 401, f"{s4}", 'HIGH', 'Anonymous callers can read a user boost plan.')
agent_tok, _ = login(AGENT, ip_addr=ip())
s5, j5 = req('/api/user/boost-plan?tz=360', token=agent_tok, ip_addr=ip())
ck('an agent cannot read a user plan with their own token', s5 == 401, f"{s5}", 'HIGH',
   'Agent tokens are accepted by the user-only strip endpoint.')
# missed cycles + lifetime income (the second strip line)
t1, _ = login(U1)   # fresh session: the agent login above must not leak into this
s, pl = req('/api/user/boost-plan?tz=360', token=t1, ip_addr=ip())
td = pl.get('today') or {}
lt = pl.get('lifetime') or {}
ck('the strip reports how many cycles a day allows', isinstance(td.get('cyclesPerDay'), int) and td.get('cyclesPerDay') >= 0,
   f"cyclesPerDay={td.get('cyclesPerDay')}", 'HIGH', 'The strip cannot say how many cycles fit in a day.')
ck('done + missed equals the slots that have passed today',
   int(td.get('cyclesDone') or 0) + int(td.get('missed') or 0) == int(td.get('slotsSoFar') or 0),
   f"done={td.get('cyclesDone')} missed={td.get('missed')} slots={td.get('slotsSoFar')}", 'HIGH',
   'Missed-cycle maths does not add up, so the strip would show a wrong number of missed boosts.')
ck('missed income is never negative and never NaN', num(td.get('missedIncome')) >= 0,
   f"missedIncome={td.get('missedIncome')}", 'HIGH', 'Missed income shows a broken value.')
ck('lifetime income is reported and marked as an estimate',
   isinstance(lt.get('income'), (int, float)) and lt.get('estimated') is True,
   f"income={lt.get('income')} missedIncome={lt.get('missedIncome')} cycles={lt.get('cycles')}", 'HIGH',
   'The strip has no lifetime income figure.')
ck('lifetime missed never goes negative', num(lt.get('missed')) >= 0 and num(lt.get('missedIncome')) >= 0,
   f"missed={lt.get('missed')}", 'HIGH', 'Lifetime missed is negative.')
ck('lifetime counters are consistent with today',
   num(lt.get('cycles')) >= num(td.get('cyclesDone')) and num(lt.get('slots')) >= num(td.get('slotsSoFar')),
   f"cycles={lt.get('cycles')} today={td.get('cyclesDone')}", 'MEDIUM',
   'Lifetime totals are smaller than today, which cannot happen.')
# day-by-day lifetime ledger
series = lt.get('series') or []
ck('lifetime comes with one row per day since signup', isinstance(series, list) and len(series) == int(lt.get('days') or -1) and len(series) >= 1,
   f"rows={len(series)} days={lt.get('days')}", 'HIGH',
   'The lifetime block cannot explain itself: no day-by-day rows.')
ck('every day row has a starting balance and a cycle length',
   all(num(d.get('balance')) >= 0 and 60000 <= num(d.get('cycleMs')) <= 86400000 for d in series),
   f"balances={[d.get('balance') for d in series][:3]}", 'HIGH',
   'A day row has no balance or an impossible cycle length.')
ck('day rows are newest-first and the first row is today',
   series == sorted(series, key=lambda d: d.get('ts'), reverse=True) and (not series or series[0].get('day') ==
   __import__('datetime').datetime.fromtimestamp((pl['serverTime'] + 360*60000)/1000, __import__('datetime').timezone.utc).strftime('%Y-%m-%d')),
   f"top={series[0].get('day')} bottom={series[-1].get('day')}", 'MEDIUM',
   'The day-by-day list is out of order: today must be the top row and older days below it.')
ck('day rows sum to the lifetime totals',
   abs(sum(num(d.get('missed')) for d in series) - num(lt.get('missed'))) < 1e-9 and
   abs(sum(num(d.get('missedIncome')) for d in series) - num(lt.get('missedIncome'))) < max(1e-9, num(lt.get('missedIncome')) * 1e-6) and
   abs(sum(num(d.get('earned')) for d in series) - num(lt.get('income'))) < max(1e-9, num(lt.get('income')) * 1e-6),
   f"sumMissed={sum(num(d.get('missed')) for d in series)} lifetime={lt.get('missed')}", 'HIGH',
   'The per-day rows do not add up to the lifetime figure shown above them.')
ck('a day never reports more cycles than it had slots',
   all(num(d.get('cycles')) <= num(d.get('slots')) for d in series), 'per-row ok', 'HIGH',
   'A day claims more completed cycles than the day could hold.')
ck('the strip never leaks the compounding rate',
   not re.search(r'rate|ratePerMs|minuteRate', json.dumps(pl), re.I), 'no rate field', 'CRITICAL',
   'The boost plan leaks the secret rate through the new fields.')

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

# ── 11. team tree (unlimited levels) ─────────────────────────────────────────
section('11. my team tree — how many joined under me, at every level')
t1, me1 = login(U1)
if not t1:
    ck('team tree needs a signed-in user', False, 'login failed', 'HIGH', 'Could not sign in for the team test.')

_RUN_TAG = str(int(time.time()))[-6:]


def signup_child(email, referrer):
    """Unique e-mail per run — the local DB keeps members between runs, so a
    fixed address would collide on the second run and break the tree counts."""
    local, _, domain = email.partition('@')
    email = f'{local}-{_RUN_TAG}@{domain or "gmail.com"}'
    s2, j2 = req('/api/users/register', {'email': email, 'password': 'Staging123!', 'referralCode': referrer}, ip_addr=ip())
    return s2, str(((j2.get('user') or {}).get('id')) or ''), j2

# a 3-level chain under U1: two direct, one under each of them. Counts are
# measured as a DELTA, because the local DB keeps members from earlier runs.
t_base, base_summ = req('/api/user/team/summary', token=t1, ip_addr=ip())
base_total = int((base_summ or {}).get('total') or 0)
base_direct = int((base_summ or {}).get('direct') or 0)
base_boost = int((base_summ or {}).get('boostActive') or 0)
ok_ids = []
for email in ('tree-a@gmail.com', 'tree-b@gmail.com'):
    s2, cid, _ = signup_child(email, 'U1')
    ck(f'{email} joins under me', s2 == 200 and bool(cid), f"{s2} id={cid}", 'HIGH', 'Signup with a refer code failed.')
    ok_ids.append(cid)
grand = []
if ok_ids[0]:
    s2, gid, _ = signup_child('tree-a1@gmail.com', ok_ids[0])
    ck('a referral of my referral joins (level 2)', s2 == 200 and bool(gid), f"{s2} id={gid}", 'HIGH',
       'Level 2+ joins do not register, so the tree can never go deeper than one level.')
    grand.append(gid)
if ok_ids[1]:
    s2, gid2, _ = signup_child('tree-b1@gmail.com', ok_ids[1])
    grand.append(gid2)
deep = []
if grand:
    s2, did, _ = signup_child('tree-a1x@gmail.com', grand[0])
    ck('a level 3 join works too (unlimited depth)', s2 == 200 and bool(did), f"{s2} id={did}", 'MEDIUM',
       'Depth beyond 2 is not recorded.')
    deep.append(did)

t1, _ = login(U1)
s, summ = req('/api/user/team/summary', token=t1, ip_addr=ip())
bl = summ.get('byLevel') or []
expected_total = len(ok_ids) + len(grand) + len(deep)
ck('the team summary loads', s == 200 and isinstance(summ.get('total'), int), f"{s} total={summ.get('total')}", 'HIGH',
   'The Refer page cannot show a team total.')
ck('total team counts every level', summ.get('total') == base_total + expected_total,
   f"total={summ.get('total')} (was {base_total}) expected +{expected_total}", 'HIGH',
   'The total team number does not include every level under the user.')
ck('per-level counts add up to the total', sum(int(l.get('count') or 0) for l in bl) == summ.get('total'),
   f"levels={bl} total={summ.get('total')}", 'HIGH', 'The level breakdown disagrees with the team total.')
ck('direct count is level 1 only', summ.get('direct') == base_direct + len(ok_ids),
   f"direct={summ.get('direct')} (was {base_direct})", 'MEDIUM',
   'Direct referrals and total team are mixed up.')
ck('depth reports the real tree depth', summ.get('depth') == 3, f"depth={summ.get('depth')}", 'MEDIUM',
   'The tree stops counting after the first level.')
ck('team numbers carry no names or emails',
   not re.search(r'@|"email"|"name"', json.dumps(summ)), 'counts/ids only', 'CRITICAL',
   'The team summary leaks user identities to the referrer.')

s, kids = req('/api/user/team/children?parentId=U1', token=t1, ip_addr=ip())
kids = kids.get('children') or []
ck('my direct members open as rows', s == 200 and all(str(i) in {str(k.get('id')) for k in kids} for i in ok_ids),
   f"{s} rows={len(kids)}", 'HIGH', 'The first level of the tree does not open.')
byid = {str(k.get('id')): k for k in kids}
if ok_ids and ok_ids[0] in byid:
    ck('each row says how many people sit under that member', byid[ok_ids[0]].get('teamSize') == len(grand[:1]) + len(deep),
       f"teamSize={byid[ok_ids[0]].get('teamSize')} expected={len(grand[:1]) + len(deep)}", 'HIGH',
       'A member row shows the wrong team size, so the tree looks flat.')
    ck('each row carries its level', byid[ok_ids[0]].get('level') == 1, f"level={byid[ok_ids[0]].get('level')}", 'MEDIUM',
       'Level labels are missing from the tree rows.')
s, kids2 = req(f'/api/user/team/children?parentId={ok_ids[0]}', token=t1, ip_addr=ip())
rows2 = kids2.get('children') or []
ck('opening a member shows their own team', s == 200 and len(rows2) == 1 and rows2[0].get('level') == 2,
   f"{s} rows={len(rows2)} level={(rows2[0] or {}).get('level') if rows2 else None}", 'HIGH',
   'The tree cannot be expanded past level 1.')
ck('no emails in the tree rows', not re.search(r'@', json.dumps(rows2)), 'ids only', 'CRITICAL',
   'Tree rows expose member emails.')
# a branch that is not mine must be refused
s, j = req('/api/user/team/children?parentId=U3', token=t1, ip_addr=ip())
ck('somebody else’s branch is refused', s == 403, f"{s}", 'CRITICAL', 'A user can read a team that is not under them.')
s, j = req('/api/user/team/summary', ip_addr=ip())
ck('the team tree needs a signed-in user', s == 401, f"{s}", 'HIGH', 'Anonymous callers can read a team tree.')
agent_tok, _ = login(AGENT, ip_addr=ip())
s, j = req('/api/user/team/summary', token=agent_tok, ip_addr=ip())
ck('an agent token cannot read a user team tree', s == 401, f"{s}", 'HIGH', 'Agent tokens are accepted by the team endpoints.')

# ── 12. money flow tree (admin) ──────────────────────────────────────────────
section('12. admin: tk kar theke kar kache gelo, ekhon kar kache ache')
sa, ja = req('/api/admin/login', ADMIN, ip_addr=ip())
atok = ja.get('token') or ''
ck('admin signs in for the money view', sa == 200 and bool(atok), f"{sa}", 'HIGH', 'Admin login broke.')
s, summ = req('/api/admin/money-tree/summary', token=atok, ip_addr=ip())
ck('the holdings summary loads', s == 200 and isinstance(summ.get('users'), dict) and isinstance(summ.get('agents'), dict),
   f"{s} atRest={(summ.get('recon') or {}).get('atRest')}", 'HIGH', 'Admin cannot see where the money sits.')
ck('holdings are split per account type',
   all(k in summ for k in ('users', 'agents', 'management', 'inTransit')),
   f"keys={sorted(summ)[:8]}", 'HIGH', 'The holdings summary misses an account type.')
tot = (num((summ.get('users') or {}).get('balance')) + num((summ.get('agents') or {}).get('balance'))
       + num((summ.get('management') or {}).get('balance')) + num((summ.get('inTransit') or {}).get('total')))
ck('total at rest equals the four holdings added up', abs(tot - num((summ.get('recon') or {}).get('atRest'))) < 0.011,
   f"sum={round(tot,2)} summary={((summ.get('recon') or {}).get('atRest'))}", 'HIGH',
   'The "at rest" total does not match the wallets it claims to add up.')
s, tree = req('/api/admin/money-tree?node=U1', token=atok, ip_addr=ip())
ck('an account trail opens', s == 200 and isinstance(tree.get('in'), list) and isinstance(tree.get('out'), list),
   f"{s} in={len(tree.get('in') or [])} out={len(tree.get('out') or [])}", 'HIGH',
   'The money tree cannot open an account.')
ck('the trail says where that account stands now', isinstance((tree.get('node') or {}).get('balance'), (int, float)),
   f"balance={((tree.get('node') or {}).get('balance'))}", 'HIGH', 'The account balance is missing from the trail.')
if tree.get('out'):
    e0 = tree['out'][0]
    ck('every counterparty edge names who and how much',
       bool(e0.get('id')) and num(e0.get('amount')) > 0 and bool(e0.get('kind')),
       f"{e0.get('id')} {e0.get('kind')} {e0.get('amount')}", 'HIGH',
       'A money edge has no counterparty, kind or amount.')
s, ag = req('/api/admin/money-tree?node=AGT-1', token=atok, ip_addr=ip())
ck('an agent wallet can be traced too', s in (200, 404), f"{s}", 'MEDIUM', 'Agent wallets are not traceable.')
s, j = req('/api/admin/money-tree/summary', ip_addr=ip())
ck('the money view needs an admin session', s == 401, f"{s}", 'CRITICAL', 'Anonymous callers can read the money tree.')
t1b, _ = login(U1)
s, j = req('/api/admin/money-tree/summary', token=t1b, ip_addr=ip())
ck('a normal user token is refused', s in (401, 403), f"{s}", 'CRITICAL', 'A user token opened the admin money tree.')
agent_tok2, _ = login(AGENT, ip_addr=ip())
s, j = req('/api/admin/money-tree?node=U1', token=agent_tok2, ip_addr=ip())
ck('an agent token is refused', s in (401, 403), f"{s}", 'CRITICAL', 'An agent token opened the money tree.')
s, j = req('/api/admin/money-tree?node=NOPE-999', token=atok, ip_addr=ip())
ck('an unknown account is reported, not guessed', s == 404, f"{s}", 'MEDIUM', 'Unknown accounts return data.')

# ── 13. multi-level referral commission (halving per level) ─────────────────
section('13. commission goes down the whole team, halving at every level')
# chain: U1 <- c1 <- c2 <- c3 ; c3 finishes a cycle and everyone above earns.
# A fresh small balance gives the SHORTEST cycle (~2.5 min), so this section is
# the slow one — it waits for a real ticker payout, nothing is faked.
c1_s, c1, _ = signup_child('ml1@gmail.com', 'U1')
c2_s, c2, _ = signup_child('ml2@gmail.com', c1 or 'X')
c3_s, c3, _ = signup_child('ml3@gmail.com', c2 or 'X')
ck('a 3-deep chain signs up', c1_s == 200 and c2_s == 200 and c3_s == 200 and all([c1, c2, c3]), f"{c1},{c2},{c3}", 'HIGH',
   'Could not build the commission chain.')
tu1, _ = login(U1)
fund = req('/api/transfer', {'senderId': 'U1', 'recipientId': c3, 'amount': 0.1, 'idempotencyKey': 'mlfund' + _RUN_TAG}, tu1, ip_addr=ip())
ck('the deepest member gets a small balance to boost with', fund[0] == 200, f"{fund[0]}", 'HIGH',
   'Could not fund the test account, so commission cannot be exercised.')
s, jl = req('/api/users/login', {'email': f'ml3-{_RUN_TAG}@gmail.com', 'password': 'Staging123!'}, ip_addr=ip())
t3 = jl.get('token')
s, j = req('/api/boost/start', {'userId': c3}, t3, ip_addr=ip())
ck('the deepest member starts a cycle', s == 200, f"{s}", 'HIGH', 'The test cycle never started.')
if s == 200:
    closed = False
    for _ in range(60):          # up to ~4 minutes
        time.sleep(4)
        s2, pl = req('/api/user/boost-plan?tz=360', token=t3, ip_addr=ip())
        if s2 == 200 and (pl.get('cycle') or {}).get('running') is False:
            closed = True
            break
    ck('the cycle finishes and pays a reward', closed, 'cycle closed' if closed else 'still running', 'MEDIUM',
       'The cycle did not close inside four minutes, so commissions could not be checked.')
    if closed:
        rows = {}
        for tag, email in (('L1', f'ml2-{_RUN_TAG}@gmail.com'), ('L2', f'ml1-{_RUN_TAG}@gmail.com'), ('L3', 'u1@gmail.com')):
            s3, j3 = req('/api/users/login', {'email': email, 'password': 'Staging123!'}, ip_addr=ip())
            tk = j3.get('token')
            s4, d = req('/api/refer/my', token=tk, ip_addr=ip())
            mine = [c for c in (d.get('recentCommissions') or []) if str(c.get('referredId')) == str(c3)]
            rows[tag] = {'tier': d.get('rate'), 'rows': mine}
            ck(f'level {tag} earns a commission from the new cycle',
               s4 == 200 and len(mine) >= 1, f"{s4} rows={len(mine)}", 'HIGH',
               f'Level {tag} of the team earned nothing from a level-1 cycle.')
        l1 = rows['L1']['rows'][0] if rows['L1']['rows'] else None
        l2 = rows['L2']['rows'][0] if rows['L2']['rows'] else None
        l3 = rows['L3']['rows'][0] if rows['L3']['rows'] else None
        if l1 and l2 and l3:
            ck('level 1 keeps today’s tier rate', abs(num(l1.get('rate')) - num(rows['L1']['tier'])) < 0.011,
               f"L1 {l1.get('rate')}% vs tier {rows['L1']['tier']}%", 'HIGH',
               'Level 1 no longer pays the normal daily tier rate.')
            ck('level 2 pays exactly half of level 1', abs(num(l2.get('rate')) - num(l1.get('rate')) / 2) < 0.011,
               f"L1 {l1.get('rate')}% -> L2 {l2.get('rate')}%", 'HIGH', 'Level 2 is not half of level 1.')
            ck('level 3 pays a quarter of level 1', abs(num(l3.get('rate')) - num(l1.get('rate')) / 4) < 0.011,
               f"L1 {l1.get('rate')}% -> L3 {l3.get('rate')}%", 'HIGH', 'Level 3 is not a quarter of level 1.')
            ck('the money halves with the rate',
               abs(num(l2.get('amount')) - num(l1.get('amount')) / 2) <= max(1e-10, num(l1.get('amount')) * 0.01)
               and abs(num(l3.get('amount')) - num(l1.get('amount')) / 4) <= max(1e-10, num(l1.get('amount')) * 0.02),
               f"L1 {l1.get('amount'):.10f} L2 {l2.get('amount'):.10f} L3 {l3.get('amount'):.10f}", 'HIGH',
               'The commission AMOUNT does not halve per level, only the label.')
            ck('each row is stamped with its level',
               int(l1.get('level') or 0) == 1 and int(l2.get('level') or 0) == 2 and int(l3.get('level') or 0) == 3,
               f"{l1.get('level')}/{l2.get('level')}/{l3.get('level')}", 'MEDIUM',
               'Commission rows do not say which level they belong to.')
            ck('no level pays more than level 1',
               num(l1.get('amount')) >= num(l2.get('amount')) >= num(l3.get('amount')), 'descending', 'HIGH',
               'A deeper level earned more than a shallower one.')
        s5, d5 = req('/api/users/login', {'email': f'ml3-{_RUN_TAG}@gmail.com', 'password': 'Staging123!'}, ip_addr=ip())
        s6, outsider = req('/api/refer/my', token=d5.get('token'), ip_addr=ip())
        weird = [c for c in (outsider.get('recentCommissions') or []) if str(c.get('referredId')) == str(c3)]
        ck('the earner never pays commission to themselves', not weird, f"rows={len(weird)}", 'CRITICAL',
           'A user earned commission from their own cycle.')

# ── 14. income shown on the tree ─────────────────────────────────────────────
section('14. tree-e dhukle income — kon member theke koto pelam')
tu1, _ = login(U1)
s, summ = req('/api/user/team/summary', token=tu1, ip_addr=ip())
inc = (summ or {}).get('income') or {}
ck('the team summary carries an income total', s == 200 and isinstance(inc.get('total'), (int, float)),
   f"{s} total={inc.get('total')} last24h={inc.get('last24h')}", 'HIGH',
   'The team card cannot show how much the team has earned.')
s, kids = req('/api/user/team/children?parentId=U1', token=tu1, ip_addr=ip())
rows = (kids or {}).get('children') or []
ck('every member row carries its own income split',
   bool(rows) and all(isinstance(r.get('incomeSelf'), (int, float)) and isinstance(r.get('incomeTeam'), (int, float)) for r in rows),
   f"rows={len(rows)}", 'HIGH', 'Tree rows do not say how much income came through that member.')
# Each direct child carries the income earned through its whole subtree, and those
# subtrees are disjoint — so their sum must equal the team total.
ck('the income through my level-1 members adds up to the team total',
   abs(sum(num(r.get('incomeTeam')) for r in rows) - num(inc.get('total'))) <= max(1e-10, num(inc.get('total')) * 1e-4),
   f"rows={round(sum(num(r.get('incomeTeam')) for r in rows),12)} total={inc.get('total')}", 'HIGH',
   'The per-member income does not add up to the team total.')
ck('income only appears on members of my own tree',
   all(num(r.get('incomeTeam')) >= 0 for r in rows), 'non-negative', 'MEDIUM', 'A member shows negative income.')
if len(rows) >= 2:
    ck('a member with a deeper team shows income from that team',
       any(num(r.get('incomeTeam')) >= num(r.get('incomeSelf')) for r in rows), 'team >= self', 'MEDIUM',
       'Team income is smaller than the member’s own income, which cannot happen.')
ck('income rows carry no names or emails', not re.search(r'@', json.dumps(kids)), 'ids and amounts only', 'CRITICAL',
   'Income attribution leaks member identities.')
# opening a member returns that member's income for the parent view
s, kids2 = req(f'/api/user/team/children?parentId={rows[0]["id"]}', token=tu1, ip_addr=ip())
if s == 200 and (rows[0].get('directCount') or 0) > 0:
    node = kids2.get('node') or {}
    ck('opening a member shows income earned through them', isinstance(node.get('incomeTeam'), (int, float)),
       f"incomeTeam={node.get('incomeTeam')} incomeSelf={node.get('incomeSelf')}", 'HIGH',
       'The expanded member has no income figures.')
s, j = req('/api/user/team/summary', ip_addr=ip())
ck('income is never readable without a session', s == 401, f"{s}", 'CRITICAL', 'Anonymous callers can read team income.')

print(f"\nRESULT {PASS} pass / {FAIL} fail")
if PROBLEMS:
    order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
    print('\nPROBLEMS FOUND:')
    for p in sorted(PROBLEMS, key=lambda x: order.get(x['sev'], 9)):
        print(f"  [{p['sev']:8}] {p['title']}\n             {p['detail']}")
else:
    print('\nNo problems found.')
json.dump(PROBLEMS, open('/tmp/journey_problems.json', 'w'), indent=1)
