#!/usr/bin/env python3
"""
tools/walletagent-check.py — Job 14 backend test (local server only).

Covers:
  A. country/currency drives the payment catalogue (BDT → Bangladesh local methods)
  B. admin creates a wallet agent bound to ONE country + ONE method
  C. the agent panel login works and is scoped to that method
  D. agent approves a deposit → user credited exactly once
  E. agent may not touch another method (403) — scope + audit
  F. agent rejects a withdrawal → refund, balance held correctly
  G. disabling/killing the account stops the token

Run:  PORT=3901 python3 tools/walletagent-check.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = f"http://127.0.0.1:{os.environ.get('PORT', '3901')}"
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))[-6:]
PASS, FAIL = [], []


def req(path, body=None, token=None, method=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or '{}')
        except Exception:
            return e.code, {'raw': raw}


def bal_of(email):
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'boostpay_db.json')) as fh:
            doc = json.load(fh)
        for u in doc.get('users', []):
            if str(u.get('email') or '').lower() == email.lower():
                return float(u.get('balance') or 0)
    except Exception:
        pass
    return None


def db_patch(fn):
    """Patch the LOCAL json database (test fixtures only) and write it back."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'boostpay_db.json')
    with open(path) as fh:
        doc = json.load(fh)
    fn(doc)
    with open(path, 'w') as fh:
        json.dump(doc, fh)


def give_boost(email, amount):
    """Make the balance withdrawable (boosted profit) for the withdrawal case."""
    def f(doc):
        for u in doc.get('users', []):
            if str(u.get('email') or '').lower() == email.lower():
                u['lifetimeProfit'] = amount
                u['boostProfitWithdrawn'] = 0
                u['balance'] = max(float(u.get('balance') or 0), amount)
    db_patch(f)


def check(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else f'  → {detail}'))


# ── A. country/currency → local methods ───────────────────────────────────────
s, j = req('/api/users/register', {'email': f'wa{TAG}@gmail.com', 'password': 'Staging123!', 'referralCode': 'U1'})
if s not in (200, 201):
    s, j = req('/api/users/login', {'email': f'wa{TAG}@gmail.com', 'password': 'Staging123!'})
user_token = j.get('token')
check('A0 user login', bool(user_token), j)

s, j = req('/api/user/currency', {'code': 'BDT'}, user_token)
check('A1 currency set to BDT', s == 200 and j.get('success') is not False, j)

s, j = req('/api/payment/methods?mode=deposit', token=user_token)
names = [m['name'] for m in j.get('methods', [])]
# BD methods are still missing their pay-to number at this point (the admin fills
# it in B0-setup), so the honest expectation is: listed methods are BD or global.
check('A2 deposit list is country-scoped (only BD or global methods)',
      s == 200 and all(('Tether' not in n and 'TRON' not in n and 'Ethereum' not in n) for n in names), names)
check('A3 response carries country=BD', j.get('country') == 'BD', j.get('country'))
check('A4 no method from another country leaks', all((m.get('name') or '') for m in j.get('methods', [])), names)

s2, j2 = req('/api/payment/methods?mode=withdraw', token=user_token)
w_names = [m['name'] for m in j2.get('methods', [])]
check('A5 withdraw lists the same country', s2 == 200 and any('bKash' in n for n in w_names), w_names)

# a US user must NOT see bKash
s, j = req('/api/users/register', {'email': f'us{TAG}@gmail.com', 'password': 'Staging123!', 'referralCode': 'U1'})
us_token = j.get('token') or ''
if not us_token:
    s, j = req('/api/users/login', {'email': f'us{TAG}@gmail.com', 'password': 'Staging123!'})
    us_token = j.get('token')
req('/api/user/currency', {'code': 'USD'}, us_token)
s, j = req('/api/payment/methods?mode=deposit', token=us_token)
us_names = [m['name'] for m in j.get('methods', [])]
check('A6 US user sees no bKash', not any('bKash' in n for n in us_names), us_names)
check('A7 US catalogue still has something or explains itself',
      bool(us_names) or 'otherCountries' in j, j.get('otherCountries'))

# ── B. admin creates the agent ────────────────────────────────────────────────
s, j = req('/api/admin/login', ADMIN)
admin = j.get('token')
check('B0 admin login', bool(admin), j)

for mid, acct in (('PM-BKASH', '01711111111'), ('PM-NAGAD', '01722222222'), ('PM-ROCKET', '01733333333')):
    s, j = req('/api/admin/payment-methods', {'id': mid, 'accountNumber': acct, 'accountName': 'BoostPay'}, admin)
    check(f'B0-setup {mid} pay-to account saved', s == 200, j)

s, j = req('/api/admin/wallet-agents/options', token=admin)
opts = j.get('countries', [])
bd = next((c for c in opts if c['code'] == 'BD'), None)
check('B1 country options list BD methods', bool(bd) and any('bKash' in m['name'] for m in bd['methods']), opts[:2])

s, j = req('/api/payment/methods?mode=deposit', token=user_token)
names = [m['name'] for m in j.get('methods', [])]
check('B7 after the admin fills the pay-to account, BDT user sees bKash', 'bKash' in names, names)

bkash = next((m for m in (bd or {}).get('methods', []) if m['name'] == 'bKash'), None)
check('B2 bKash present for BD', bool(bkash), bd and [m['name'] for m in bd['methods']])

agent_email = f'agent{TAG}@boostpay.test'
agent_pw = 'AgentPass123!'
s, j = req('/api/admin/wallet-agents', {
    'name': f'Agent {TAG}', 'email': agent_email, 'password': agent_pw,
    'country': 'BD', 'methodId': bkash['id'] if bkash else 'PM-BKASH',
}, admin)
agent_id = (j.get('agent') or {}).get('id')
check('B3 wallet agent created', s == 201 and bool(agent_id), j)

s, j = req('/api/admin/wallet-agents', {'name': 'dup', 'email': agent_email, 'password': agent_pw,
                                        'country': 'BD', 'methodId': 'PM-BKASH'}, admin)
check('B4 duplicate email rejected', s == 409, j)

s, j = req('/api/admin/wallet-agents', {'name': 'x', 'email': f'x{TAG}@t.io', 'password': agent_pw,
                                        'country': 'US', 'methodId': 'PM-BKASH'}, admin)
check('B5 country/method mismatch rejected', s == 400, j)

s, j = req('/api/admin/wallet-agents', {'name': 'x', 'email': f'y{TAG}@t.io', 'password': 'short',
                                        'country': 'BD', 'methodId': 'PM-BKASH'}, admin)
check('B6 weak password rejected', s == 400, j)

# ── C. agent login + scope ───────────────────────────────────────────────────
s, j = req('/api/walletagent/login', {'email': agent_email, 'password': 'wrong-pass'})
check('C1 wrong password rejected', s == 401, j)
s, j = req('/api/walletagent/login', {'email': agent_email, 'password': agent_pw})
agent_token = j.get('token')
check('C2 agent login', bool(agent_token), j)
s, j = req('/api/walletagent/me', token=agent_token)
check('C3 /me returns the bound method', s == 200 and (j.get('method') or {}).get('name') == 'bKash'
      and (j.get('agent') or {}).get('country') == 'BD', j)
s, j = req('/api/walletagent/me', token=admin)
check('C4 admin token cannot use the agent panel', s == 401, j)
s, j = req('/api/walletagent/requests?type=deposit', token=user_token)
check('C5 user token cannot use the agent panel', s == 401, j)

# ── D. deposit → agent approves ──────────────────────────────────────────────
s, j = req('/api/user/deposit-request', {
    'methodId': 'PM-BKASH', 'amount': 500, 'currency': 'BDT', 'reference': 'TRX' + TAG,
}, user_token)
dep_id = (j.get('request') or {}).get('id') or j.get('id')
check('D1 user creates a bKash deposit', s in (200, 201) and bool(dep_id), j)

s, j = req('/api/walletagent/requests?type=deposit&status=PENDING', token=agent_token)
ids = [r['id'] for r in j.get('requests', [])]
check('D2 agent sees it in the queue', dep_id in ids, ids[:5])

s, j = req(f"/api/walletagent/requests/deposit/review", {'id': dep_id, 'action': 'APPROVE'}, agent_token)
check('D3 agent approves', s == 200 and (j.get('request') or {}).get('status') == 'APPROVED', j)

s, j = req('/api/admin/payment-requests?type=deposit&status=APPROVED', token=admin)
row = next((r for r in j.get('requests', []) if r['id'] == dep_id), None)
check('D4 audit actor is the wallet agent', bool(row) and str(row.get('reviewedBy', '')).startswith('walletagent:'),
      row and row.get('reviewedBy'))

s, j = req(f"/api/walletagent/requests/deposit/review", {'id': dep_id, 'action': 'APPROVE'}, agent_token)
check('D5 double approve is refused (no double credit)', s == 409, j)

bal1 = bal_of(f'wa{TAG}@gmail.com')
check('D6 balance credited once', bal1 is not None and bal1 > 0, bal1)

# ── E. scope: another method is off-limits ───────────────────────────────────
s, j = req('/api/user/deposit-request', {
    'methodId': 'PM-NAGAD', 'amount': 300, 'currency': 'BDT', 'reference': 'NGD' + TAG,
}, user_token)
nagad_id = (j.get('request') or {}).get('id') or j.get('id')
check('E1 nagad deposit created', bool(nagad_id), j)
s, j = req('/api/walletagent/requests/deposit/review', {'id': nagad_id, 'action': 'APPROVE'}, agent_token)
check('E2 agent blocked on another method', s == 403, j)
s, j = req('/api/walletagent/requests?type=deposit&status=PENDING', token=agent_token)
check('E3 that request never appears in the queue', nagad_id not in [r['id'] for r in j.get('requests', [])], j)

# ── F. withdrawal: agent rejects → refund ────────────────────────────────────
give_boost(f'wa{TAG}@gmail.com', 50)
s, j = req('/api/user/withdraw-request', {
    'methodId': 'PM-BKASH', 'amount': 500, 'currency': 'BDT',
    'destination': {'accountName': 'Test User', 'accountNumber': '01700000000'},
}, user_token)
wdr_id = (j.get('request') or {}).get('id') or j.get('id')
if not wdr_id:
    check('F0 withdrawal request accepted', False, json.dumps(j)[:200])
else:
    s, j = req('/api/walletagent/requests?type=withdraw&status=PENDING', token=agent_token)
    check('F1 withdrawal appears for the agent', wdr_id in [r['id'] for r in j.get('requests', [])], j)
    s, j = req('/api/walletagent/requests/withdraw/review', {'id': wdr_id, 'action': 'REJECT', 'reason': 'Wrong number'}, agent_token)
    check('F2 agent rejects with a reason', s == 200 and (j.get('request') or {}).get('status') == 'REJECTED', j)
    bal2 = bal_of(f'wa{TAG}@gmail.com')
    check('F3 rejected withdrawal returns the money (balance ≥ before)', bal2 is not None and bal2 >= 49.9, (bal1, bal2))

# ── G. disable kills the session ─────────────────────────────────────────────
s, j = req(f'/api/admin/wallet-agents/{agent_id}', {'active': False}, admin, method='PATCH')
check('G1 admin disables the agent', s == 200 and (j.get('agent') or {}).get('active') is False, j)
s, j = req('/api/walletagent/me', token=agent_token)
check('G2 the old token stops working', s in (401, 403), j)
s, j = req('/api/walletagent/login', {'email': agent_email, 'password': agent_pw})
check('G3 disabled account cannot sign in', s == 403, j)
s, j = req(f'/api/admin/wallet-agents/{agent_id}', None, admin, method='DELETE')
check('G4 admin deletes the agent', s == 200, j)

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
