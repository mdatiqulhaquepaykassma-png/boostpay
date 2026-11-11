#!/usr/bin/env python3
"""
tools/walletagent-ui-check.py — Job 14 UI test for the wallet-agent panel.

Drives the real panel in a browser against a LOCAL server:
  login → queue shows the bound method's pending deposit and withdrawal with
  amount, reference, destination → approve credits the user → reject refunds →
  a request of another method never appears → history shows the decision.

Prereqs (local only): root API on :3901 and the panel on :3921
  API_PROXY_TARGET=http://127.0.0.1:3901 PORT=3921 node_modules/.bin/tsx server.ts

Run: LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu python3 tools/walletagent-ui-check.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

API = 'http://127.0.0.1:3901'
PANEL = os.environ.get('PANEL_URL', 'http://127.0.0.1:3921')
ADMIN = {'email': 'admin@boostpay.local', 'password': 'AdminPass123'}
AGENT_EMAIL = 'rahim.agent@boostpay.online'
AGENT_PW = 'AgentPass123!'
TAG = str(int(time.time()))[-5:]
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'report-assets')
PASS, FAIL = [], []


def check(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else f'  → {detail}'))


def api(path, body=None, tok=None, method=None):
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                               method=method or ('POST' if body is not None else 'GET'))
    r.add_header('Content-Type', 'application/json')
    if tok:
        r.add_header('Authorization', 'Bearer ' + tok)
    try:
        with urllib.request.urlopen(r, timeout=20) as x:
            return x.status, json.loads(x.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def bal(email):
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'boostpay_db.json')) as fh:
        for u in json.load(fh).get('users', []):
            if str(u.get('email') or '').lower() == email.lower():
                return float(u.get('balance') or 0)
    return None


# ── fixtures ────────────────────────────────────────────────────────────────
s, j = api('/api/admin/login', ADMIN)
admin = j['token']
api('/api/admin/payment-methods', {'id': 'PM-BKASH', 'accountNumber': '01711111111', 'accountName': 'BoostPay'}, admin)
api('/api/admin/payment-methods', {'id': 'PM-NAGAD', 'accountNumber': '01722222222', 'accountName': 'BoostPay'}, admin)

# the panel needs an account; create it through the real admin API (owned fixture)
s, j = api('/api/admin/wallet-agents', tok=admin)
for a in (j.get('agents') or []):
    if a.get('email') == AGENT_EMAIL:
        api(f"/api/admin/wallet-agents/{a['id']}", None, admin, method='DELETE')
s, j = api('/api/admin/wallet-agents', {'name': 'Queue Tester', 'email': AGENT_EMAIL, 'password': AGENT_PW,
                                        'country': 'BD', 'methodId': 'PM-BKASH'}, admin)
check('fixture: wallet agent account ready', s == 201, j)

s, j = api('/api/users/register', {'email': f'ui{TAG}@gmail.com', 'password': 'Staging123!', 'referralCode': 'U1'})
utok = j.get('token') or ''
if not utok:
    s, j = api('/api/users/login', {'email': f'ui{TAG}@gmail.com', 'password': 'Staging123!'})
    utok = j['token']
api('/api/user/currency', {'code': 'BDT'}, utok)

# give the tester money that can be withdrawn
path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'boostpay_db.json')
with open(path) as fh:
    doc = json.load(fh)
for u in doc['users']:
    if str(u.get('email') or '').lower() == f'ui{TAG}@gmail.com'.lower():
        u['balance'] = 150.0
        u['lifetimeProfit'] = 120.0
        u['boostProfitWithdrawn'] = 0.0
with open(path, 'w') as fh:
    json.dump(doc, fh)

s, j = api('/api/user/deposit-request', {'methodId': 'PM-BKASH', 'amount': 1500, 'currency': 'BDT',
                                         'reference': 'UIBK' + TAG}, utok)
dep_id = (j.get('request') or {}).get('id')
s, j = api('/api/user/withdraw-request', {'methodId': 'PM-BKASH', 'amount': 400, 'currency': 'BDT',
                                          'destination': {'accountName': 'UI User', 'accountNumber': '01812345678'}}, utok)
wdr_id = (j.get('request') or {}).get('id')
s, j = api('/api/user/deposit-request', {'methodId': 'PM-NAGAD', 'amount': 900, 'currency': 'BDT',
                                         'reference': 'UING' + TAG}, utok)
nagad_id = (j.get('request') or {}).get('id')
check('fixtures: one bKash deposit, one bKash withdrawal, one Nagad deposit',
      bool(dep_id and wdr_id and nagad_id), (dep_id, wdr_id, nagad_id))

before = bal(f'ui{TAG}@gmail.com')

# ── browser ─────────────────────────────────────────────────────────────────
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 430, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(PANEL, wait_until='domcontentloaded')
    page.wait_for_selector('form.login', timeout=15000)
    check('1 login screen renders', page.locator('text=Wallet Agent').first.is_visible())

    # wrong password is refused
    page.fill('input[type=email]', AGENT_EMAIL)
    page.fill('input[type=password]', 'nope-nope')
    page.click('button.primary')
    page.wait_for_timeout(1200)
    check('2 wrong password shows an error', page.locator('.msg.bad').count() > 0)

    page.fill('input[type=password]', AGENT_PW)
    page.click('button.primary')
    page.wait_for_selector('.brand small', timeout=15000)
    page.wait_for_timeout(1500)
    hdr = page.locator('.brand small').first.inner_text()
    check('3 signed in and the binding is shown', 'BD' in hdr.upper() and 'BKASH' in hdr.upper(), hdr)
    check('4 dashboard stats rendered', page.locator('.stat b').count() >= 4)

    page.screenshot(path=os.path.join(SHOTS, 'walletagent-queue.png'), full_page=True)

    # deposit queue
    text = page.locator('body').inner_text()
    check('5 the bKash deposit is listed', dep_id in text, text[:300])
    check('6 the Nagad deposit is NOT listed', nagad_id not in text)

    page.click(f'text={dep_id}')
    page.wait_for_timeout(400)
    ref = page.locator('.ref').first.inner_text()
    check('7 the reference is visible for verification', 'UIBK' in ref, ref)
    check('8 the pay-to account is shown', '01711111111' in page.locator('body').inner_text())
    page.screenshot(path=os.path.join(SHOTS, 'walletagent-deposit-detail.png'), full_page=True)

    page.click('text=Approve & credit')
    page.wait_for_timeout(2000)
    check('9 approve shows a confirmation', page.locator('.msg.good').count() > 0)
    after = bal(f'ui{TAG}@gmail.com')
    check('10 the user was credited', (after or 0) > (before or 0) + 1, (before, after))
    check('11 the deposit left the pending queue', dep_id not in page.locator('.list').inner_text())

    # withdrawal
    page.click('button:has-text("Withdrawals")')
    page.wait_for_timeout(1800)
    text = page.locator('body').inner_text()
    check('12 the withdrawal is listed', wdr_id in text, text[:300])
    page.click(f'text={wdr_id}')
    page.wait_for_timeout(400)
    body = page.locator('body').inner_text()
    check('13 the destination is shown', '01812345678' in body)
    page.screenshot(path=os.path.join(SHOTS, 'walletagent-withdraw-detail.png'), full_page=True)
    page.fill('input[placeholder*="Reason if you reject"]', 'Wrong wallet number')
    page.click('button.danger')
    page.wait_for_timeout(2000)
    refunded = bal(f'ui{TAG}@gmail.com')
    check('14 reject refunds the money', (refunded or 0) >= (after or 0) + 1, (after, refunded))

    # history
    page.click('button:has-text("History")')
    page.wait_for_timeout(1200)
    page.click('button:has-text("Deposits")')
    page.wait_for_timeout(1500)
    hist = page.locator('body').inner_text()
    check('15 history shows the approved deposit', dep_id in hist, hist[:300])
    page.screenshot(path=os.path.join(SHOTS, 'walletagent-history.png'), full_page=True)

    # account tab
    page.click('button:has-text("Account")')
    page.wait_for_timeout(700)
    acct = page.locator('body').inner_text()
    check('16 account tab shows the scope', 'bKash' in acct and 'BD' in acct, acct[:200])
    page.screenshot(path=os.path.join(SHOTS, 'walletagent-account.png'), full_page=True)

    check('17 no uncaught page errors', not errors, errors[:2])

    # reload keeps the session
    page.reload(wait_until='domcontentloaded')
    page.wait_for_timeout(2000)
    check('18 session survives a reload', page.locator('.brand small').count() > 0)

    page.click('button:has-text("Sign out")')
    page.wait_for_timeout(1200)
    check('19 sign out returns to login', page.locator('form.login').count() > 0)
    b.close()

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
