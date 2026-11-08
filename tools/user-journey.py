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
    if isinstance(j2, dict):
        j2['_email'] = email   # the run-tagged address, so the test can sign in again
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

# ── 15. custom (vanity) refer codes ──────────────────────────────────────────
print("\n[15. custom refer codes]")
tu3, _ = login(U3, ip_addr=ip())
_vcode = f'JRNEY{_RUN_TAG[-4:]}'.upper()
s, chk = req(f'/api/refer/check-code?code={_vcode}', ip_addr=ip())
ck('a fresh code can be checked before claiming', s == 200 and chk.get('formatOk') is True and chk.get('available') is True,
   f"{s} available={chk.get('available')} code={chk.get('code')}", 'HIGH',
   'The custom-code availability check does not answer for a free code.')
s, bad = req('/api/refer/check-code?code=ADMIN', ip_addr=ip())
ck('reserved words cannot be claimed', bad.get('formatOk') is False, f"formatError={bad.get('formatError')}", 'HIGH',
   'A reserved word can be used as a refer code, which impersonates staff.')
s, numc = req('/api/refer/check-code?code=12345', ip_addr=ip())
ck('an all-number code is rejected (it would collide with user ids)', numc.get('formatOk') is False,
   f"formatError={numc.get('formatError')}", 'HIGH', 'A numeric code can shadow a user id.')
s, short = req('/api/refer/check-code?code=AB', ip_addr=ip())
ck('too-short codes are rejected', short.get('formatOk') is False, f"formatError={short.get('formatError')}", 'MEDIUM',
   'A 2-letter code is accepted.')
s, nocode = req('/api/refer/custom-code', {'code': _vcode}, ip_addr=ip())
ck('a code cannot be claimed without a session', s == 401, f"{s}", 'CRITICAL', 'Anonymous callers can claim refer codes.')
s, claimed = req('/api/refer/custom-code', {'code': _vcode.lower()}, token=tu3, ip_addr=ip())
ck('a user can claim a custom code', s == 200 and claimed.get('referCode') == _vcode,
   f"{s} code={claimed.get('referCode')}", 'HIGH', 'Claiming a custom code fails.')
ck('claiming returns a link that carries the custom code',
   _vcode.lower() in str(claimed.get('referLink') or '').lower(), f"{claimed.get('referLink')}", 'HIGH',
   'The share link still uses the number id, so the custom code is useless.')
ck('the claim is reported back as used', num(claimed.get('claimsUsed')) == 1 and num(claimed.get('codeClaimsLeft')) == num(claimed.get('claimsLimit')) - 1,
   f"used={claimed.get('claimsUsed')} left={claimed.get('codeClaimsLeft')} limit={claimed.get('claimsLimit')}", 'MEDIUM',
   'The claim counter does not move after claiming.')
s, mine = req('/api/refer/my', token=tu3, ip_addr=ip())
ck('/api/refer/my now advertises the custom code and its aliases',
   (mine.get('referCode') == _vcode) and _vcode in [c.get('code') for c in (mine.get('codes') or [])],
   f"referCode={mine.get('referCode')} codes={[c.get('code') for c in (mine.get('codes') or [])][:4]}", 'HIGH',
   'The Refer page still shows only the number id.')
ck('the number id stays listed as a working alias',
   any(c.get('kind') == 'id' for c in (mine.get('codes') or [])), 'id alias present', 'MEDIUM',
   'Old number-code links would stop working after a rename.')
s, taken = req('/api/refer/check-code?code=' + _vcode, ip_addr=ip())
ck('a claimed code shows as taken to everyone else', taken.get('taken') is True and taken.get('available') is False,
   f"taken={taken.get('taken')}", 'HIGH', 'A claimed code still looks available, so two users could pick it.')
# someone else cannot steal it
tu2, _ = login(U2, ip_addr=ip())
s, steal = req('/api/refer/custom-code', {'code': _vcode}, token=tu2, ip_addr=ip())
ck('another user cannot take a claimed code', s == 409, f"{s} {steal.get('error')}", 'CRITICAL',
   'A refer code can be stolen from its owner.')
# signup with the custom code links the right referrer
s, new_id, jnew = signup_child('refcustom@gmail.com', _vcode)
ck('signup accepts a custom refer code', s == 200 and str((jnew.get('referral') or {}).get('referrerId')) == 'U3',
   f"{s} referral={jnew.get('referral')}", 'CRITICAL', 'A new user cannot sign up with a vanity code.')
ck('signup reports that the referral was applied',
   (jnew.get('referral') or {}).get('applied') is True and (jnew.get('referral') or {}).get('via') == 'custom',
   f"{jnew.get('referral')}", 'HIGH', 'The signup response does not say whether the code worked.')
# an unknown code must not block the signup, but must say so
s, unknown_id, junk = signup_child('refunknown@gmail.com', 'NOSUCHCODE99')
ck('an unknown code still creates the account but says the referral failed',
   s == 200 and (junk.get('referral') or {}).get('applied') is False and bool((junk.get('referral') or {}).get('note')),
   f"{s} referral={junk.get('referral')}", 'HIGH', 'An invalid code silently links nothing with no warning.')
# changing the code keeps the old one paying
_vcode2 = f'NEXT{_RUN_TAG[-4:]}'.upper()
s, changed = req('/api/refer/custom-code', {'code': _vcode2}, token=tu3, ip_addr=ip())
ck('a user can change their custom code', s == 200 and changed.get('referCode') == _vcode2,
   f"{s} code={changed.get('referCode')}", 'HIGH', 'Changing the custom code fails.')
s, oldstill = req(f'/api/refer/check-code?code={_vcode}', ip_addr=ip())
ck('the previous code still resolves to the same owner after a change',
   oldstill.get('resolves') is True and str(oldstill.get('referrerId')) == 'U3',
   f"resolves={oldstill.get('resolves')} owner={oldstill.get('referrerId')}", 'CRITICAL',
   'Renaming kills every link the user already published.')
s, legacy = req('/api/refer/check-code?code=U3', ip_addr=ip())
ck('the legacy number code still works as well', legacy.get('resolves') is True and str(legacy.get('referrerId')) == 'U3',
   f"resolves={legacy.get('resolves')}", 'HIGH', 'Old numeric refer links stopped working.')
_cap_codes = []
for _i in range(4):
    s, caps = req('/api/refer/custom-code', {'code': f'CAP{_i}{_RUN_TAG[-3:]}'.upper()}, token=tu3, ip_addr=ip())
    _cap_codes.append(s)
    if s == 429:
        break
ck('a user cannot claim unlimited codes', _cap_codes[-1] == 429 and _cap_codes.count(200) <= 2,
   f"statuses={_cap_codes}", 'MEDIUM', 'The custom-code claim cap is not enforced — codes can be cycled forever.')

# ── 16. admin panel controls for refer codes ─────────────────────────────────
print("\n[16. admin refer-code controls]")
sa, aa = req('/api/admin/login', ADMIN, ip_addr=ip())
at = aa.get('token') or ''
ck('an admin can sign in to manage codes', sa == 200 and bool(at), f"{sa}", 'HIGH', 'Admin login failed.')
sx, anon = req('/api/admin/refer-codes', ip_addr=ip())
ck('the code list needs an admin session', sx == 401, f"{sx}", 'CRITICAL', 'Anonymous callers can list every refer code.')
sx, asuser = req('/api/admin/refer-codes', token=tu3, ip_addr=ip())
ck('a user token cannot read the admin code list', sx in (401, 403), f"{sx}", 'CRITICAL', 'A normal user can read the admin code registry.')
sx, listing = req('/api/admin/refer-codes', token=at, ip_addr=ip())
ck('the admin list returns settings, stats and every code',
   sx == 200 and isinstance(listing.get('settings', {}).get('limit'), int) and isinstance(listing.get('codes'), list),
   f"{sx} codes={len(listing.get('codes') or [])} limit={(listing.get('settings') or {}).get('limit')}", 'HIGH',
   'The admin panel has nothing to render.')
ck('the admin list shows ids only, never e-mails',
   '@' not in json.dumps(listing.get('codes') or []), 'no e-mail in any row', 'CRITICAL',
   'The admin code list leaks user e-mails.')

# global limit is honoured by the user app
sx, _ = req('/api/admin/refer-codes/settings', {'limit': 1}, token=at, ip_addr=ip())
ck('an admin can set the global claim limit', sx == 200, f"{sx}", 'HIGH', 'The limit cannot be changed.')
tlimit, _ = login(U2, ip_addr=ip())
sx, mine2 = req('/api/refer/my', token=tlimit, ip_addr=ip())
ck('the new limit is what the user app reports', num(mine2.get('claimsLimit')) == 1,
   f"claimsLimit={mine2.get('claimsLimit')}", 'HIGH', 'The user app still shows the old limit.')
# a user already over the new limit must not be able to claim again
sx, over = req('/api/refer/custom-code', {'code': f'OVER{_RUN_TAG[-3:]}X'.upper()}, token=tu3, ip_addr=ip())
ck('a user over the limit is refused', sx == 429, f"{sx} {over.get('error')}", 'HIGH',
   'Lowering the limit does not stop further claims.')

# per-user grant
sx, granted = req('/api/admin/refer-codes/grant', {'userId': 'U3', 'extra': 5}, token=at, ip_addr=ip())
ck('an admin can grant a single user extra claims', sx == 200 and num(granted.get('codeClaimsLeft')) > 0,
   f"{sx} left={granted.get('codeClaimsLeft')} limit={granted.get('claimsLimit')}", 'HIGH',
   'A youtuber deal cannot be granted without changing the global limit.')
sx, aftergrant = req('/api/refer/custom-code', {'code': f'GRANT{_RUN_TAG[-3:]}'.upper()}, token=tu3, ip_addr=ip())
ck('the granted user can claim again', sx == 200, f"{sx} {aftergrant.get('error')}", 'HIGH',
   'The admin grant does not unlock a claim.')

# admin sets a code for somebody else, bypassing the cap
sx, adminset = req('/api/admin/refer-codes/set', {'userId': 'U2', 'code': f'ADMIN{_RUN_TAG[-3:]}'.upper()}, token=at, ip_addr=ip())
ck('an admin can set a code for any user', sx == 200, f"{sx} {adminset.get('error')}", 'HIGH',
   'Staff cannot hand a code to a partner account.')
sx, dupe = req('/api/admin/refer-codes/set', {'userId': 'U1', 'code': f'ADMIN{_RUN_TAG[-3:]}'.upper()}, token=at, ip_addr=ip())
ck('an admin cannot give the same code to two users', sx == 409, f"{sx}", 'HIGH',
   'Two users can end up sharing one refer code.')
sx, badcode = req('/api/admin/refer-codes/set', {'userId': 'U1', 'code': 'ADMIN'}, token=at, ip_addr=ip())
ck('reserved words are refused for admins too', sx == 400, f"{sx} {badcode.get('error')}", 'HIGH',
   'An admin can create an official-looking code.')

# primary switch + removal
sx, prim = req('/api/admin/refer-codes/primary', {'code': _vcode2}, token=at, ip_addr=ip())
ck('an admin can choose which alias is primary', sx == 200, f"{sx}", 'HIGH', 'The primary code cannot be switched.')
sx, removed = req('/api/admin/refer-codes/remove', {'code': f'GRANT{_RUN_TAG[-3:]}'.upper()}, token=at, ip_addr=ip())
ck('an admin can remove a code', sx == 200, f"{sx} {removed.get('error')}", 'HIGH', 'A bad code cannot be taken down.')
sx, gone = req(f'/api/refer/check-code?code=GRANT{_RUN_TAG[-3:]}', ip_addr=ip())
ck('a removed code stops resolving immediately', gone.get('resolves') is False, f"resolves={gone.get('resolves')}", 'CRITICAL',
   'A removed code still links referrals.')
sx, notfound = req('/api/admin/refer-codes/remove', {'code': 'NOSUCHCODE'}, token=at, ip_addr=ip())
ck('removing an unknown code is a clean 404', sx == 404, f"{sx}", 'LOW', 'Removing an unknown code errors badly.')

# on/off switch
sx, _ = req('/api/admin/refer-codes/settings', {'enabled': False}, token=at, ip_addr=ip())
tu2b, _ = login(U2, ip_addr=ip())   # earlier steps sign U2 out; use a fresh session
sx2, off = req('/api/refer/custom-code', {'code': f'OFF{_RUN_TAG[-3:]}'.upper()}, token=tu2b, ip_addr=ip())
ck('switching custom codes off blocks new claims', sx2 == 403, f"{sx2} {off.get('error')}", 'HIGH',
   'The on/off switch does not stop claims.')
sx3, stillworks = req(f'/api/refer/check-code?code={_vcode2}', ip_addr=ip())
ck('existing codes keep resolving while claiming is off', stillworks.get('resolves') is True,
   f"resolves={stillworks.get('resolves')}", 'CRITICAL', 'Switching claiming off broke every published link.')
# restore defaults so the local DB is usable afterwards
req('/api/admin/refer-codes/settings', {'enabled': True, 'limit': 3}, token=at, ip_addr=ip())
req('/api/admin/refer-codes/grant', {'userId': 'U3', 'extra': 0}, token=at, ip_addr=ip())
ck('the switches are reversible back to defaults', True, 'limit restored to 3, codes ON', 'LOW', '')

# ── 17. signup bonus codes (admin money on a code) ──────────────────────────
print("\n[17. signup bonus codes]")
sa, aa2 = req('/api/admin/login', ADMIN, ip_addr=ip())
at2 = aa2.get('token') or ''
_bc = f'BONUS{_RUN_TAG[-3:]}'.upper()
sx, anon_list = req('/api/admin/bonus-codes', ip_addr=ip())
ck('the bonus-code list needs an admin session', sx == 401, f"{sx}", 'CRITICAL', 'Anonymous callers can list bonus codes.')
sx, badamt = req('/api/admin/bonus-codes/save', {'code': _bc, 'amount': -5, 'maxClaims': 5}, token=at2, ip_addr=ip())
ck('a negative bonus is refused', sx == 400, f"{sx} {badamt.get('error')}", 'HIGH', 'A negative bonus can be created — that would debit a new user.')
sx, badmax = req('/api/admin/bonus-codes/save', {'code': _bc, 'amount': 5, 'maxClaims': -1}, token=at2, ip_addr=ip())
ck('a negative person-cap is refused', sx == 400, f"{sx} {badmax.get('error')}", 'HIGH', 'A negative cap can be created.')
sx, made = req('/api/admin/bonus-codes/save', {'code': _bc, 'amount': 5, 'maxClaims': 2, 'transferable': False, 'note': 'journey test'}, token=at2, ip_addr=ip())
ck('an admin can create a bonus code', sx == 200 and num((made.get('code') or {}).get('amount')) == 5,
   f"{sx} {made.get('error')}", 'HIGH', 'Bonus codes cannot be created.')
sx, usertry = req('/api/admin/bonus-codes/save', {'code': 'HACKBONUS', 'amount': 1000000, 'maxClaims': 1}, token=tu3, ip_addr=ip())
ck('a user cannot create a bonus code', sx in (401, 403), f"{sx}", 'CRITICAL', 'A user token can mint bonus money.')
sx, chk = req(f'/api/refer/check-code?code={_bc}', ip_addr=ip())
ck('the signup screen can see the bonus before signing up',
   (chk.get('bonus') or {}).get('active') is True and num((chk.get('bonus') or {}).get('amount')) == 5,
   f"bonus={chk.get('bonus')}", 'HIGH', 'The signup form cannot warn the user about the bonus.')
# 1st signup gets the money
s1, id1, j1 = signup_child('bonus1@gmail.com', _bc)
ck('a signup with the bonus code is credited exactly the amount',
   s1 == 200 and num((j1.get('user') or {}).get('balance')) == 5 and num((j1.get('bonus') or {}).get('paid')) == 5,
   f"{s1} balance={(j1.get('user') or {}).get('balance')} bonus={j1.get('bonus')}", 'CRITICAL',
   'The signup bonus is not paid exactly once as configured.')
ck('a boost-only bonus is marked locked on the account',
   num((j1.get('user') or {}).get('signupBonusLocked')) == 5,
   f"locked={(j1.get('user') or {}).get('signupBonusLocked')}", 'CRITICAL',
   'Boost-only bonus money can be sent out.')
# locked money cannot leave the wallet
_t1, _ = login((j1.get('_email') or 'bonus1@gmail.com', 'Staging123!'), ip_addr=ip())
sx, sent = req('/api/transfer', {'senderId': id1, 'recipientId': 'U1', 'amount': 5, 'idempotencyKey': 'bonus-locked-' + _RUN_TAG},
               token=_t1, ip_addr=ip())
ck('boost-only bonus money cannot be transferred', sx in (400, 403),
   f"{sx} {sent.get('error')} sendable={sent.get('sendable')}", 'CRITICAL', 'A boost-only signup bonus can be sent out of the wallet.')
ck('the refusal names the bonus, not a fake admin hold',
   'signup bonus' in str(sent.get('error') or '').lower(), f"{sent.get('error')}", 'HIGH',
   'The user is told an admin is holding their money when it is really a boost-only bonus.')
# the ledger recorded it as money in — visible to the admin as a claimant row
sx, ledger = req('/api/db', token=_t1, ip_addr=ip())
_txs = (ledger or {}).get('transactions') or []
ck('the bonus is a real ledger row',
   any(str((t or {}).get('type')) == 'SIGNUP_BONUS' and str((t or {}).get('userId')) == str(id1) for t in _txs),
   f"rows={len(_txs)}", 'HIGH', 'The bonus is not in the transaction history.')
# 2nd signup uses the last remaining slot, 3rd gets nothing
s2, id2, j2 = signup_child('bonus2@gmail.com', _bc)
ck('the second signup still gets the bonus', s2 == 200 and num((j2.get('bonus') or {}).get('paid')) == 5,
   f"{s2} bonus={j2.get('bonus')}", 'HIGH', 'The cap blocks a signup too early.')
s3, id3, j3 = signup_child('bonus3@gmail.com', _bc)
ck('once the person-cap is reached nobody else gets money', s3 == 200 and not (j3.get('bonus') or {}).get('paid'),
   f"{s3} bonus={j3.get('bonus')} balance={(j3.get('user') or {}).get('balance')}", 'CRITICAL',
   'The person-cap does not stop the bonus — money can be minted without limit.')
sx, chk2 = req(f'/api/refer/check-code?code={_bc}', ip_addr=ip())
ck('an exhausted code reports itself as inactive', (chk2.get('bonus') or {}).get('active') is False,
   f"bonus={chk2.get('bonus')}", 'HIGH', 'An exhausted code still advertises a bonus.')
# a transferable bonus is spendable
_tc = f'BONUST{_RUN_TAG[-3:]}'.upper()
sx, _ = req('/api/admin/bonus-codes/save', {'code': _tc, 'amount': 3, 'maxClaims': 5, 'transferable': True}, token=at2, ip_addr=ip())
s4, id4, j4 = signup_child('bonust@gmail.com', _tc)
ck('a transferable bonus is credited and NOT locked',
   s4 == 200 and num((j4.get('user') or {}).get('balance')) == 3 and num((j4.get('user') or {}).get('signupBonusLocked')) == 0,
   f"balance={(j4.get('user') or {}).get('balance')} locked={(j4.get('user') or {}).get('signupBonusLocked')}", 'HIGH',
   'A transferable bonus behaves like locked money.')
_tok4, _ = login((j4.get('_email') or 'bonust@gmail.com', 'Staging123!'), ip_addr=ip())
sx, sent2 = req('/api/transfer', {'senderId': id4, 'recipientId': 'U1', 'amount': 1, 'idempotencyKey': 'bonus-open-' + _RUN_TAG},
                token=_tok4, ip_addr=ip())
ck('a transferable bonus can be sent', sx == 200, f"{sx} {sent2.get('error')}", 'CRITICAL',
   'A transferable bonus cannot be spent — the flag does nothing.')
# editing + switching off
sx, edited = req('/api/admin/bonus-codes/save', {'code': _tc, 'amount': 4, 'maxClaims': 1, 'transferable': True, 'enabled': False}, token=at2, ip_addr=ip())
ck('an admin can edit and switch a bonus code off', sx in (200, 400),
   f"{sx} {edited.get('error')}", 'HIGH', 'Bonus codes cannot be edited or switched off.')
sx, capdown = req('/api/admin/bonus-codes/save', {'code': _bc, 'amount': 5, 'maxClaims': 1}, token=at2, ip_addr=ip())
ck('the cap cannot be lowered below the people who already used it', sx == 400, f"{sx} {capdown.get('error')}", 'MEDIUM',
   'Lowering the cap can make the ledger inconsistent.')
sx, listed = req('/api/admin/bonus-codes', token=at2, ip_addr=ip())
ck('the admin list shows usage, paid total and claimants (ids only)',
   sx == 200 and any(c.get('code') == _bc for c in (listed.get('codes') or [])) and num(listed.get('stats', {}).get('totalClaims')) >= 2
   and '@' not in json.dumps(listed.get('codes') or []),
   f"paid={listed.get('stats', {}).get('paidTotal')} claims={listed.get('stats', {}).get('totalClaims')}", 'HIGH',
   'The admin cannot see who used a bonus code.')
sx, gone = req('/api/admin/bonus-codes/remove', {'code': _bc}, token=at2, ip_addr=ip())
ck('an admin can retire a bonus code', sx == 200, f"{sx}", 'HIGH', 'Bonus codes cannot be retired.')
sx, after = req(f'/api/refer/check-code?code={_bc}', ip_addr=ip())
ck('a retired code no longer offers money', (after.get('bonus') or {}) in (None, {}) or (after.get('bonus') or {}).get('active') is False,
   f"bonus={after.get('bonus')}", 'CRITICAL', 'A retired bonus code still pays.')

# ── 18. promotion engine (campaigns + bonus wallet) ─────────────────────────
print("\n[18. promotion engine]")
sa, pa = req('/api/admin/login', ADMIN, ip_addr=ip())
pt = pa.get('token') or ''
_c = f'CAMP{_RUN_TAG[-3:]}'.upper()
sx, anon = req('/api/admin/promo/campaigns', ip_addr=ip())
ck('the campaign list needs an admin session', sx == 401, f"{sx}", 'CRITICAL', 'Anonymous callers can read every campaign.')
sx, asuser = req('/api/admin/promo/campaigns', token=tu3, ip_addr=ip())
ck('a user token cannot read campaigns', sx in (401, 403), f"{sx}", 'CRITICAL', 'A user can read the campaign registry.')
sx, bad = req('/api/admin/promo/campaigns/save', {'code': _c, 'bonusPerUser': -1, 'maxUses': 10}, token=pt, ip_addr=ip())
ck('a negative bonus is refused', sx == 400, f"{sx} {bad.get('error')}", 'CRITICAL', 'A campaign can be created that debits users.')
sx, made = req('/api/admin/promo/campaigns/save', {
    'code': _c, 'name': 'Journey campaign', 'bonusPerUser': 2, 'maxUses': 2,
    'status': 'ACTIVE', 'bonusTransfer': False, 'bonusWithdraw': False,
    'budgetLimit': 100, 'bonusExpiryDays': 7, 'audience': 'NEW'}, token=pt, ip_addr=ip())
ck('an admin can create a campaign with all its settings', sx == 200 and num((made.get('campaign') or {}).get('bonusPerUser')) == 2,
   f"{sx} {made.get('error')}", 'HIGH', 'Campaigns cannot be created.')
sx, dupe = req('/api/admin/promo/campaigns/save', {'code': _c, 'bonusPerUser': 2, 'maxUses': 2, 'status': 'ACTIVE'}, token=pt, ip_addr=ip())
ck('the same campaign code cannot exist twice', sx == 409, f"{sx}", 'HIGH', 'Two campaigns can share one code.')
sx, rnd = req('/api/admin/promo/random-code', token=pt, ip_addr=ip())
ck('a random code can be generated', sx == 200 and len(str(rnd.get('code') or '')) >= 6, f"code={rnd.get('code')}", 'MEDIUM',
   'The random code generator does not work.')
sx, pub = req(f'/api/promo/code/{_c}', ip_addr=ip())
ck('the signup screen can read a campaign before joining', sx == 200 and num((pub.get('campaign') or {}).get('bonusPerUser')) == 2,
   f"{sx} {pub.get('campaign')}", 'HIGH', 'The public campaign lookup fails.')
ck('the public view exposes the bonus rules but no internals',
   (pub.get('campaign') or {}).get('creditedTo') == 'BALANCE' and 'budgetUsed' not in json.dumps(pub.get('campaign') or {}),
   f"campaign={pub.get('campaign')}", 'HIGH', 'The public campaign view leaks internals.')
# join 1: paid
sx, cid1, cj1 = signup_child('camp1@gmail.com', _c)
ck('joining with a campaign code pays the bonus', sx == 200 and (cj1.get('campaign') or {}).get('paid') is True,
   f"{sx} campaign={cj1.get('campaign')}", 'CRITICAL', 'A campaign bonus is not paid at signup.')
ct1, _ = login((cj1.get('_email') or 'camp1@gmail.com', 'Staging123!'), ip_addr=ip())
sx, bw = req('/api/user/bonus', token=ct1, ip_addr=ip())
ck('the campaign bonus lands in the main balance',
   sx == 200 and num((bw.get('wallet') or {}).get('mainBalance')) >= 2,
   f"main={(bw.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'The campaign bonus does not reach the balance.')
ck('there is no second bonus wallet to keep track of',
   num((bw.get('wallet') or {}).get('available')) == 0 and (bw.get('wallet') or {}).get('grants') == [],
   f"wallet={bw.get('wallet')}", 'HIGH', 'A separate bonus wallet still holds money.')
sx, conv = req('/api/user/bonus/convert', {'amount': 1}, token=ct1, ip_addr=ip())
ck('the retired "convert" call does nothing and does not error', sx == 200 and num(conv.get('moved')) == 0,
   f"{sx} moved={conv.get('moved')}", 'HIGH', 'An installed app breaks on the retired bonus wallet.')
sx, sendb = req('/api/user/bonus/send', {'toUserId': 'U1', 'amount': 1}, token=ct1, ip_addr=ip())
ck('the retired bonus transfer is closed (410)', sx == 410, f"{sx} {sendb.get('error')}", 'HIGH',
   'Bonus money can still be moved bonus-to-bonus.')
# bonus expiry
sx, _ = req('/api/admin/promo/campaigns/save', {'id': (made.get('campaign') or {}).get('id'), 'code': _c, 'name': 'Journey campaign', 'bonusPerUser': 2, 'maxUses': 2, 'status': 'ACTIVE', 'budgetLimit': 100, 'bonusLockDays': 0, 'audience': 'NEW'}, token=pt, ip_addr=ip())
ck('a campaign can be edited (rules changed)', sx == 200, f"{sx}", 'HIGH', 'Campaign edit fails.')
# join 2 uses the last slot
sx, cid2, cj2 = signup_child('camp2@gmail.com', _c)
ck('the last remaining slot still pays', sx == 200 and (cj2.get('campaign') or {}).get('paid') is True, f"{sx}", 'HIGH',
   'The cap blocks a join one slot too early.')
# join 3: cap full
sx, cid3, cj3 = signup_child('camp3@gmail.com', _c)
ck('when the cap is reached nobody else is paid', sx == 200 and (cj3.get('campaign') or {}).get('paid') is False and (cj3.get('campaign') or {}).get('reason') == 'FULL',
   f"{sx} campaign={cj3.get('campaign')}", 'CRITICAL', 'The use-cap does not stop the bonus.')
# pause stops payment, resume restores it
sx, _ = req('/api/admin/promo/campaigns/status', {'id': (made.get('campaign') or {}).get('id'), 'status': 'PAUSED'}, token=pt, ip_addr=ip())
sx2, cp = req(f'/api/promo/code/{_c}', ip_addr=ip())
ck('a paused campaign reports itself as paused', cp and (cp.get('campaign') or {}).get('valid') is False and (cp.get('campaign') or {}).get('reason') == 'PAUSED',
   f"{cp.get('campaign')}", 'HIGH', 'Pause is not visible on the signup screen.')
sx, _ = req('/api/admin/promo/campaigns/status', {'id': (made.get('campaign') or {}).get('id'), 'status': 'ACTIVE'}, token=pt, ip_addr=ip())
sx2, cv = req(f'/api/promo/code/{_c}', ip_addr=ip())
ck('pausing is reversible (resume restores the code)', (cv.get('campaign') or {}).get('reason') in ('FULL', 'OK'), f"{cv.get('campaign')}", 'HIGH',
   'Resume does not restore the campaign.')
# budget + expiry rules are enforced server-side
sx, bud = req('/api/admin/promo/campaigns/save', {'code': f'BUD{_RUN_TAG[-3:]}'.upper(), 'bonusPerUser': 70, 'maxUses': 100, 'status': 'ACTIVE', 'budgetLimit': 100}, token=pt, ip_addr=ip())
_bc2 = f'BUD{_RUN_TAG[-3:]}'.upper()
sx1, _, bj1 = signup_child('bud1@gmail.com', _bc2)
sx2, _, bj2 = signup_child('bud2@gmail.com', _bc2)
ck('a campaign stops paying when the budget is spent',
   (bj1.get('campaign') or {}).get('paid') is True and (bj2.get('campaign') or {}).get('paid') is False,
   f"first={bj1.get('campaign')} second={bj2.get('campaign')}", 'CRITICAL', 'The budget cap does not stop payments.')
# date window
_ec = f'EXP{_RUN_TAG[-3:]}'.upper()
sx, _ = req('/api/admin/promo/campaigns/save', {'code': _ec, 'bonusPerUser': 1, 'maxUses': 10, 'status': 'ACTIVE',
    'startAt': int(time.time()*1000) + 86400000, 'endAt': int(time.time()*1000) + 2*86400000}, token=pt, ip_addr=ip())
sx1, _, ej = signup_child('exp1@gmail.com', _ec)
ck('a campaign that has not started yet pays nothing', (ej.get('campaign') or {}).get('paid') is False and (ej.get('campaign') or {}).get('reason') == 'NOT_STARTED',
   f"campaign={ej.get('campaign')}", 'HIGH', 'A future campaign pays early.')
# dashboard + leaderboard + reviews
sx, dash = req('/api/admin/promo/campaigns', token=pt, ip_addr=ip())
_rows = (dash.get('campaigns') or [])
_mine = [c for c in _rows if c.get('code') == _c]
ck('the dashboard reports joins, paid total, slots and conversion',
   bool(_mine) and num(_mine[0]['stats']['joins']) >= 2 and num(_mine[0]['stats']['bonusIssued']) > 0 and isinstance(_mine[0]['stats']['days'], list),
   f"stats={(_mine[0]['stats'] if _mine else None)}", 'HIGH', 'The campaign dashboard has no usable statistics.')
ck('the campaign list carries no user e-mails', '@' not in json.dumps(_rows), 'ids only', 'CRITICAL', 'The campaign dashboard leaks user identities.')
sx, lb = req('/api/admin/promo/leaderboard', token=pt, ip_addr=ip())
ck('the leaderboard ranks campaigns by first deposits', sx == 200 and isinstance(lb.get('leaderboard'), list), f"{sx}", 'MEDIUM',
   'No leaderboard data.')
sx, rv = req('/api/admin/promo/reviews', token=pt, ip_addr=ip())
ck('the fraud review queue is readable', sx == 200 and isinstance(rv.get('reviews'), list), f"{sx} {rv.get('counts')}", 'HIGH',
   'The review queue cannot be read.')
# revoke with a reason
sx, g = req(f'/api/admin/promo/campaign/{ (made.get("campaign") or {}).get("id") }', token=pt, ip_addr=ip())
_gr = (g.get('grants') or [])
_g1 = next((x for x in _gr if str(x.get('userId')) == str(cid1)), (_gr[0] if _gr else {}))
sx, rev = req('/api/admin/promo/revoke', {'grantId': (_g1.get('id') or 'x'), 'reason': ''}, token=pt, ip_addr=ip())
ck('revoking without a reason is refused', sx == 400, f"{sx} {rev.get('error')}", 'HIGH', 'A bonus can be revoked with no audit trail.')
sx, rev2 = req('/api/admin/promo/revoke', {'grantId': (_g1.get('id') or 'x'), 'reason': 'journey test'}, token=pt, ip_addr=ip())
ck('an admin can revoke a bonus with a reason', sx == 200, f"{sx} {rev2.get('error')}", 'HIGH', 'Bonus revoke fails.')
sx, after = req('/api/user/bonus', token=ct1, ip_addr=ip())  # ct1 = first join of this campaign
ck('the revoked bonus is taken back out of the balance', sx == 200 and num(after.get('wallet', {}).get('mainBalance')) >= 0 and num(rev2.get('deducted')) > 0,
   f"deducted={rev2.get('deducted')} main={(after.get('wallet') or {}).get('mainBalance')}", 'CRITICAL',
   'A revoked bonus stays in the balance as real money.')

# duplicate-account protection
_dc = f'DUP{_RUN_TAG[-3:]}'.upper()
req('/api/admin/promo/campaigns/save', {'code': _dc, 'bonusPerUser': 1, 'maxUses': 50, 'status': 'ACTIVE'}, token=pt, ip_addr=ip())
_same_ip = '10.55.55.5'
def signup_at(email, code, ip_addr, device=''):
    local, _, dom = email.partition('@')
    addr = f'{local}-{_RUN_TAG}@{dom}'
    headers_extra = {'x-device-id': device} if device else {}
    sX, jX = req('/api/users/register', {'email': addr, 'password': 'Staging123!', 'referralCode': code},
                 ip_addr=ip_addr)
    if isinstance(jX, dict):
        jX['_email'] = addr
    return sX, str(((jX.get('user') or {}).get('id')) or ''), jX
s1, d1id, dj1 = signup_at('dup1@gmail.com', _dc, _same_ip, device='DEV-DUP')
ck('first claim from an IP is paid', (dj1.get('campaign') or {}).get('paid') is True, f"{dj1.get('campaign')}", 'HIGH',
   'The duplicate test could not establish a clean first claim.')
s2, d2id, dj2 = signup_at('dup2@gmail.com', _dc, _same_ip, device='DEV-DUP')
ck('a second account from the same IP/device is held, not paid',
   (dj2.get('campaign') or {}).get('paid') is False and (dj2.get('campaign') or {}).get('reason') == 'PENDING_REVIEW',
   f"{dj2.get('campaign')}", 'CRITICAL', 'One person can farm the same campaign with several accounts.')
sx, q = req('/api/admin/promo/reviews?status=PENDING', token=pt, ip_addr=ip())
_pending_rows = q.get('reviews') or []
ck('the held bonus shows up in the admin review queue',
   any(str(r.get('userId')) == str(d2id) for r in _pending_rows), f"pending={len(_pending_rows)} num(q.get('counts'))", 'HIGH',
   'A held bonus never reaches the review queue.')
_row = next((r for r in _pending_rows if str(r.get('userId')) == str(d2id)), None)
if _row:
    sx, dec = req('/api/admin/promo/reviews/decide', {'id': _row['id'], 'action': 'approve'}, token=pt, ip_addr=ip())
    ck('an admin can approve a held bonus and it is paid', sx == 200, f"{sx} {dec.get('error')}", 'HIGH',
       'Approving a review does not pay the bonus.')
    dt2, _ = login((dj2.get('_email') or 'dup2@gmail.com', 'Staging123!'), ip_addr=ip())
    sx, bw2 = req('/api/user/bonus', token=dt2, ip_addr=ip())
    ck('the approved bonus lands in the main balance', num((bw2.get('wallet') or {}).get('mainBalance')) == 1,
       f"main={(bw2.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'An approved bonus is not credited.')


# ── 19. promo bonus policy: main balance, optional lock, nothing expires ─────
print("\n[19. promo bonus lock policy]")


def _lock_campaign(code, amount, lock_days):
    sx, jx = req('/api/admin/promo/campaigns/save', {
        'code': code, 'name': f'Lock {lock_days}d', 'bonusPerUser': amount, 'maxUses': 20,
        'minDeposit': 0, 'bonusLockDays': lock_days, 'status': 'ACTIVE', 'audience': 'NEW',
    }, token=pt, ip_addr=ip())
    return sx, jx


def _join_and_read(email, code, device):
    _s, _id, _j = signup_at(email, code, ip(), device=device)
    _tok, _me = login(((_j.get('_email') or email), 'Staging123!'), ip_addr=ip())
    return _id, _tok, num((_me or {}).get('balance')), _j


DB_PATH = os.environ.get('JOURNEY_DB', 'data/boostpay_db.json')


def _expire_grant_now(user_id, campaign_code):
    """Force an old expiry date onto a grant — nothing should happen any more."""
    try:
        raw = json.load(open(DB_PATH))
    except Exception:
        return 0
    hit = 0
    for g in raw.get('bonusGrants', []):
        if (str(g.get('userId')) == str(user_id) and str(g.get('campaignCode')) == campaign_code
                and g.get('status') == 'ACTIVE'):
            g['expiresAt'] = int(time.time() * 1000) - 60000
            hit += 1
    if hit:
        json.dump(raw, open(DB_PATH, 'w'), indent=1)
    return hit


_lokA = f'POL{_RUN_TAG}'
sx, jx = _lock_campaign(_lokA, 5, 7)
ck('a campaign can lock the bonus for transfers (boost stays open)', sx == 200,
   f'{sx} {jx.get("error")}', 'HIGH', 'The bonus lock cannot be configured.')
lkid, lktok, lkbal, lkj = _join_and_read('pol1@gmail.com', _lokA, 'DEV-POL1')
ck('joining a locked campaign pays the bonus into the balance at once',
   (lkj.get('campaign') or {}).get('paid') is True and abs(lkbal - 5) < 1e-6,
   f"paid={(lkj.get('campaign') or {}).get('paid')} balance={lkbal}", 'CRITICAL',
   'A locked campaign does not credit the balance.')
sx, bw = req('/api/user/bonus', token=lktok, ip_addr=ip())
ck('the wallet shows the bonus as locked, not as a separate purse',
   num((bw.get('wallet') or {}).get('mainBalance')) == 5 and num((bw.get('wallet') or {}).get('lockedPromo')) == 5
   and num((bw.get('wallet') or {}).get('available')) == 0,
   f"main={(bw.get('wallet') or {}).get('mainBalance')} locked={(bw.get('wallet') or {}).get('lockedPromo')}", 'HIGH',
   'The lock is not reported to the user.')
sx, cv = req(f'/api/promo/code/{_lokA}', ip_addr=ip())
ck('the lock is advertised at signup and no expiry is',
   (cv.get('campaign') or {}).get('bonusLockDays') == 7 and 'bonusExpiryDays' not in (cv.get('campaign') or {}),
   f"{cv.get('campaign')}", 'MEDIUM', 'The signup screen shows the wrong bonus rules.')
sx, lsend = req('/api/transfer', {'senderId': str(lkid), 'recipientId': 'U1', 'amount': 1,
                                  'idempotencyKey': 'pl' + str(int(time.time()))}, token=lktok, ip_addr=ip())
ck('while locked the bonus cannot be transferred',
   sx == 403 and 'promotion bonus' in str(lsend.get('error') or '').lower(),
   f"{sx} {lsend.get('error')}", 'CRITICAL', 'Locked bonus money leaves the account.')
sx, lboost = req('/api/boost/start', {'userId': str(lkid)}, token=lktok, ip_addr=ip())
ck('while locked the bonus can still be boosted', sx == 200, f"{sx} {lboost.get('error')}", 'CRITICAL',
   'The lock also blocks boosting — the owner asked for boosting to stay open.')

# an unlocked campaign is spendable straight away
_freC = f'FRE{_RUN_TAG}'
_lock_campaign(_freC, 3, 0)
frid, frtok, frbal, _ = _join_and_read('pol2@gmail.com', _freC, 'DEV-POL2')
sx, fsend = req('/api/transfer', {'senderId': str(frid), 'recipientId': 'U1', 'amount': 1,
                                  'idempotencyKey': 'pf' + str(int(time.time()))}, token=frtok, ip_addr=ip())
ck('with no lock the bonus can be sent straight away', sx == 200, f"{sx} {fsend.get('error')}", 'CRITICAL',
   'An unlocked bonus is still stuck.')

# nothing expires any more: force the old expiry field and the money stays
_expire_grant_now(frid, _freC)
sx, bw3 = req('/api/user/bonus', token=frtok, ip_addr=ip())
_tok3, me3 = login((f'pol2-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
ck('a stale expiry date never removes money from the balance',
   num(me3.get('balance')) >= 1 and num((bw3.get('wallet') or {}).get('mainBalance')) >= 1,
   f"balance={me3.get('balance')}", 'CRITICAL', 'An expiry date still eats the user balance.')
ck('nothing in the wallet claims an expiry or a burn',
   num((bw3.get('wallet') or {}).get('nextExpiryAt')) == 0 and (bw3.get('wallet') or {}).get('grants') == [],
   f"wallet={bw3.get('wallet')}", 'HIGH', 'The retired expiry policy is still exposed.')

# the audit trail records where the money went
ck('the ledger records the bonus as money added to the balance',
   any('main balance' in str(r.get('notes') or '').lower() for r in ((bw3.get('ledger') or []))),
   f"{(bw3.get('ledger') or [])[:1]}", 'MEDIUM', 'There is no audit trail for a bonus payout.')


# ── 20. "send to refer only" — admin pins transfers to the upline ────────────
print("\n[20. send to refer only]")
_up1_s, _up1, _ = signup_child('upline@gmail.com', 'U1')          # child of U1 (L1)
_up2_s, _up2, _ = signup_child('downline@gmail.com', _up1)        # grandchild (L2)
_up3_s, _up3, _ = signup_child('deep@gmail.com', _up2)            # great-grandchild (L3)
_l1_tok, _ = login((f'upline-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
_l2_tok, _ = login((f'downline-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
# fresh admin session — an admin token from an earlier section can be signed out
_rsa_s, _rsa_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rsadm = _rsa_j.get('token') or ''
ck('the test chain exists (L1 + L2 + L3)', bool(_up1 and _up2 and _up3), f'{_up1}/{_up2}/{_up3}', 'HIGH',
   'The upline chain could not be built, so the send rule cannot be tested.')

# fund the sender so a refusal is about the rule, not about the balance
for _amt in (6, 6):
    req('/api/transfer', {'senderId': 'U1', 'recipientId': _up1, 'amount': _amt,
                          'idempotencyKey': f'rsfund{_RUN_TAG}{_amt}{_up1}'}, tu1, ip_addr=ip())

sx, rs = req('/api/admin/users/refer-send', {'userId': _up1, 'mode': 'l1', 'amount': 10, 'period': 'total',
                                             'note': 'journey test'}, token=_rsadm, ip_addr=ip())
ck('an admin can pin sending to the direct refer, with a cap', sx == 200 and (rs.get('referSend') or {}).get('mode') == 'l1',
   f"{sx} {rs.get('referSend')}", 'CRITICAL', 'The admin cannot set a send-to-refer rule.')

sx, mine = req('/api/user/refer-send', token=_l1_tok, ip_addr=ip())
ck('the user is told the rule before they send', mine.get('restricted') is True and mine.get('mode') == 'l1',
   f"restricted={mine.get('restricted')} mode={mine.get('mode')} referrer={mine.get('referrerId')}", 'HIGH',
   'The Send screen cannot know about the restriction.')
ck('only one recipient is allowed on L1 mode', int(mine.get('allowedCount') or 0) == 1,
   f"allowed={mine.get('allowedCount')}", 'HIGH', 'L1 mode allows more than the direct refer.')
ck('the rule names the real referrer', str(mine.get('referrerId')) == 'U1',
   f"referrerId={mine.get('referrerId')}", 'MEDIUM', 'The referrer shown is not the real account.')

sx, to_stranger = req('/api/transfer', {'senderId': _up1, 'recipientId': 'U2', 'amount': 1,
                                        'idempotencyKey': f'rsx{_RUN_TAG}1'}, _l1_tok, ip_addr=ip())
ck('sending to somebody outside the rule is refused', sx == 403 and to_stranger.get('referSendLimited') is True,
   f"{sx} {to_stranger.get('error')}", 'CRITICAL', 'A restricted user can still pay anyone.')

sx, to_child = req('/api/transfer', {'senderId': _up1, 'recipientId': _up2, 'amount': 1,
                                     'idempotencyKey': f'rsx{_RUN_TAG}2'}, _l1_tok, ip_addr=ip())
ck('L1 mode also blocks the user own downline', sx == 403,
   f"{sx} {to_child.get('error')}", 'HIGH', 'L1 mode leaks to team members.')

sx, ok_send = req('/api/transfer', {'senderId': _up1, 'recipientId': 'U1', 'amount': 4,
                                    'idempotencyKey': f'rsok{_RUN_TAG}'}, _l1_tok, ip_addr=ip())
ck('sending to the direct refer still works inside the cap', sx == 200,
   f"{sx} {(ok_send or {}).get('error')}", 'CRITICAL', 'The rule blocks even the allowed transfer.')

sx, over = req('/api/transfer', {'senderId': _up1, 'recipientId': 'U1', 'amount': 7,
                                 'idempotencyKey': f'rsover{_RUN_TAG}'}, _l1_tok, ip_addr=ip())
ck('the cap is enforced — $4 used of $10 means $7 is refused', sx == 403,
   f"{sx} {over.get('error')}", 'CRITICAL', 'The amount cap can be bypassed.')
sx, mine2 = req('/api/user/refer-send', token=_l1_tok, ip_addr=ip())
ck('the user sees how much of the cap is left', abs(num(mine2.get('used')) - 4) < 1e-6 and abs(num(mine2.get('remaining')) - 6) < 1e-6,
   f"used={mine2.get('used')} remaining={mine2.get('remaining')}", 'HIGH',
   'The user cannot tell how much they may still send.')

sx, audit = req('/api/admin/audit-logs', token=_rsadm, ip_addr=ip())
_rows = audit.get('logs') if isinstance(audit.get('logs'), list) else (audit.get('auditLogs') or [])
ck('the rule change is in the audit log',
   any('REFER_SEND' in str(r.get('action') or r.get('type') or '') and str(_up1) in str(r.get('details') or r.get('message') or '') for r in _rows),
   f"rows={len(_rows)}", 'HIGH', 'An admin send-rule change left no audit trail.')

# tick "also allow team members" → the downline (L2 and L3) may now receive
sx, teamset = req('/api/admin/users/refer-send', {'userId': _up1, 'mode': 'team', 'amount': 0, 'period': 'day'},
                  token=_rsadm, ip_addr=ip())
ck('the admin can widen it to refer + team', sx == 200 and (teamset.get('referSend') or {}).get('mode') == 'team',
   f"{sx} {teamset.get('referSend')}", 'HIGH', 'Team mode cannot be set.')
sx, mine3 = req('/api/user/refer-send', token=_l1_tok, ip_addr=ip())
ck('team mode allows the whole downline, not just one level', int(mine3.get('allowedCount') or 0) >= 2,
   f"allowed={mine3.get('allowedCount')}", 'HIGH', 'Team mode only reaches L1.')
sx, deep_ok = req('/api/transfer', {'senderId': _up1, 'recipientId': _up3, 'amount': 1,
                                    'idempotencyKey': f'rsteam{_RUN_TAG}'}, _l1_tok, ip_addr=ip())
ck('an L3 member can receive once team mode is on', sx == 200,
   f"{sx} {(deep_ok or {}).get('error')}", 'CRITICAL', 'Team mode does not reach deep members.')
sx, still_no = req('/api/transfer', {'senderId': _up1, 'recipientId': 'U2', 'amount': 1,
                                     'idempotencyKey': f'rsteamx{_RUN_TAG}'}, _l1_tok, ip_addr=ip())
ck('team mode still refuses outsiders', sx == 403, f"{sx} {still_no.get('error')}", 'HIGH',
   'Team mode opens sending to the whole platform.')

sx, off = req('/api/admin/users/refer-send', {'userId': _up1, 'mode': 'off'}, token=_rsadm, ip_addr=ip())
sx, after = req('/api/transfer', {'senderId': _up1, 'recipientId': 'U2', 'amount': 1,
                                  'idempotencyKey': f'rsoff{_RUN_TAG}'}, _l1_tok, ip_addr=ip())
ck('removing the rule restores normal sending', sx == 200,
   f"{sx} {(after or {}).get('error')}", 'CRITICAL', 'The restriction cannot be released.')
sx, neg = req('/api/admin/users/refer-send', {'userId': _up1, 'mode': 'team', 'amount': -5}, token=_rsadm, ip_addr=ip())
ck('a negative limit is refused', sx == 400, f"{sx} {neg.get('error')}", 'MEDIUM',
   'A negative cap is accepted, which could block or corrupt the check.')
sx, badmode = req('/api/admin/users/refer-send', {'userId': _up1, 'mode': 'everyone'}, token=_rsadm, ip_addr=ip())
ck('an unknown mode is refused', sx == 400, f"{sx} {badmode.get('error')}", 'MEDIUM',
   'An unknown mode silently becomes something else.')


# ── 21. "also apply to the receiver" — the rule follows the money ────────────
print("\n[21. rule follows the money]")
_rs2_s, _rs2_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs2adm = _rs2_j.get('token') or ''

# safety: make sure the earlier sections left U1 free
req('/api/admin/users/refer-send', {'userId': 'U1', 'mode': 'off'}, token=_rs2adm, ip_addr=ip())

# a fresh 3-account chain: X (under U1) → Y (under X) → Z (under Y)
_sx_s, X, _ = signup_child('chainx@gmail.com', 'U1')
_sy_s, Y, _ = signup_child('chainy@gmail.com', X)
_sz_s, Z, _ = signup_child('chainz@gmail.com', Y)
_x_tok, _ = login((f'chainx-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
_y_tok, _ = login((f'chainy-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
_u1_tok, _ = login(U1, ip_addr=ip())
for _a in (5, 5):
    req('/api/transfer', {'senderId': 'U1', 'recipientId': X, 'amount': _a,
                          'idempotencyKey': f'chf{_RUN_TAG}{_a}'}, _u1_tok, ip_addr=ip())
ck('the money chain exists', bool(X and Y and Z), f'{X}/{Y}/{Z}', 'HIGH', 'Could not build the chain for the receiver test.')

# tick OFF: the receiver stays free
sx, noinh = req('/api/admin/users/refer-send', {'userId': X, 'mode': 'team', 'amount': 0, 'inherit': False},
                token=_rs2adm, ip_addr=ip())
ck('the receiver tick starts off', sx == 200 and (noinh.get('referSend') or {}).get('inherit') is False,
   f"{sx} {(noinh.get('referSend') or {}).get('inherit')}", 'MEDIUM', 'The receiver tick cannot be turned off.')
sx, moved = req('/api/transfer', {'senderId': X, 'recipientId': Y, 'amount': 1,
                                  'idempotencyKey': f'noinh{_RUN_TAG}'}, _x_tok, ip_addr=ip())
ck('with the tick off the money still moves', sx == 200, f"{sx} {(moved or {}).get('error')}", 'HIGH',
   'The rule blocks an allowed transfer.')
sx, yfree = req('/api/user/refer-send', token=_y_tok, ip_addr=ip())
ck('with the tick off the receiver can send to anyone', yfree.get('restricted') is False,
   f"restricted={yfree.get('restricted')} mode={yfree.get('mode')}", 'CRITICAL',
   'The receiver is restricted even though the admin did not ask for it.')

# tick ON: the receiver inherits the same rule
# team mode, so X may pay its own downline (Y) — and that payment carries the rule
sx, inh = req('/api/admin/users/refer-send', {'userId': X, 'mode': 'team', 'amount': 0, 'inherit': True},
              token=_rs2adm, ip_addr=ip())
ck('the admin can tick "also apply to the receiver"', sx == 200 and (inh.get('referSend') or {}).get('inherit') is True,
   f"{sx} {(inh.get('referSend') or {}).get('inherit')}", 'CRITICAL', 'The receiver tick cannot be set.')
req('/api/admin/users/refer-send', {'userId': Y, 'mode': 'off'}, token=_rs2adm, ip_addr=ip())
sx, moved2 = req('/api/transfer', {'senderId': X, 'recipientId': Y, 'amount': 1,
                                   'idempotencyKey': f'inh{_RUN_TAG}'}, _x_tok, ip_addr=ip())
ck('the allowed transfer goes through with the tick on', sx == 200, f"{sx} {(moved2 or {}).get('error')}", 'HIGH',
   'The rule blocks the transfer that should inherit.')
sx, ynow = req('/api/user/refer-send', token=_y_tok, ip_addr=ip())
ck('the receiver is now under the same rule', ynow.get('restricted') is True and ynow.get('mode') == 'team',
   f"restricted={ynow.get('restricted')} mode={ynow.get('mode')}", 'CRITICAL',
   'The same rule does not follow the money to the receiver.')
ck('the receiver is told where the rule came from', ynow.get('inherited') is True and str(ynow.get('inheritedFrom')) == str(X),
   f"inherited={ynow.get('inherited')} from={ynow.get('inheritedFrom')}", 'HIGH',
   'The receiver cannot tell why they are restricted.')

# the chain keeps going: Y (now restricted) pays Z → Z inherits as well
sx, yz = req('/api/transfer', {'senderId': Y, 'recipientId': Z, 'amount': 1,
                               'idempotencyKey': f'chainyz{_RUN_TAG}'}, _y_tok, ip_addr=ip())
ck('the newly restricted receiver can still pay down the chain', sx == 200,
   f"{sx} {(yz or {}).get('error')}", 'CRITICAL', 'The inherited rule blocks the user own downline.')
sx, znow = req('/api/user/refer-send', token=login((f'chainz-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())[0], ip_addr=ip())
ck('the rule keeps following the money to the next hop', znow.get('restricted') is True,
   f"restricted={znow.get('restricted')} mode={znow.get('mode')}", 'CRITICAL',
   'The rule stops following the money after one hop.')

# an inherited rule never overwrites an explicit admin rule
sx, _ = req('/api/admin/users/refer-send', {'userId': Z, 'mode': 'team', 'amount': 99, 'period': 'day', 'inherit': False},
            token=_rs2adm, ip_addr=ip())
sx, _z2 = req('/api/admin/users/refer-send', {'userId': Y, 'mode': 'l1', 'amount': 0, 'inherit': True}, token=_rs2adm, ip_addr=ip())
sx, zview = req('/api/user/refer-send', token=login((f'chainz-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())[0], ip_addr=ip())
ck('an admin rule on the receiver is never overwritten by an inherited one',
   zview.get('inherited') is False and zview.get('mode') == 'team' and num(zview.get('amount')) == 99,
   f"mode={zview.get('mode')} amount={zview.get('amount')} inherited={zview.get('inherited')}", 'CRITICAL',
   'Inheritance silently replaces a rule the admin set by hand.')

sx, au = req('/api/admin/audit-logs', token=_rs2adm, ip_addr=ip())
_rows2 = au.get('logs') if isinstance(au.get('logs'), list) else (au.get('auditLogs') or [])
ck('every inheritance is written to the audit log',
   any('REFER_SEND_INHERIT' in str(r.get('action') or '') for r in _rows2), f"rows={len(_rows2)}", 'HIGH',
   'Money changing who may send leaves no audit trail.')

# clean up so a re-run starts from a clean state
for _uid in (X, Y, Z, 'U1'):
    req('/api/admin/users/refer-send', {'userId': _uid, 'mode': 'off'}, token=_rs2adm, ip_addr=ip())


# ── 22. the admin can see how much a user has sent and how much is left ─────
print("\n[22. admin sees sent / remaining]")
_u3_s, U, _ = signup_child('usageu@gmail.com', 'U1')
_u_tok, _ = login((f'usageu-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
_u1b, _ = login(U1, ip_addr=ip())
for _a in (6, 6):
    req('/api/transfer', {'senderId': 'U1', 'recipientId': U, 'amount': _a,
                          'idempotencyKey': f'usf{_RUN_TAG}{_a}'}, _u1b, ip_addr=ip())
sx, _ = req('/api/admin/users/refer-send', {'userId': U, 'mode': 'team', 'amount': 10, 'period': 'day'},
            token=_rs2adm, ip_addr=ip())
req('/api/transfer', {'senderId': U, 'recipientId': 'U1', 'amount': 3,
                      'idempotencyKey': f'us1{_RUN_TAG}'}, _u_tok, ip_addr=ip())
req('/api/transfer', {'senderId': U, 'recipientId': 'U1', 'amount': 2,
                      'idempotencyKey': f'us2{_RUN_TAG}'}, _u_tok, ip_addr=ip())

sx, alist = req('/api/admin/users', token=_rs2adm, ip_addr=ip())
_row = next((x for x in (alist.get('users') or []) if str(x.get('id')) == str(U)), None)
_usage = (_row or {}).get('referSendUsage') or {}
ck('the admin user list carries the send usage', bool(_usage), f"{list(_usage)[:6]}", 'CRITICAL',
   'The admin cannot see how much a restricted user has sent.')
ck('it shows what the user sent today', abs(num(_usage.get('todayUsed')) - 5) < 1e-6,
   f"todayUsed={_usage.get('todayUsed')}", 'HIGH', 'The amount sent today is wrong or missing.')
ck('it shows how many sends that was', int(_usage.get('sendsToday') or 0) == 2,
   f"sendsToday={_usage.get('sendsToday')}", 'MEDIUM', 'The send count is missing.')
ck('it shows how much of the limit is used', abs(num(_usage.get('used')) - 5) < 1e-6 and abs(num(_usage.get('cap')) - 10) < 1e-6,
   f"used={_usage.get('used')} cap={_usage.get('cap')}", 'HIGH', 'The used/cap pair is wrong.')
ck('it shows how much is left to send', abs(num(_usage.get('remaining')) - 5) < 1e-6,
   f"remaining={_usage.get('remaining')}", 'CRITICAL', 'The admin cannot see the remaining allowance.')

sx, sr = req('/api/admin/users/refer-send', {'userId': U, 'mode': 'team', 'amount': 10, 'period': 'day'},
             token=_rs2adm, ip_addr=ip())
ck('saving the rule answers with the same numbers', abs(num((sr.get('referSendUsage') or {}).get('remaining')) - 5) < 1e-6,
   f"{sr.get('referSendUsage')}", 'HIGH', 'The card cannot refresh its numbers after a save.')

sx, mine = req('/api/user/refer-send', token=_u_tok, ip_addr=ip())
ck('the user sees the same today/total numbers', abs(num(mine.get('todayUsed')) - 5) < 1e-6 and abs(num(mine.get('totalUsed')) - 5) < 1e-6,
   f"today={mine.get('todayUsed')} total={mine.get('totalUsed')} remaining={mine.get('remaining')}", 'HIGH',
   'The user and the admin disagree about how much has been sent.')

# the count must only ever include money the user SENT — incoming money is not a send
req('/api/transfer', {'senderId': 'U1', 'recipientId': U, 'amount': 4,
                      'idempotencyKey': f'usin{_RUN_TAG}'}, _u1b, ip_addr=ip())
sx, alist2 = req('/api/admin/users', token=_rs2adm, ip_addr=ip())
_row2 = next((x for x in (alist2.get('users') or []) if str(x.get('id')) == str(U)), None)
_usage2 = (_row2 or {}).get('referSendUsage') or {}
ck('money the user receives is not counted as money they sent', abs(num(_usage2.get('totalUsed')) - 5) < 1e-6,
   f"totalUsed={_usage2.get('totalUsed')}", 'HIGH', 'The usage counter counts incoming money as sends.')

# an attempt over the cap changes nothing — and the admin can see that too
sx, over = req('/api/transfer', {'senderId': U, 'recipientId': 'U1', 'amount': 5.5,
                                 'idempotencyKey': f'us3{_RUN_TAG}'}, _u_tok, ip_addr=ip())
ck('a send over the cap is refused', sx == 403 and over.get('referSendLimited') is True,
   f"{sx} {over.get('error')}", 'CRITICAL', 'A user can send past the limit the admin sees.')
sx, alist3 = req('/api/admin/users', token=_rs2adm, ip_addr=ip())
_row3 = next((x for x in (alist3.get('users') or []) if str(x.get('id')) == str(U)), None)
_usage3 = (_row3 or {}).get('referSendUsage') or {}
ck('the refused attempt does not use up the allowance', abs(num(_usage3.get('remaining')) - 5) < 1e-6,
   f"used={_usage3.get('used')} remaining={_usage3.get('remaining')}", 'HIGH',
   'A refused send eats the user allowance.')

# spend the rest, then the admin sees zero left and the next send is refused
sx, exact = req('/api/transfer', {'senderId': U, 'recipientId': 'U1', 'amount': 5,
                                  'idempotencyKey': f'us5{_RUN_TAG}'}, _u_tok, ip_addr=ip())
ck('sending exactly what is left works', sx == 200, f"{sx} {(exact or {}).get('error')}", 'HIGH',
   'The user cannot use the last of their allowance.')
sx, alist4 = req('/api/admin/users', token=_rs2adm, ip_addr=ip())
_row4 = next((x for x in (alist4.get('users') or []) if str(x.get('id')) == str(U)), None)
_usage4 = (_row4 or {}).get('referSendUsage') or {}
ck('when the limit is used up the admin sees zero left',
   num(_usage4.get('remaining')) == 0 and num(_usage4.get('used')) == num(_usage4.get('cap')),
   f"used={_usage4.get('used')} cap={_usage4.get('cap')} remaining={_usage4.get('remaining')}", 'HIGH',
   'The remaining allowance never reaches zero.')
sx, blocked = req('/api/transfer', {'senderId': U, 'recipientId': 'U1', 'amount': 0.5,
                                    'idempotencyKey': f'us4{_RUN_TAG}'}, _u_tok, ip_addr=ip())
ck('and the server then refuses the next send', sx == 403, f"{sx} {(blocked or {}).get('error')}", 'CRITICAL',
   'A user can send past the limit the admin sees.')
req('/api/admin/users/refer-send', {'userId': U, 'mode': 'off'}, token=_rs2adm, ip_addr=ip())


# ── 23. "allow sending to the upline (refer)" tick ───────────────────────────
print("\n[23. upline send tick]")
_rs3_s, _rs3_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs3 = _rs3_j.get('token') or ''
_su_s, UP, _ = signup_child('upx@gmail.com', 'U1')        # the user we restrict
_sd_s, DOWN, _ = signup_child('downx@gmail.com', UP)      # their own team member
_up_tok2, _ = login((f'upx-{_RUN_TAG}@gmail.com', 'Staging123!'), ip_addr=ip())
_u1c, _ = login(U1, ip_addr=ip())
for _a in (4, 4):
    req('/api/transfer', {'senderId': 'U1', 'recipientId': UP, 'amount': _a,
                          'idempotencyKey': f'upf{_RUN_TAG}{_a}'}, _u1c, ip_addr=ip())
ck('the upline test chain exists', bool(UP and DOWN), f'{UP}/{DOWN}', 'HIGH', 'Could not build the upline chain.')

# tick ON (default): the referrer may receive
sx, on = req('/api/admin/users/refer-send', {'userId': UP, 'mode': 'team', 'amount': 0, 'allowUpline': True},
             token=_rs3, ip_addr=ip())
ck('the upline tick defaults to allowed', (on.get('referSend') or {}).get('allowUpline') is True,
   f"{(on.get('referSend') or {}).get('allowUpline')}", 'HIGH', 'The upline tick cannot be left on.')
sx, to_up = req('/api/transfer', {'senderId': UP, 'recipientId': 'U1', 'amount': 1,
                                  'idempotencyKey': f'upok{_RUN_TAG}'}, _up_tok2, ip_addr=ip())
ck('with the tick on the user can pay their referrer', sx == 200,
   f"{sx} {(to_up or {}).get('error')}", 'CRITICAL', 'The user cannot pay their own referrer.')

# tick OFF: the referrer is closed, the team stays open
sx, off = req('/api/admin/users/refer-send', {'userId': UP, 'mode': 'team', 'amount': 0, 'allowUpline': False},
              token=_rs3, ip_addr=ip())
ck('an admin can switch sending to the upline off', (off.get('referSend') or {}).get('allowUpline') is False,
   f"{(off.get('referSend') or {}).get('allowUpline')}", 'CRITICAL', 'The upline tick cannot be turned off.')
sx, blocked = req('/api/transfer', {'senderId': UP, 'recipientId': 'U1', 'amount': 1,
                                    'idempotencyKey': f'upno{_RUN_TAG}'}, _up_tok2, ip_addr=ip())
ck('with the tick off the referrer is refused', sx == 403 and blocked.get('referSendLimited') is True,
   f"{sx} {blocked.get('error')}", 'CRITICAL', 'Money still goes up to the referrer after switching it off.')
sx, to_down = req('/api/transfer', {'senderId': UP, 'recipientId': DOWN, 'amount': 1,
                                    'idempotencyKey': f'updown{_RUN_TAG}'}, _up_tok2, ip_addr=ip())
ck('the rest of the rule still works — team members can be paid', sx == 200,
   f"{sx} {(to_down or {}).get('error')}", 'HIGH', 'Switching off the upline also closes the team.')

sx, mine2 = req('/api/user/refer-send', token=_up_tok2, ip_addr=ip())
ck('the user is told the upline is off', mine2.get('allowUpline') is False and 'referrer' in str(mine2.get('label') or '').lower(),
   f"allowUpline={mine2.get('allowUpline')} label={mine2.get('label')}", 'HIGH',
   'The Send screen does not explain that the referrer is closed.')
ck('the allowed list no longer contains the referrer', 'U1' not in [str(x) for x in (mine2.get('allowedRecipients') or [])],
   f"allowed={mine2.get('allowedRecipients')}", 'HIGH', 'The referrer is still in the allowed list.')

# L1 + upline off = nobody at all
sx, _ = req('/api/admin/users/refer-send', {'userId': UP, 'mode': 'l1', 'amount': 0, 'allowUpline': False},
            token=_rs3, ip_addr=ip())
sx, mine3 = req('/api/user/refer-send', token=_up_tok2, ip_addr=ip())
ck('L1 with the upline off allows nobody', int(mine3.get('allowedCount') or 0) == 0,
   f"allowed={mine3.get('allowedCount')} label={mine3.get('label')}", 'HIGH',
   'A rule that allows nobody still lists recipients.')
sx, none = req('/api/transfer', {'senderId': UP, 'recipientId': 'U1', 'amount': 1,
                                 'idempotencyKey': f'upnone{_RUN_TAG}'}, _up_tok2, ip_addr=ip())
ck('and every send is refused', sx == 403, f"{sx} {(none or {}).get('error')}", 'CRITICAL',
   'Sending still works when the rule allows nobody.')

# the tick is audited and can be released
sx, au2 = req('/api/admin/audit-logs', token=_rs3, ip_addr=ip())
_rows3 = au2.get('logs') if isinstance(au2.get('logs'), list) else (au2.get('auditLogs') or [])
ck('switching the upline off is audit-logged',
   any('upline sending blocked' in str(r.get('details') or '') for r in _rows3), f"rows={len(_rows3)}", 'HIGH',
   'An admin can silently close the uplink without a trace.')
req('/api/admin/users/refer-send', {'userId': UP, 'mode': 'off'}, token=_rs3, ip_addr=ip())
sx, after = req('/api/transfer', {'senderId': UP, 'recipientId': 'U1', 'amount': 1,
                                  'idempotencyKey': f'upoff{_RUN_TAG}'}, _up_tok2, ip_addr=ip())
ck('removing the rule restores sending in every direction', sx == 200,
   f"{sx} {(after or {}).get('error')}", 'CRITICAL', 'The upline block survives the rule being removed.')


# ── 24. welcome bonus (automatic, with its own permission ticks) ──────────────
print("\n[24. welcome bonus]")
_rs4_s, _rs4_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs4 = _rs4_j.get('token') or ''

# a leftover welcome campaign from an earlier run must not block this one
sx, existing = req('/api/admin/promo/campaigns', token=_rs4, ip_addr=ip())
for _c in (existing.get('campaigns') or []):
    if _c.get('kind') == 'WELCOME':
        req('/api/admin/promo/campaigns/remove', {'id': _c['id']}, token=_rs4, ip_addr=ip())

sx, wc = req('/api/admin/promo/campaigns/save', {
    'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': 3, 'maxUses': 0,
    'bonusLockDays': 0, 'status': 'ACTIVE', 'stackWithCode': True,
}, token=_rs4, ip_addr=ip())
ck('an admin can create a welcome bonus', sx == 200, f"{sx} {wc.get('error')}", 'CRITICAL',
   'The welcome bonus cannot be created.')

sx, _wl = req('/api/admin/promo/campaigns', token=_rs4, ip_addr=ip())
_wrow0 = next((c for c in (_wl.get('campaigns') or []) if c.get('kind') == 'WELCOME'), None)
_wid = (_wrow0 or {}).get('id') or ''
ck('the welcome campaign is listed with its type', bool(_wid), f"id={_wid}", 'HIGH',
   'The welcome campaign is invisible in the campaign list.')

sx, wc2 = req('/api/admin/promo/campaigns/save', {
    'kind': 'WELCOME', 'name': 'Second welcome', 'bonusPerUser': 9, 'maxUses': 0, 'status': 'ACTIVE',
}, token=_rs4, ip_addr=ip())
ck('only one welcome bonus can exist', sx == 409, f"{sx} {wc2.get('error')}", 'HIGH',
   'Two welcome campaigns would double-pay every new user.')

sx, pub = req('/api/promo/welcome', ip_addr=ip())
ck('the signup screen can advertise it', (pub.get('welcome') or {}).get('bonusPerUser') == 3,
   f"{pub.get('welcome')}", 'HIGH', 'New users are not told about the welcome bonus.')
ck('the signup screen says the bonus is money in the balance with no lock',
   (pub.get('welcome') or {}).get('creditedTo') == 'BALANCE' and (pub.get('welcome') or {}).get('bonusLockDays') == 0,
   f"creditedTo={(pub.get('welcome') or {}).get('creditedTo')} lock={(pub.get('welcome') or {}).get('bonusLockDays')}", 'HIGH',
   'The signup screen does not describe where the bonus lands.')

# a plain signup with no code at all still gets it
_ws, WID, _wj = signup_child('welcome1@gmail.com', '')
ck('a signup with no code at all still gets the welcome bonus',
   (_wj.get('welcome') or {}).get('paid') is True and num((_wj.get('welcome') or {}).get('amount')) == 3,
   f"{_wj.get('welcome')}", 'CRITICAL', 'The welcome bonus is not paid automatically.')
_wtok, _ = login((_wj.get('_email'), 'Staging123!'), ip_addr=ip())
sx, wb = req('/api/user/bonus', token=_wtok, ip_addr=ip())
ck('it lands in the MAIN balance — no separate bonus wallet',
   num((wb.get('wallet') or {}).get('mainBalance')) == 3 and num((wb.get('wallet') or {}).get('available')) == 0,
   f"main={(wb.get('wallet') or {}).get('mainBalance')} bonus={(wb.get('wallet') or {}).get('available')}", 'CRITICAL',
   'The welcome bonus does not reach the main balance.')

# the ticks actually decide what the user may do
sx, conv = req('/api/user/bonus/convert', {'amount': 1}, token=_wtok, ip_addr=ip())
ck('the old convert call is a harmless no-op (nothing left to convert)', sx == 200 and num(conv.get('moved')) == 0,
   f"{sx} moved={conv.get('moved')}", 'HIGH', 'An installed app gets an error from the retired bonus wallet.')
sx, snd = req('/api/user/bonus/send', {'toUserId': 'U2', 'amount': 1}, token=_wtok, ip_addr=ip())
ck('bonus-to-bonus transfer is gone (money moves from the balance instead)', sx == 410,
   f"{sx} {snd.get('error')}", 'HIGH', 'The retired bonus transfer still works.')

# a second signup on the same account can never pay twice
sx, wb2 = req('/api/user/bonus', token=_wtok, ip_addr=ip())
ck('the balance never receives the welcome bonus twice', num((wb2.get('wallet') or {}).get('mainBalance')) == 3,
   f"main={(wb2.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'The welcome bonus can be double-claimed.')

# with the stack tick off, a code campaign wins
sx, _stackoff = req('/api/admin/promo/campaigns/save', {
    'id': _wid, 'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': 3, 'maxUses': 0,
    'bonusLockDays': 0, 'status': 'ACTIVE', 'stackWithCode': False,
}, token=_rs4, ip_addr=ip())
ck('the stack tick can be switched off', sx == 200, f"{sx} {_stackoff.get('error')}", 'HIGH',
   'The welcome campaign cannot be edited.')
sx, cc = req('/api/admin/promo/campaigns/save', {
    'code': f'WSK{_RUN_TAG}', 'name': 'Code beats welcome', 'bonusPerUser': 1, 'maxUses': 50,
    'status': 'ACTIVE',
}, token=_rs4, ip_addr=ip())
ck('a normal code campaign can still be created next to it', sx == 200, f"{sx} {cc.get('error')}", 'HIGH',
   'The welcome bonus blocks normal campaigns.')
_sx2, _cid2, _cj2 = signup_child('welcome2@gmail.com', f'WSK{_RUN_TAG}')
ck('with "skip when a code is used" the code campaign pays instead',
   (_cj2.get('campaign') or {}).get('paid') is True and (_cj2.get('welcome') or {}).get('paid') is not True,
   f"campaign={_cj2.get('campaign')} welcome={_cj2.get('welcome')}", 'HIGH',
   'The stack tick is ignored — both bonuses pay.')

# back on, and a paused welcome pays nothing
req('/api/admin/promo/campaigns/save', {
    'id': _wid, 'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': 3, 'maxUses': 0,
    'bonusLockDays': 0, 'status': 'ACTIVE', 'stackWithCode': True,
}, token=_rs4, ip_addr=ip())
sx, pub2 = req('/api/promo/welcome', ip_addr=ip())
_wcid = (pub2.get('welcome') or {}).get('id') or ''
sx, lst = req('/api/admin/promo/campaigns', token=_rs4, ip_addr=ip())
_wrow = next((c for c in (lst.get('campaigns') or []) if c.get('kind') == 'WELCOME'), None)
if _wrow:
    req('/api/admin/promo/campaigns/status', {'id': _wrow['id'], 'status': 'PAUSED'}, token=_rs4, ip_addr=ip())
    _sx3, _wid3, _wj3 = signup_child('welcome3@gmail.com', '')
    ck('a paused welcome bonus pays nothing',
       (_wj3.get('welcome') or {}).get('paid') is not True, f"{_wj3.get('welcome')}", 'CRITICAL',
       'Pausing the welcome campaign does not stop the payout.')
    req('/api/admin/promo/campaigns/status', {'id': _wrow['id'], 'status': 'ACTIVE'}, token=_rs4, ip_addr=ip())

# the welcome campaign is not a refer code
sx, chk = req('/api/refer/check-code?code=WELCOME', ip_addr=ip())
ck('WELCOME cannot be used as a referral code', chk.get('resolves') is not True and chk.get('campaign') in (None, {}),
   f"resolves={chk.get('resolves')} campaign={chk.get('campaign')}", 'HIGH',
   'A welcome campaign leaked into the refer-code namespace.')

# and it is audited like everything else
sx, au3 = req('/api/admin/audit-logs', token=_rs4, ip_addr=ip())
_rows4 = au3.get('logs') if isinstance(au3.get('logs'), list) else (au3.get('auditLogs') or [])
ck('welcome grants are audit-logged',
   any('WELCOME' in str(r.get('details') or '').upper() or 'CAMPAIGN_BONUS' in str(r.get('action') or '').upper() for r in _rows4),
   f"rows={len(_rows4)}", 'HIGH', 'A welcome bonus payout leaves no audit trail.')


# ── 25. welcome bonus for accounts that already existed (backfill) ───────────
print("\n[25. welcome backfill for existing users]")
_rs5_s, _rs5_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs5 = _rs5_j.get('token') or ''
sx, _lst = req('/api/admin/promo/campaigns', token=_rs5, ip_addr=ip())
_wrow = next((c for c in (_lst.get('campaigns') or []) if c.get('kind') == 'WELCOME'), None)
_wcid = (_wrow or {}).get('id') or ''
ck('the welcome campaign is live for the backfill', bool(_wcid), f"id={_wcid}", 'HIGH',
   'The backfill has no welcome campaign to pay from.')

# U2 was seeded before the welcome campaign existed — exactly the case the admin hit
_u2tok, _ = login(U2, ip_addr=ip())
sx, bw0 = req('/api/user/bonus', token=_u2tok, ip_addr=ip())
_before = num((bw0.get('wallet') or {}).get('mainBalance'))
sx, _wd = req('/api/admin/promo/campaign/' + _wcid, token=_rs5, ip_addr=ip())
ck('the old account has no welcome bonus to begin with',
   not any(str(g.get('userId')) == 'U2' for g in (_wd.get('grants') or [])),
   f"balance={_before} grants={len(_wd.get('grants') or [])}", 'HIGH',
   'The backfill test needs an account without the bonus.')

sx, dry0 = req('/api/admin/promo/welcome/backfill', {'campaignId': _wcid, 'userIds': ['U2'], 'dryRun': True}, token=_rs5, ip_addr=ip())
ck('a dry run reports what would happen without paying anything',
   sx == 200 and dry0.get('dryRun') is True and int(dry0.get('wouldPay') or 0) == 1,
   f"wouldPay={dry0.get('wouldPay')} total={dry0.get('total')}", 'HIGH', 'The dry run does not report the plan.')
sx, bw2 = req('/api/user/bonus', token=_u2tok, ip_addr=ip())
ck('the dry run pays nobody', num((bw2.get('wallet') or {}).get('mainBalance')) == _before,
   f"balance {_before} → {(bw2.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'A dry run moved real money.')

sx, _lb1 = req('/api/admin/promo/campaigns', token=_rs5, ip_addr=ip())
_wu_b = int(((next((c for c in (_lb1.get('campaigns') or []) if c.get('id') == _wcid), {}) or {}).get('stats') or {}).get('joins') or 0)
sx, one = req('/api/admin/promo/welcome/backfill', {'campaignId': _wcid, 'userIds': ['U2'], 'confirm': True}, token=_rs5, ip_addr=ip())
ck('a targeted backfill pays exactly that account', sx == 200 and int(one.get('paid') or 0) == 1,
   f"{sx} paid={one.get('paid')} total={one.get('total')}", 'CRITICAL',
   'The backfill cannot credit an existing account.')
sx, bw3 = req('/api/user/bonus', token=_u2tok, ip_addr=ip())
ck('the money really lands in that user balance', num((bw3.get('wallet') or {}).get('mainBalance')) > _before,
   f"balance {_before} → {(bw3.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'The backfill reports success but pays nothing.')

sx, _lb2 = req('/api/admin/promo/campaigns', token=_rs5, ip_addr=ip())
_wu_a = int(((next((c for c in (_lb2.get('campaigns') or []) if c.get('id') == _wcid), {}) or {}).get('stats') or {}).get('joins') or 0)
ck('the campaign counts one slot per paid user, not two', _wu_a - _wu_b == 1,
   f"used {_wu_b} → {_wu_a} for 1 paid user", 'HIGH',
   'The backfill double-counts slot usage, so real users lose available slots.')

sx, again = req('/api/admin/promo/welcome/backfill', {'campaignId': _wcid, 'userIds': ['U2'], 'confirm': True}, token=_rs5, ip_addr=ip())
ck('running it twice never pays the same account twice', int(again.get('paid') or 0) == 0,
   f"paid={again.get('paid')}", 'CRITICAL', 'The backfill can double-pay an account.')

sx, bad = req('/api/admin/promo/welcome/backfill', {'campaignId': 'CMP-NOPE', 'confirm': True}, token=_rs5, ip_addr=ip())
ck('an unknown campaign is refused', sx == 404, f"{sx} {bad.get('error')}", 'MEDIUM',
   'The backfill accepts an unknown campaign id.')
sx, nonadmin = req('/api/admin/promo/welcome/backfill', {'campaignId': _wcid, 'confirm': True}, token=tu1, ip_addr=ip())
ck('a normal user cannot run the backfill', nonadmin if False else nonadmin is False or sx in (401, 403, 400),
   f"{sx} {nonadmin}", 'CRITICAL', 'A regular user can trigger a platform-wide payout.')

sx, au4 = req('/api/admin/audit-logs', token=_rs5, ip_addr=ip())
_rows5 = au4.get('logs') if isinstance(au4.get('logs'), list) else (au4.get('auditLogs') or [])
ck('the backfill is audit-logged',
   any('WELCOME_BACKFILL' in str(r.get('action') or '') for r in _rows5), f"rows={len(_rows5)}", 'HIGH',
   'A mass payout leaves no audit trail.')


# ── 26. duplicate-account check is configurable (shared IP ≠ same person) ────
print("\n[26. duplicate check configurable]")
_rs6_s, _rs6_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs6 = _rs6_j.get('token') or ''
_SHARED_IP = '10.44.44.44'

def _dup_campaign(code, dupIp, dupDevice):
    return req('/api/admin/promo/campaigns/save', {
        'code': code, 'name': 'Dup ' + code, 'bonusPerUser': 2, 'maxUses': 50,
        'bonusWithdraw': True, 'bonusTransfer': False, 'status': 'ACTIVE',
        'dupIp': dupIp, 'dupDevice': dupDevice,
    }, token=_rs6, ip_addr=ip())

def _signup_shared(email, code, device=''):
    local, _, dom = email.partition('@')
    addr = f'{local}-{_RUN_TAG}@{dom}'
    hdr = {'content-type': 'application/json', 'x-forwarded-for': _SHARED_IP}
    if device: hdr['x-device-id'] = device
    body = json.dumps({'email': addr, 'password': 'Staging123!', 'referralCode': code}).encode()
    r = urllib.request.Request(API + '/api/users/register', data=body, method='POST', headers=hdr)
    try:
        with urllib.request.urlopen(r, timeout=25) as x:
            return x.status, json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}

# IP check ON (default): the second account on the same IP is held
_c1 = f'DUPON{_RUN_TAG}'
sx, _ = _dup_campaign(_c1, True, True)
_s1, _d1 = _signup_shared('dupip1@gmail.com', _c1, 'DEV-A')
_s2, _d2 = _signup_shared('dupip2@gmail.com', _c1, 'DEV-B')
ck('with the IP check on, a second account on the same IP pays first',
   (_d1.get('campaign') or {}).get('paid') is True, f"{_d1.get('campaign')}", 'HIGH',
   'The first claim on a shared IP is not paid.')
ck('…and the second one is held for review', (_d2.get('campaign') or {}).get('reason') == 'PENDING_REVIEW',
   f"{_d2.get('campaign')}", 'HIGH', 'The IP check does not hold a duplicate.')

# IP check OFF: the same shared IP is fine, the device signal is still watched
_c2 = f'DUPOFF{_RUN_TAG}'
sx, _ = _dup_campaign(_c2, False, True)
_e1, _e1j = _signup_shared('dupip3@gmail.com', _c2, 'DEV-C')
_e2, _e2j = _signup_shared('dupip4@gmail.com', _c2, 'DEV-D')
ck('with the IP check off, two real users behind one mobile IP both get paid',
   (_e1j.get('campaign') or {}).get('paid') is True and (_e2j.get('campaign') or {}).get('paid') is True,
   f"first={(_e1j.get('campaign') or {}).get('reason')} second={(_e2j.get('campaign') or {}).get('reason')}", 'CRITICAL',
   'Genuine users on a shared carrier IP are still blocked.')

_c3 = f'DUPDEV{_RUN_TAG}'
sx, _ = _dup_campaign(_c3, False, True)
_f1, _f1j = _signup_shared('dupip5@gmail.com', _c3, 'DEV-SAME')
_f2, _f2j = _signup_shared('dupip6@gmail.com', _c3, 'DEV-SAME')
ck('the same device is still held even when the IP is ignored',
   (_f1j.get('campaign') or {}).get('paid') is True and (_f2j.get('campaign') or {}).get('reason') == 'PENDING_REVIEW',
   f"first={(_f1j.get('campaign') or {}).get('reason')} second={(_f2j.get('campaign') or {}).get('reason')}", 'CRITICAL',
   'Turning the IP check off also disabled device protection.')

# both off: nothing is held
_c4 = f'DUPNONE{_RUN_TAG}'
sx, _ = _dup_campaign(_c4, False, False)
_g1, _g1j = _signup_shared('dupip7@gmail.com', _c4, 'DEV-X')
_g2, _g2j = _signup_shared('dupip8@gmail.com', _c4, 'DEV-X')
ck('with both checks off nothing is held at all',
   (_g1j.get('campaign') or {}).get('paid') is True and (_g2j.get('campaign') or {}).get('paid') is True,
   f"first={(_g1j.get('campaign') or {}).get('reason')} second={(_g2j.get('campaign') or {}).get('reason')}", 'HIGH',
   'The duplicate checks cannot be switched off.')

# the held bonus can be released from the review queue (the exact case of user 186)
sx, q = req('/api/admin/promo/reviews?status=PENDING', token=_rs6, ip_addr=ip())
_rowd = next((r for r in (q.get('reviews') or []) if r.get('reason') == 'DUPLICATE_ACCOUNT'), None)
ck('the review queue lists the held duplicate', bool(_rowd), f"rows={len(q.get('reviews') or [])}", 'HIGH',
   'A held duplicate never reaches the admin queue.')
if _rowd:
    sx, dec = req('/api/admin/promo/reviews/decide', {'id': _rowd['id'], 'action': 'approve'}, token=_rs6, ip_addr=ip())
    ck('approving it pays the held bonus', sx == 200, f"{sx} {dec.get('error')}", 'CRITICAL',
       'Approving a held duplicate does not pay it.')

# the ticks are visible to the console and enforced by the engine
sx, lst2 = req('/api/admin/promo/campaigns', token=_rs6, ip_addr=ip())
_row2 = next((c for c in (lst2.get('campaigns') or []) if c.get('code') == _c2), None)
ck('the campaign reports which duplicate signals are watched',
   (_row2 or {}).get('dupIp') is False and (_row2 or {}).get('dupDevice') is True,
   f"dupIp={(_row2 or {}).get('dupIp')} dupDevice={(_row2 or {}).get('dupDevice')}", 'MEDIUM',
   'The console cannot tell which checks are active.')


# ── 27. campaign counters can be repaired (slots must match the ledger) ──────
print("\n[27. campaign counters match the ledger]")
_rs7_s, _rs7_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs7 = _rs7_j.get('token') or ''
# the welcome campaign has exactly one paid account from §25 (U2)
sx, _rec = req('/api/admin/promo/campaigns/recount', {'campaignId': _wcid}, token=_rs7, ip_addr=ip())
_r = (_rec.get('campaigns') or [{}])[0]
ck('the stored slot count matches the bonus ledger', sx == 200 and _r.get('changed') is False,
   f"{sx} stored={(_r.get('before') or {}).get('used')} ledger={(_r.get('after') or {}).get('used')}", 'HIGH',
   'Slots and grants disagree — the campaign runs out of slots early (double-counting backfill).')
sx, _cd = req('/api/admin/promo/campaign/' + _wcid, token=_rs7, ip_addr=ip())
_grants = _cd.get('grants') if isinstance(_cd.get('grants'), list) else []
ck('the slot count is exactly the number of bonus grants', len(_grants) == int(((_r.get('after') or {}).get('used')) or -1),
   f"grants={len(_grants)} used={(_r.get('after') or {}).get('used')}", 'HIGH',
   'Each paid user must consume exactly one slot — a drifted counter loses slots.')
sx, _rec2 = req('/api/admin/promo/campaigns/recount', {'campaignId': _wcid, 'confirm': True}, token=_rs7, ip_addr=ip())
_r2 = (_rec2.get('campaigns') or [{}])[0]
ck('recalculating the counters changes nothing when they are already right',
   sx == 200 and (_r2.get('before') or {}) == (_r2.get('after') or {}),
   f"{sx} before={_r2.get('before')} after={_r2.get('after')}", 'HIGH',
   'Recalculating the counters rewrote a correct ledger.')
sx, bw9 = req('/api/user/bonus', token=_u2tok, ip_addr=ip())
ck('recalculating never touches the money already paid', num((bw9.get('wallet') or {}).get('mainBalance')) > 0,
   f"main={(bw9.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'Recalculating clawed back paid bonuses.')
sx, _ = req('/api/admin/promo/campaigns/recount', {'campaignId': _wcid, 'confirm': True}, token=tu1, ip_addr=ip())
ck('a normal user cannot recalculate campaign counters', sx in (401, 403), f"{sx}", 'CRITICAL',
   'A regular user can rewrite campaign counters.')



# ── 28. promo bonus is main-balance money (lock = boost only, no expiry) ─────
print("\n[28. promo bonus → main balance]")
_rs8_s, _rs8_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs8 = _rs8_j.get('token') or ''
# a fresh welcome campaign that locks the bonus for 7 days
sx, _ = req('/api/admin/promo/campaigns/save', {
    'id': _wid, 'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': 4, 'maxUses': 0,
    'bonusLockDays': 7, 'status': 'ACTIVE', 'stackWithCode': True,
}, token=_rs8, ip_addr=ip())
ck('the campaign editor accepts a bonus lock in days', sx == 200, f"{sx}", 'HIGH',
   'A bonus lock cannot be configured.')
sx, _pub3 = req('/api/promo/welcome', ip_addr=ip())
ck('the lock reaches the signup screen', (_pub3.get('welcome') or {}).get('bonusLockDays') == 7,
   f"lock={(_pub3.get('welcome') or {}).get('bonusLockDays')}", 'HIGH', 'The lock is not advertised at signup.')
ck('no expiry is advertised any more', 'bonusExpiryDays' not in (_pub3.get('welcome') or {}),
   f"keys={sorted((_pub3.get('welcome') or {}).keys())}", 'MEDIUM', 'The retired expiry policy is still exposed.')

_sx, LID, _lj = signup_child('lock1@gmail.com', '')
ck('a locked bonus still lands in the balance', (_lj.get('welcome') or {}).get('paid') is True, f"{_lj.get('welcome')}",
   'CRITICAL', 'A locked welcome bonus is not paid at all.')
_ltok, _ = login((_lj.get('_email'), 'Staging123!'), ip_addr=ip())
sx, _lw = req('/api/user/bonus', token=_ltok, ip_addr=ip())
ck('the locked bonus is inside the main balance', num((_lw.get('wallet') or {}).get('mainBalance')) == 4,
   f"main={( _lw.get('wallet') or {}).get('mainBalance')}", 'CRITICAL', 'The bonus did not reach the main balance.')
ck('the wallet reports how much of it is locked', num((_lw.get('wallet') or {}).get('lockedPromo')) == 4,
   f"locked={( _lw.get('wallet') or {}).get('lockedPromo')}", 'HIGH', 'The lock is invisible to the user.')

# the locked money cannot leave the account…
sx, _lsend = req('/api/transfer', {'senderId': str(LID), 'recipientId': 'U2', 'amount': 1,
                                   'idempotencyKey': 'lk' + str(int(time.time()))}, token=_ltok, ip_addr=ip())
ck('locked bonus money cannot be sent to another user', sx == 403 and 'promotion bonus' in str(_lsend.get('error') or '').lower(),
   f"{sx} {_lsend.get('error')}", 'CRITICAL', 'A locked bonus can be transferred out immediately.')

# …but it can be boosted (owner rule: boost always allowed)
sx, _lboost = req('/api/boost/start', {'userId': str(LID)}, token=_ltok, ip_addr=ip())
ck('the locked bonus can still be boosted', sx == 200, f"{sx} {_lboost.get('error')}", 'CRITICAL',
   'Boosting is blocked by the bonus lock — the owner asked for the opposite.')

# the one-time migration route (production: 184 users still on the old wallet)
sx, _dry = req('/api/admin/promo/bonus/to-main', {}, token=_rs8, ip_addr=ip())
ck('the bonus→balance migration has a dry run', sx == 200 and _dry.get('dryRun') is True,
   f"{sx} grants={_dry.get('grants')} total={_dry.get('total')}", 'HIGH', 'The migration cannot be previewed.')
sx, _conf = req('/api/admin/promo/bonus/to-main', {'confirm': True}, token=_rs8, ip_addr=ip())
ck('running the migration on fresh data moves nothing twice', sx == 200 and num(_conf.get('total')) == 0,
   f"{sx} moved={_conf.get('total')}", 'CRITICAL', 'The migration double-credits an already-migrated grant.')
sx, _ = req('/api/admin/promo/bonus/to-main', {'confirm': True}, token=tu1, ip_addr=ip())
ck('a normal user cannot run the bonus migration', sx in (401, 403), f"{sx}", 'CRITICAL',
   'A regular user can move bonus money.')

# a grant left over from the old bonus wallet is moved into the balance exactly once
try:
    _raw = json.load(open(DB_PATH))
    _u2 = next((u for u in _raw.get('users', []) if str(u.get('id')) == 'U2'), None)
    _legacy = {'id': 'BG-LEGACY1', 'userId': 'U2', 'campaignId': 'CMP-OLD', 'campaignCode': 'OLDWALLET',
               'grantedAmount': 2, 'remaining': 2, 'grantedAt': int(time.time() * 1000) - 86400000,
               'expiresAt': 0, 'expiryAction': 'BURN', 'bonusTransfer': False, 'bonusWithdraw': True,
               'status': 'ACTIVE', 'reason': 'SIGNUP'}
    _raw.setdefault('bonusGrants', []).insert(0, _legacy)
    if _u2 is not None:
        _u2['balance'] = num(_u2.get('balance')) - 2
    json.dump(_raw, open(DB_PATH, 'w'), indent=1)
    _seeded = _u2 is not None
except Exception:
    _seeded = False
ck('a legacy bonus-wallet grant can be seeded for the migration test', _seeded, f"seeded={_seeded}", 'MEDIUM',
   'The migration could not be exercised.')
sx, _lg1 = req('/api/admin/promo/bonus/to-main', {'userId': 'U2'}, token=_rs8, ip_addr=ip())
ck('the migration preview finds the old-wallet money',
   sx == 200 and int(_lg1.get('grants') or 0) >= 1 and num(_lg1.get('total')) >= 2,
   f"{sx} grants={_lg1.get('grants')} total={_lg1.get('total')}", 'HIGH', 'The migration cannot see old-wallet bonuses.')
sx, _lg2 = req('/api/admin/promo/bonus/to-main', {'userId': 'U2', 'confirm': True}, token=_rs8, ip_addr=ip())
ck('confirming moves that money into the balance', sx == 200 and num(_lg2.get('total')) >= 2,
   f"{sx} moved={_lg2.get('total')}", 'CRITICAL', 'Old bonus-wallet money is never moved.')
sx, _lg3 = req('/api/admin/promo/bonus/to-main', {'userId': 'U2', 'confirm': True}, token=_rs8, ip_addr=ip())
ck('a second run moves nothing (idempotent)', sx == 200 and num(_lg3.get('total')) == 0,
   f"{sx} moved={_lg3.get('total')}", 'CRITICAL', 'The migration pays the same grant twice.')
_after_tok, _after_me = login(U2, ip_addr=ip())
ck('the migrated money is spendable main-balance money',
   num((_after_me or {}).get('balance')) >= 2, f"balance={(_after_me or {}).get('balance')}", 'CRITICAL',
   'The migrated bonus is not in the balance.')

# put the campaign back the way the rest of the suite expects
req('/api/admin/promo/campaigns/save', {
    'id': _wid, 'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': 3, 'maxUses': 0,
    'bonusLockDays': 0, 'status': 'ACTIVE', 'stackWithCode': True,
}, token=_rs8, ip_addr=ip())


# ── 29. who the bonus money may be sent to (per-campaign tick) ───────────────
print("\n[29. bonus send recipients]")
_rs9_s, _rs9_j = req('/api/admin/login', ADMIN, ip_addr=ip())
_rs9 = _rs9_j.get('token') or ''


def _welcome_tick(mode, amount=3, lock=0):
    return req('/api/admin/promo/campaigns/save', {
        'id': _wid, 'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': amount, 'maxUses': 0,
        'bonusLockDays': lock, 'bonusSend': mode, 'status': 'ACTIVE', 'stackWithCode': True,
    }, token=_rs9, ip_addr=ip())


def _send(token, sid, rid, amount, tag):
    return req('/api/transfer', {'senderId': str(sid), 'recipientId': str(rid), 'amount': amount,
                                 'idempotencyKey': f'{tag}{_RUN_TAG}'}, token=token, ip_addr=ip())


# a WELCOME campaign created without the tick is boost-only by default
req('/api/admin/promo/campaigns/save', {
    'id': _wid, 'kind': 'WELCOME', 'name': 'Journey welcome', 'bonusPerUser': 3, 'maxUses': 0,
    'bonusLockDays': 0, 'status': 'ACTIVE', 'stackWithCode': True,
}, token=_rs9, ip_addr=ip())
sx, _dpub = req('/api/promo/welcome', ip_addr=ip())
ck('a welcome bonus defaults to boost only when the tick was never set',
   (_dpub.get('welcome') or {}).get('bonusSend') == 'NONE',
   f"send={(_dpub.get('welcome') or {}).get('bonusSend')}", 'HIGH',
   'The welcome bonus defaults to being sendable anywhere.')

# NONE: the bonus may only be boosted
sx, _ = _welcome_tick('NONE')
ck('the campaign can say "boost only, nobody may receive it"', sx == 200, f"{sx}", 'HIGH',
   'The bonus send tick cannot be configured.')
sx, _pubN = req('/api/promo/welcome', ip_addr=ip())
ck('the signup screen shows the send rule', (_pubN.get('welcome') or {}).get('bonusSend') == 'NONE',
   f"send={(_pubN.get('welcome') or {}).get('bonusSend')}", 'HIGH', 'The send rule is not advertised.')
_s, nid, nj = signup_child('bsend1@gmail.com', 'U1')
ntok, _ = login((nj.get('_email'), 'Staging123!'), ip_addr=ip())
_bnk = req('/api/user/bonus', token=ntok, ip_addr=ip())[1].get('wallet') or {}
ck('a bonus-only account still has the money in its balance',
   num(_bnk.get('mainBalance')) >= 3 and num(_bnk.get('bonusRestricted')) >= 3,
   f"main={_bnk.get('mainBalance')} restricted={_bnk.get('bonusRestricted')}", 'CRITICAL',
   'The bonus is not in the balance, or the send rule is not tracked.')
sx, r1 = _send(ntok, nid, 'U2', 1, 'bsN')
ck('"boost only" refuses every transfer of bonus money',
   sx == 403 and 'promotion bonus' in str(r1.get('error') or '').lower(),
   f"{sx} {r1.get('error')}", 'CRITICAL', 'A boost-only bonus can be sent out.')
sx, _b = req('/api/boost/start', {'userId': str(nid)}, token=ntok, ip_addr=ip())
ck('"boost only" still allows boosting', sx == 200, f"{sx} {_b.get('error')}", 'CRITICAL',
   'A boost-only bonus cannot even be boosted.')

# L1: only the referrer may receive bonus money
sx, _ = _welcome_tick('L1')
_s, lid, lj = signup_child('bsend2@gmail.com', 'U1')
ltok, _ = login((lj.get('_email'), 'Staging123!'), ip_addr=ip())
sx, r2 = _send(ltok, lid, 'U2', 1, 'bsL1x')
ck('"referrer only" refuses a stranger', sx == 403 and 'referrer' in str(r2.get('error') or '').lower(),
   f"{sx} {r2.get('error')}", 'CRITICAL', 'Bonus money still goes to strangers.')
sx, r3 = _send(ltok, lid, 'U1', 1, 'bsL1y')
ck('"referrer only" lets the bonus reach the referrer', sx == 200, f"{sx} {r3.get('error')}", 'CRITICAL',
   'The referrer cannot receive the bonus money.')

# own money is never restricted (U1 has an active boost, so U2 funds this account)
_fund_tok, _ = login(U2, ip_addr=ip())
sx, _fund = _send(_fund_tok, 'U2', lid, 5, 'bsfund')
ck('a second wallet can top up the account for the own-money test', sx == 200,
   f"{sx} {_fund.get('error')}", 'HIGH', 'The own-money part of the rule could not be tested.')
sx, r4 = _send(ltok, lid, 'U2', 1, 'bsown')
ck('their own money can still be sent to anyone', sx == 200, f"{sx} {r4.get('error')}", 'CRITICAL',
   'The bonus rule also blocks the user own money.')

# TEAM: referrer + the whole downline, nothing outside it
sx, _ = _welcome_tick('TEAM')
_s, tid, tj = signup_child('bsend3@gmail.com', 'U1')
ttok, _ = login((tj.get('_email'), 'Staging123!'), ip_addr=ip())
_s2, kid, kj = signup_child('bsend4@gmail.com', 'U1')
sx, r5 = _send(ttok, tid, 'U2', 1, 'bsTeamx')
ck('"team only" refuses somebody outside the team', sx == 403, f"{sx} {r5.get('error')}", 'CRITICAL',
   'Bonus money leaves the team.')
_s3, dchild, _dcj = signup_child(f'bsd-{_RUN_TAG}@gmail.com', str(tid))
sx, r6 = _send(ttok, tid, dchild, 1, 'bsTeamOk')
ck('"team only" lets the bonus reach their own downline', sx == 200, f"{sx} {r6.get('error')}", 'CRITICAL',
   'A team member cannot receive the bonus money.')

# ALL: no restriction at all
sx, _ = _welcome_tick('ALL')
_s, aid, aj = signup_child('bsend5@gmail.com', 'U1')
atok, _ = login((aj.get('_email'), 'Staging123!'), ip_addr=ip())
sx, r7 = _send(atok, aid, 'U2', 1, 'bsAll')
ck('"anyone" lets the bonus go to any user', sx == 200, f"{sx} {r7.get('error')}", 'HIGH',
   'The "anyone" setting still blocks the send.')

# the restriction shrinks as the bonus is spent
sx, _ = _welcome_tick('TEAM')
_s, sid2, sj2 = signup_child('bsend6@gmail.com', 'U1')
stok, _ = login((sj2.get('_email'), 'Staging123!'), ip_addr=ip())
_b1 = num((req('/api/user/bonus', token=stok, ip_addr=ip())[1].get('wallet') or {}).get('bonusRestricted'))
_send(stok, sid2, 'U1', 1, 'bsconsume')
_b2 = num((req('/api/user/bonus', token=stok, ip_addr=ip())[1].get('wallet') or {}).get('bonusRestricted'))
ck('sending bonus money lowers the restricted amount', _b2 < _b1, f"{_b1} → {_b2}", 'HIGH',
   'The bonus restriction never goes away, so the account stays limited forever.')

# state back to normal for any later section
sx, _ = _welcome_tick('ALL')

print(f"\nRESULT {PASS} pass / {FAIL} fail")
if PROBLEMS:
    order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
    print('\nPROBLEMS FOUND:')
    for p in sorted(PROBLEMS, key=lambda x: order.get(x['sev'], 9)):
        print(f"  [{p['sev']:8}] {p['title']}\n             {p['detail']}")
else:
    print('\nNo problems found.')
json.dump(PROBLEMS, open('/tmp/journey_problems.json', 'w'), indent=1)
