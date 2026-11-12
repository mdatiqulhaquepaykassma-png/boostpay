#!/usr/bin/env python3
"""
tools/sms-check.py — the bKash/Nagad SMS auto-credit bridge (API level).

What has to be true before a phone is allowed to move money:
  1. a relay device is created in the console, and its token is stored hashed
  2. an SMS only credits when a PENDING deposit carries that exact TrxID
  3. the amount in the SMS must equal what the user claimed (tolerance = 0 by default)
  4. one TrxID can never credit twice — a replayed SMS is a no-op
  5. an unknown TrxID, a mismatched amount, an OTP or a "you sent" SMS credits nothing
  6. a paused device is refused; a wrong token is refused
  7. auto-credit OFF still verifies the SMS but leaves the approval to a human

Run against the local server on :3901 (see REPORT_75 for the start command).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get('API', 'http://127.0.0.1:3901')
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'boostpay_db.json')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))[-6:]
PASS, FAIL = [], []


def req(path, body=None, token=None, method=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77'}
    if token:
        h['authorization'] = 'Bearer ' + token
    if headers:
        h.update(headers)
    r = urllib.request.Request(API + path, data=data, method=method or ('POST' if body is not None else 'GET'), headers=h)
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


def ck(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else '  → ' + str(detail)[:220]))


def db_read():
    with open(DB_PATH) as f:
        return json.load(f)


def balance_of(uid):
    for u in db_read().get('users', []):
        if str(u.get('id')) == str(uid):
            return float(u.get('balance') or 0)
    return None


# ── setup ────────────────────────────────────────────────────────────────────
s, j = req('/api/admin/login', ADMIN)
ADMIN_TOKEN = j.get('token') or ''
if not ADMIN_TOKEN:
    print('cannot log in as admin:', j)
    sys.exit(1)

METHOD = 'PM-SMSBKASH'
MSISDN = '01711111111'
s, j = req('/api/admin/payment-methods', {
    'id': METHOD, 'name': 'bKash', 'category': 'EWALLET', 'logo': '🟥',
    'enabled': True, 'depositEnabled': True, 'withdrawEnabled': True,
    'userDeposit': True, 'userWithdraw': True, 'agentDeposit': True, 'agentWithdraw': True,
    'currencies': ['*'], 'countries': ['BD'], 'order': 5,
    'minDeposit': 1, 'maxDeposit': 100000, 'minWithdraw': 1, 'maxWithdraw': 100000,
    'depositFeePercent': 0, 'withdrawFeePercent': 0,
    'accountName': 'BoostPay', 'accountNumber': MSISDN,
}, token=ADMIN_TOKEN)

s, j = req('/api/users/register', {'email': f'sms{TAG}@gmail.com', 'password': 'Staging123!', 'referralCode': 'U1'})
UID = str(((j.get('user') or {}).get('id')) or '')
s, j = req('/api/users/login', {'email': f'sms{TAG}@gmail.com', 'password': 'Staging123!'})
UTOK = j.get('token') or ''
ck('a test user signs in', bool(UTOK and UID), f'id={UID}')

# the user is in Bangladesh, so the deposit is entered in BDT
data = db_read()
for u in data.get('users', []):
    if str(u.get('id')) == UID:
        u['currency'] = 'BDT'
        u['country'] = 'BD'
        u['balance'] = 0.0
with open(DB_PATH, 'w') as f:
    json.dump(data, f, indent=1)
BEFORE = balance_of(UID)

# ── 1. device registry ───────────────────────────────────────────────────────
s, j = req('/api/admin/sms-devices', {'label': f'bKash shop {TAG}', 'methodId': METHOD, 'msisdn': MSISDN}, token=ADMIN_TOKEN)
DEV = j.get('device') or {}
TOKEN = j.get('token') or ''
ck('admin creates a relay device and gets its token once', s == 200 and TOKEN.startswith('BPX-') and DEV.get('id'), j)
ck('the device knows its payment method', DEV.get('methodId') == METHOD and DEV.get('methodName') == 'bKash', DEV)
listed = req('/api/admin/sms-devices', token=ADMIN_TOKEN)[1]
ck('the device list never returns the token', TOKEN not in json.dumps(listed)
   and all(('tokenHash' not in d and 'token' not in d) for d in listed.get('devices', [])), 'token leaked')
stored = [d for d in db_read().get('smsDevices', []) if d.get('id') == DEV.get('id')]
ck('the token is stored only as a hash', stored and TOKEN not in json.dumps(stored) and stored[0].get('tokenHash'), 'plaintext token in the DB')

s, j = req('/api/admin/sms-devices', {'label': 'no method'}, token=ADMIN_TOKEN)
ck('a device without a method is refused', s == 400, j)
s, j = req('/api/admin/sms-devices', token=None)
ck('the device list needs an admin session', s in (401, 403), s)

# ── 2. the happy path ────────────────────────────────────────────────────────
TRX1 = 'SMS' + TAG + 'A'
s, j = req('/api/user/deposit-request', {'methodId': METHOD, 'amount': 500, 'reference': TRX1}, token=UTOK)
DEP1 = (j.get('request') or {}).get('id')
ck('the user submits a deposit with the TrxID', s == 200 and bool(DEP1), j)
ck('nothing is credited before the SMS arrives', balance_of(UID) == BEFORE, f'{balance_of(UID)} vs {BEFORE}')

SMS1 = f'You have received Tk 500.00 from 01812345678. Ref: {TRX1}. TrxID {TRX1}. Balance Tk 1,200.00.'
s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': SMS1, 'receivedAt': int(time.time() * 1000)},
           headers={'x-sms-token': TOKEN})
AFTER = balance_of(UID)
ck('the relay SMS auto-credits the deposit', s == 200 and j.get('status') == 'CREDITED' and j.get('credit') is True, j)
ck('the user balance really moved', AFTER is not None and AFTER > BEFORE, f'{BEFORE} → {AFTER}')
ck('the credited amount is the USD value of the deposit', j.get('creditedUsd', 0) > 0, j)

dep = next((d for d in db_read().get('depositRequests', []) if d.get('id') == DEP1), {})
ck('the deposit is APPROVED and stamped with the device', dep.get('status') == 'APPROVED' and dep.get('smsDeviceId') == DEV.get('id'), dep)

# replay → no second credit
s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': SMS1}, headers={'x-sms-token': TOKEN})
ck('a replayed SMS cannot credit twice', j.get('status') == 'DUPLICATE' and balance_of(UID) == AFTER, j)

# ── 3. the attacks ───────────────────────────────────────────────────────────
TRX2 = 'SMS' + TAG + 'B'
s, j = req('/api/user/deposit-request', {'methodId': METHOD, 'amount': 300, 'reference': TRX2}, token=UTOK)
DEP2 = (j.get('request') or {}).get('id')
s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': f'You have received Tk 250.00 from 01812345678. TrxID {TRX2}'},
           headers={'x-sms-token': TOKEN})
ck('an amount that does not match the claim is not credited', j.get('status') == 'AMOUNT_MISMATCH' and balance_of(UID) == AFTER, j)
ck('the mismatched deposit stays PENDING for a human',
   next((d for d in db_read().get('depositRequests', []) if d.get('id') == DEP2), {}).get('status') == 'PENDING', '')

s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': 'You have received Tk 900.00 from 01812345678. TrxID NOSUCH12345'},
           headers={'x-sms-token': TOKEN})
ck('an unknown TrxID is stored, never credited', j.get('status') == 'UNMATCHED' and balance_of(UID) == AFTER, j)

s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': 'Your bKash OTP is 123456. Do not share it with anyone.'},
           headers={'x-sms-token': TOKEN})
ck('an OTP message is ignored', j.get('status') in ('IGNORED', 'UNMATCHED') and balance_of(UID) == AFTER, j)

s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': f'You have sent Tk 500.00 to 01812345678. TrxID {TRX1}'},
           headers={'x-sms-token': TOKEN})
ck('a "you sent" SMS never credits', str(j.get('status')) != 'CREDITED' and balance_of(UID) == AFTER, j)

s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': SMS1}, headers={'x-sms-token': 'BPX-WRONGTOKEN'})
ck('a wrong device token is refused', s == 401, j)
s, j = req('/api/sms/ingest', {'message': SMS1})
ck('an ingest without a token is refused', s == 401, j)

# ── 4. paused device ────────────────────────────────────────────────────────
TRX3 = 'SMS' + TAG + 'C'
s, j = req('/api/user/deposit-request', {'methodId': METHOD, 'amount': 120, 'reference': TRX3}, token=UTOK)
req('/api/admin/sms-devices/' + str(DEV.get('id')), {'active': False}, token=ADMIN_TOKEN, method='PATCH')
s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': f'You have received Tk 120.00 from 01812345678. TrxID {TRX3}'},
           headers={'x-sms-token': TOKEN})
ck('a paused device cannot credit', s == 403 and balance_of(UID) == AFTER, j)
req('/api/admin/sms-devices/' + str(DEV.get('id')), {'active': True}, token=ADMIN_TOKEN, method='PATCH')

# ── 5. auto-credit OFF (verify, do not pay) ─────────────────────────────────
s, j = req('/api/admin/sms-devices', {'label': f'bKash manual {TAG}', 'methodId': METHOD, 'msisdn': '01799999999', 'autoCredit': False}, token=ADMIN_TOKEN)
TOKEN2 = j.get('token') or ''
TRX4 = 'SMS' + TAG + 'D'
s, j = req('/api/user/deposit-request', {'methodId': METHOD, 'amount': 800, 'reference': TRX4}, token=UTOK)
DEP4 = (j.get('request') or {}).get('id')
ck('the user can submit a fourth deposit', s == 200 and bool(DEP4), f'{s} {j}')
s, j = req('/api/sms/ingest', {'sender': 'bKash', 'message': f'You have received Tk 800.00 from 01812345678. TrxID {TRX4}'},
           headers={'x-sms-token': TOKEN2})
ck('auto-credit OFF verifies the SMS but pays nothing', j.get('status') == 'MATCHED' and balance_of(UID) == AFTER, j)
d4 = next((d for d in db_read().get('depositRequests', []) if d.get('id') == DEP4), {})
ck('the matched deposit carries an SMS stamp for the human reviewer', d4.get('smsVerifiedAt') and d4.get('status') == 'PENDING', d4.get('status'))
s, j = req('/api/admin/payment-requests/deposit/review', {'id': DEP4, 'action': 'APPROVE'}, token=ADMIN_TOKEN)
ck('the admin can still approve it by hand', s == 200 and balance_of(UID) > AFTER, f'{s} {j}')

# ── 6. parser preview (English + Bangla) ────────────────────────────────────
s, j = req('/api/admin/sms-devices/parse', {'message': 'আপনি ৫০০.০০ টাকা পেয়েছেন। প্রেরক ০১৭১২৩৪৫৬৭৮। ট্রানজেকশন আইডি: ABC1234567'},
           token=ADMIN_TOKEN)
p = j.get('parsed') or {}
ck('a Bangla SMS parses (amount + TrxID)', p.get('amount') == 500 and p.get('trxId') == 'ABC1234567' and p.get('direction') == 'CREDIT', p)
s, j = req('/api/admin/sms-devices/parse', {'message': 'Nagad: You have received Tk 2,500.50 from 01812345678. TrxID: NG7A8B9C0D'},
           token=ADMIN_TOKEN)
p = j.get('parsed') or {}
ck('a Nagad SMS parses with thousands + decimals', p.get('provider') == 'NAGAD' and p.get('amount') == 2500.5, p)

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
