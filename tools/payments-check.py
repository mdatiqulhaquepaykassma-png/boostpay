#!/usr/bin/env python3
"""
Deposit / Withdraw payment system — API checks.

Runs against a local server (see the journey harness for the start command) and
asserts the money rules, not just the happy path:

  • payment methods need a session and only show what is configured for the user
  • a deposit NEVER credits a balance — only an admin approval does, exactly once
  • a withdrawal leaves the wallet immediately and comes back if it is rejected
  • duplicate references / idempotency keys cannot double-credit or double-debit
  • admin endpoints are closed to normal users

Usage:  python3 tools/payments-check.py
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

API = os.environ.get('API', 'http://127.0.0.1:3901')
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'boostpay_db.json')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'), 'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))
PASS = FAIL = 0
FAILURES = []


def req(path, body=None, token=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77'}
    if token:
        headers['authorization'] = 'Bearer ' + token
    r = urllib.request.Request(API + path, data=data, method=method or ('POST' if body is not None else 'GET'), headers=headers)
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


def ck(name, ok, detail='', severity='HIGH', explain=''):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f'  PASS  {name}' + (f' — {detail}' if detail else ''))
    else:
        FAIL += 1
        FAILURES.append((severity, name, explain or detail))
        print(f'  FAIL  {name} — {detail}')


def section(title):
    print(f'\n[{title}]')


def balance(uid, _token=None):
    """Read straight from the local JSON database — the admin API has no per-user read."""
    try:
        for u in db_read().get('users', []):
            if str(u.get('id')) == str(uid):
                return float(u.get('balance') or 0)
    except Exception:
        pass
    return None


def db_read():
    with open(DB_PATH, 'r') as f:
        return json.load(f)


def db_write(data):
    with open(DB_PATH, 'w') as f:
        json.dump(data, f, indent=1)


# ── setup ────────────────────────────────────────────────────────────────────
s, j = req('/api/admin/login', ADMIN)
ADMIN_TOKEN = j.get('token') or ''
if not ADMIN_TOKEN:
    print('cannot log in as admin:', j)
    sys.exit(1)

s, j = req('/api/users/register', {'email': f'pay{TAG}@gmail.com', 'password': 'Staging123!', 'referralCode': 'U1'})
UID = str(((j.get('user') or {}).get('id')) or '')
s, j = req('/api/users/login', {'email': f'pay{TAG}@gmail.com', 'password': 'Staging123!'})
UTOK = j.get('token') or ''
ck('a test account can sign in', bool(UTOK and UID), f'id={UID}', 'CRITICAL', 'Cannot even create the test user.')

# give it spendable, withdrawable money: balance + boost profit, straight in the DB
data = db_read()
for u in data.get('users', []):
    if str(u.get('id')) == UID:
        u['balance'] = 500.0
        u['lifetimeProfit'] = 200.0
        u['boostProfitWithdrawn'] = 0
db_write(data)

# a clean, configured test method so the checks do not depend on seed data
s, j = req('/api/admin/payment-methods', {
    'id': 'PM-TESTWALLET', 'name': 'Test Wallet', 'category': 'EWALLET', 'logo': '🧪',
    'enabled': True, 'depositEnabled': True, 'withdrawEnabled': True,
    'userDeposit': True, 'userWithdraw': True, 'agentDeposit': True, 'agentWithdraw': True,
    'currencies': ['*'], 'countries': [], 'order': 5,
    'minDeposit': 1, 'maxDeposit': 1000, 'minWithdraw': 1, 'maxWithdraw': 1000,
    'depositFeePercent': 0, 'withdrawFeePercent': 2,
    'accountName': 'BoostPay Test', 'accountNumber': '01700000000',
}, token=ADMIN_TOKEN)
ck('an admin can create a payment method', s == 200 and (j.get('method') or {}).get('id') == 'PM-TESTWALLET',
   f'{s} {(j.get("error") or "")[:60]}', 'CRITICAL', 'Methods cannot be created.')

# ── 1. catalogue ─────────────────────────────────────────────────────────────
section('1. the method catalogue')
s, j = req('/api/payment/methods?mode=deposit', token=UTOK)
ck('the catalogue needs a signed-in user', s == 200, f'{s}', 'CRITICAL', 'The list is public or broken.')
rows = j.get('methods') or []
ck('the configured method is listed for the user', any(m['id'] == 'PM-TESTWALLET' for m in rows), f'{len(rows)} methods', 'HIGH',
   'A configured method is hidden from the user.')
m0 = next((m for m in rows if m['id'] == 'PM-TESTWALLET'), {})
ck('the card carries limits, fee, processing time and the pay-to block',
   m0.get('min') == 1 and m0.get('max') == 1000 and m0.get('processingTime') and (m0.get('payTo') or {}).get('accountNumber'),
   json.dumps({k: m0.get(k) for k in ('min', 'max', 'feePercent', 'processingTime')}), 'HIGH', 'The card is missing the info the brief requires.')
s, j2 = req('/api/payment/methods?mode=deposit')
ck('an anonymous visitor gets nothing', s == 401, f'{s}', 'CRITICAL', 'Payment methods leak without a session.')

# recommendations are a position, not a copy
rec_ids = [m['id'] for m in rows if m.get('recommended')]
ck('a method cannot appear twice in the catalogue', len(rec_ids) == len(set(rec_ids)), f'{len(rec_ids)} recommended', 'HIGH',
   'Recommended methods are duplicated instead of featured.')

# ── 2. currency filtering ────────────────────────────────────────────────────
section('2. currency compatibility')
s, j = req('/api/admin/payment-methods', {'id': 'PM-USDONLY', 'name': 'USD only', 'category': 'BANK', 'currencies': ['USD'],
                                         'accountNumber': '123', 'enabled': True}, token=ADMIN_TOKEN)
s, j = req('/api/payment/methods?mode=deposit', token=UTOK)
codes = {m['id'] for m in (j.get('methods') or [])}
ck('a USD-only method is hidden from a non-USD account when it does not match',
   ('PM-USDONLY' in codes) == (j.get('currency') == 'USD'), f"currency={j.get('currency')} listed={'PM-USDONLY' in codes}",
   'HIGH', 'Currency compatibility is not applied.')
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 10, 'currency': 'EUR', 'reference': 'EURREF1'},
           token=UTOK)
ck('a deposit in a foreign currency is refused', s == 400 and 'Switch your display currency' in json.dumps(j), f'{s} {j.get("error")}',
   'CRITICAL', 'A request can choose its own currency/rate.')

# ── 3. deposits: pending until approved ──────────────────────────────────────
section('3. deposits')
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 25, 'reference': f'REF{TAG}A'}, token=UTOK)
DEP = (j.get('request') or {})
ck('a deposit is accepted as a PENDING request', s == 200 and DEP.get('status') == 'PENDING', f'{s} {DEP.get("id")}', 'CRITICAL',
   'A deposit request cannot be submitted.')
before = balance(UID, ADMIN_TOKEN)
ck('a pending deposit does not change the balance', before == 500.0, f'balance={before}', 'CRITICAL',
   'A deposit credited the wallet without approval.')

s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 25, 'reference': f'REF{TAG}A'}, token=UTOK)
ck('the same reference cannot be submitted twice', s == 409, f'{s} {j.get("error")}', 'CRITICAL', 'Duplicate deposits are accepted.')

s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 0, 'reference': f'REF{TAG}B'}, token=UTOK)
ck('a zero deposit is refused', s == 400, f'{s}', 'HIGH', 'A zero deposit is stored.')
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 5000, 'reference': f'REF{TAG}C'}, token=UTOK)
ck('a deposit above the method maximum is refused', s == 400, f'{s} {j.get("error")}', 'HIGH', 'Method limits are not enforced.')
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 10, 'reference': 'x'}, token=UTOK)
ck('a deposit without a usable reference is refused', s == 400, f'{s}', 'HIGH', 'Unverifiable deposits are accepted.')

# an explicit idempotency key must not create a second request, and a missing key
# must never be treated as one (that bug swallowed every follow-up deposit)
idem_key = f'dep-{TAG}'
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 5, 'reference': f'REF{TAG}E', 'idempotencyKey': idem_key}, token=UTOK)
id1 = (j.get('request') or {}).get('id')
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 5, 'reference': f'REF{TAG}E', 'idempotencyKey': idem_key}, token=UTOK)
ck('the same deposit idempotency key returns the same request',
   (j.get('request') or {}).get('id') == id1, f'{s} {id1} vs {(j.get("request") or {}).get("id")}', 'CRITICAL',
   'A retried deposit created a second request.')
s, j = req('/api/admin/payment-requests/deposit/review', {'id': id1, 'action': 'REJECT', 'reason': 'dup test'}, token=ADMIN_TOKEN)

s, j = req('/api/admin/payment-requests?type=deposit&status=PENDING', token=ADMIN_TOKEN)
pending = [r for r in (j.get('requests') or []) if r.get('id') == DEP.get('id')]
ck('the deposit shows up in the admin queue', len(pending) == 1, f'{len(pending)} found', 'HIGH', 'Admins cannot see the queue.')

s, j = req('/api/admin/payment-requests/deposit/review', {'id': DEP.get('id'), 'action': 'APPROVE'}, token=UTOK)
ck('a normal user cannot approve a deposit', s in (401, 403), f'{s}', 'CRITICAL', 'Users can credit their own wallet.')

s, j = req('/api/admin/payment-requests/deposit/review', {'id': DEP.get('id'), 'action': 'APPROVE'}, token=ADMIN_TOKEN)
after = balance(UID, ADMIN_TOKEN)
ck('approving credits the wallet exactly once', s == 200 and abs((after or 0) - 525.0) < 1e-6, f'{s} balance={after}', 'CRITICAL',
   'The approval did not credit the balance correctly.')

s, j = req('/api/admin/payment-requests/deposit/review', {'id': DEP.get('id'), 'action': 'APPROVE'}, token=ADMIN_TOKEN)
after2 = balance(UID, ADMIN_TOKEN)
ck('approving the same deposit again is refused and credits nothing', s == 409 and after2 == after, f'{s} balance={after2}',
   'CRITICAL', 'A deposit can be credited twice.')

# rejected deposit never credits
s, j = req('/api/user/deposit-request', {'methodId': 'PM-TESTWALLET', 'amount': 10, 'reference': f'REF{TAG}D'}, token=UTOK)
DEP2 = (j.get('request') or {}).get('id')
s, j = req('/api/admin/payment-requests/deposit/review', {'id': DEP2, 'action': 'REJECT', 'reason': 'not found'}, token=ADMIN_TOKEN)
ck('rejecting a deposit leaves the balance untouched', s == 200 and balance(UID, ADMIN_TOKEN) == after,
   f'{s} balance={balance(UID, ADMIN_TOKEN)}', 'CRITICAL', 'A rejected deposit still credited money.')

# a method with no receiving account cannot take money
s, j = req('/api/admin/payment-methods', {'id': 'PM-NOACCT', 'name': 'Unconfigured', 'category': 'EWALLET', 'currencies': ['*'],
                                         'accountNumber': ''}, token=ADMIN_TOKEN)
s, j = req('/api/payment/methods?mode=deposit', token=UTOK)
ck('a method without a receiving account is not offered', 'PM-NOACCT' not in {m['id'] for m in (j.get('methods') or [])},
   f'{s}', 'HIGH', 'Users can pick a method that cannot receive the money.')

# ── 4. withdrawals ───────────────────────────────────────────────────────────
section('4. withdrawals')
dest = {'accountName': 'Test Holder', 'accountNumber': '01800000000'}
s, j = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 50, 'destination': dest}, token=UTOK)
WDR = (j.get('request') or {})
ck('a withdrawal is accepted and debited immediately', s == 200 and WDR.get('status') == 'PENDING'
   and abs(float(WDR.get('amountUsd') or 0) - 50) < 1e-6, f'{s} {WDR.get("id")}', 'CRITICAL', 'Withdrawals cannot be requested.')
b1 = balance(UID, ADMIN_TOKEN)
ck('the wallet dropped by the requested amount', abs((b1 or 0) - (after - 50)) < 1e-6, f'balance={b1} expected={after - 50}',
   'CRITICAL', 'The pending withdrawal was not held from the balance.')
ck('the fee is worked out from the method configuration', abs(float(WDR.get('feeUsd') or 0) - 1) < 1e-6 and
   abs(float(WDR.get('netUsd') or 0) - 49) < 1e-6, f"fee={WDR.get('feeUsd')} net={WDR.get('netUsd')}", 'HIGH',
   'Withdrawal fees are wrong.')

s, j = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 100000, 'destination': dest}, token=UTOK)
ck('a withdrawal above the method maximum is refused', s == 400, f'{s} {j.get("error")}', 'HIGH', 'Method limits are ignored.')
s, j = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 5, 'destination': {}}, token=UTOK)
ck('a withdrawal without destination details is refused', s == 400, f'{s}', 'HIGH', 'Payouts can be created with no destination.')

# duplicate / idempotent
key = f'idem-{TAG}'
s, j = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 10, 'destination': dest, 'idempotencyKey': key}, token=UTOK)
first_id = (j.get('request') or {}).get('id')
b_after_first = balance(UID, ADMIN_TOKEN)
s2, j2 = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 10, 'destination': dest, 'idempotencyKey': key}, token=UTOK)
b_after_second = balance(UID, ADMIN_TOKEN)
ck('the same idempotency key cannot debit twice', b_after_first == b_after_second and
   (j2.get('request') or {}).get('id') == first_id, f'{s2} {b_after_first}->{b_after_second}', 'CRITICAL',
   'A retried withdrawal debited the wallet twice.')

# only boosted profit
data = db_read()
for u in data.get('users', []):
    if str(u.get('id')) == UID:
        u['lifetimeProfit'] = 0
        u['boostProfitWithdrawn'] = 0
db_write(data)
s, j = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 5, 'destination': dest}, token=UTOK)
ck('a balance that never boosted cannot be withdrawn', s == 400 and 'boost' in json.dumps(j).lower(),
   f'{s} {str(j.get("error"))[:60]}', 'CRITICAL', 'Un-boosted money can leave through a payment method.')
data = db_read()
for u in data.get('users', []):
    if str(u.get('id')) == UID:
        u['lifetimeProfit'] = 400.0
db_write(data)

# reject → refund
b_before_reject = balance(UID, ADMIN_TOKEN)
s, j = req('/api/admin/payment-requests/withdraw/review', {'id': WDR.get('id'), 'action': 'REJECT', 'reason': 'wrong account'}, token=ADMIN_TOKEN)
b2 = balance(UID, ADMIN_TOKEN)
ck('rejecting a withdrawal refunds it exactly once', s == 200 and abs((b2 or 0) - ((b_before_reject or 0) + 50)) < 1e-6,
   f'{s} balance={b2} before={b_before_reject}',
   'CRITICAL', 'A rejected withdrawal was not refunded.')
s, j = req('/api/admin/payment-requests/withdraw/review', {'id': WDR.get('id'), 'action': 'REJECT'}, token=ADMIN_TOKEN)
ck('the same rejection cannot refund twice', s == 409 and balance(UID, ADMIN_TOKEN) == b2, f'{s}', 'CRITICAL',
   'Repeated rejections mint money.')

# approve → completed, no further balance change
s, j = req('/api/user/withdraw-request', {'methodId': 'PM-TESTWALLET', 'amount': 20, 'destination': dest}, token=UTOK)
W2 = (j.get('request') or {}).get('id')
held = balance(UID, ADMIN_TOKEN)
s, j = req('/api/admin/payment-requests/withdraw/review', {'id': W2, 'action': 'APPROVE', 'payoutRef': 'BK123'}, token=ADMIN_TOKEN)
ck('marking a withdrawal paid keeps the balance as held', s == 200 and balance(UID, ADMIN_TOKEN) == held
   and (j.get('request') or {}).get('status') == 'COMPLETED', f'{s} balance={balance(UID, ADMIN_TOKEN)}', 'CRITICAL',
   'Paying a withdrawal touched the balance a second time.')

# ── 5. admin switches ────────────────────────────────────────────────────────
section('5. admin switches')
s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'enabled': False}, token=ADMIN_TOKEN)
s, j = req('/api/payment/methods?mode=deposit', token=UTOK)
ck('disabling a method removes it from the user catalogue', 'PM-TESTWALLET' not in {m['id'] for m in (j.get('methods') or [])},
   f'{s}', 'HIGH', 'A disabled method is still offered.')

s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'enabled': True, 'userDeposit': False}, token=ADMIN_TOKEN)
s, j = req('/api/payment/methods?mode=deposit', token=UTOK)
ck('closing user deposits hides it from the deposit tab only',
   'PM-TESTWALLET' not in {m['id'] for m in (j.get('methods') or [])}, f'{s}', 'HIGH',
   'The user-deposit switch is ignored.')
s, j = req('/api/payment/methods?mode=withdraw', token=UTOK)
ck('the same method is still open for withdrawals', 'PM-TESTWALLET' in {m['id'] for m in (j.get('methods') or [])},
   f'{s}', 'HIGH', 'The switches are not independent.')

s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'maintenance': True, 'maintenanceMessage': 'Back in 10 minutes'}, token=ADMIN_TOKEN)
s, j = req('/api/payment/methods?mode=withdraw', token=UTOK)
ck('maintenance mode hides the method', 'PM-TESTWALLET' not in {m['id'] for m in (j.get('methods') or [])}, f'{s}', 'HIGH',
   'Maintenance mode does nothing.')

s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'maintenance': False, 'userDeposit': True}, token=ADMIN_TOKEN)
s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'minWithdraw': 50, 'maxWithdraw': 40}, token=ADMIN_TOKEN)
ck('impossible limits are rejected', s == 400, f'{s} {j.get("error")}', 'HIGH', 'A minimum above the maximum is accepted.')

s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'recommended': True, 'recommendedOrder': 1}, token=ADMIN_TOKEN)
s, j = req('/api/payment/methods?mode=deposit', token=UTOK)
row = next((m for m in (j.get('methods') or []) if m['id'] == 'PM-TESTWALLET'), {})
ck('marking a method recommended is reflected in the catalogue', row.get('recommended') is True, f'{s}', 'HIGH',
   'The recommended flag does not persist.')

s, j = req('/api/admin/payment-methods', {'id': 'PM-TESTWALLET', 'enabled': False}, token=ADMIN_TOKEN)
s, j = req('/api/admin/payment-methods/delete', {'id': 'PM-NOACCT'}, token=ADMIN_TOKEN)
s, j = req('/api/admin/payment-methods/delete', {'id': 'PM-USDONLY'}, token=ADMIN_TOKEN)
ck('an admin can delete an unused method', s == 200, f'{s} {j.get("error")}', 'MEDIUM', 'Methods cannot be removed.')
s, j = req('/api/admin/payment-methods', token=UTOK)
ck('a normal user cannot read the admin catalogue', s in (401, 403), f'{s}', 'CRITICAL', 'Admin data is exposed.')

print(f'\nRESULT {PASS} pass / {FAIL} fail')
if FAILURES:
    print('\nFailures:')
    for sev, name, why in FAILURES:
        print(f'  [{sev}] {name}\n          {why}')
    sys.exit(1)
print('\nNo problems found.')
