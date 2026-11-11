#!/usr/bin/env python3
"""
tools/walletagent-edit-check.py — editing a wallet-agent account (Job 15).

Owner request: "management.boostpay.online theke agent er details edit kora jabe,
agent er name etc change kora jabe — admin panel theke and management theke."

Proves, against the LOCAL server:
  A. guard rails: duplicate email 409, short password 400, method not offered in
     that country 400, empty name 400
  B. admin console (real browser): Wallet Agents → Edit details → change name +
     login email → saved, the list shows the new values
  C. the wallet-agent panel follows: new email signs in, old email does not
  D. management API: a password set from the management console signs the agent
     out everywhere and takes over from the old password
  E. management console (real browser, 430 px): Wallet tab → Edit details →
     rename → saved; Disable blocks the panel login

Run against the local stack (root :3901, admin :3911, management :3931):
  LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu \
    python3 tools/walletagent-edit-check.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

API = 'http://127.0.0.1:3901'
ADMIN_URL = os.environ.get('ADMIN_URL', 'http://127.0.0.1:3911')
MGMT_URL = os.environ.get('MGMT_URL', 'http://127.0.0.1:3931')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))[-5:]
PASS, FAIL = [], []
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'report-assets')

AGENT_EMAIL = f'edit{TAG}@boostpay.test'
AGENT_PW = 'AgentPass123!'
NEW_EMAIL = f'edited{TAG}@boostpay.test'
NEW_PW = 'BrandNewPass456!'
MGMT_EMAIL = f'mgmt{TAG}@gmail.com'
MGMT_PW = 'MgmtPass123!'


def ck(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else '  → ' + str(detail)[:200]))


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


# ── fixtures ────────────────────────────────────────────────────────────────
s, j = api('/api/admin/login', ADMIN)
admin = j.get('token')
ck('admin login', bool(admin), j)

api('/api/admin/payment-methods', {'id': 'PM-BKASH', 'accountNumber': '01711111111', 'accountName': 'BoostPay'}, admin)
api('/api/admin/payment-methods', {'id': 'PM-NAGAD', 'accountNumber': '01722222222', 'accountName': 'BoostPay'}, admin)

s, j = api('/api/admin/management', {'email': MGMT_EMAIL.split('@')[0], 'password': MGMT_PW, 'name': 'Ops Manager'}, admin)
ck('management account ready', s in (200, 201, 409), j)
s, j = api('/api/management/login', {'email': MGMT_EMAIL, 'password': MGMT_PW})
mgmt = j.get('token')
ck('management login', bool(mgmt), j)

s, j = api('/api/admin/wallet-agents', {'name': 'Edit Target', 'email': AGENT_EMAIL, 'password': AGENT_PW,
                                        'country': 'BD', 'methodId': 'PM-BKASH'}, admin)
agent_id = (j.get('agent') or {}).get('id')
ck('wallet agent created', s == 201 and bool(agent_id), j)

s, j = api('/api/management/wallet-agents', tok=mgmt)
ck('management can list wallet agents', s == 200 and any(a['id'] == agent_id for a in j.get('agents', [])), j.get('error'))
ck('management gets the country → method tree', s == 200 and any(c['code'] == 'BD' for c in j.get('countries', [])))

# ── A. guard rails ──────────────────────────────────────────────────────────
s, j = api(f'/api/management/wallet-agents/{agent_id}', {'email': AGENT_EMAIL.upper()}, mgmt, method='PATCH')
ck('re-saving the same email is not a duplicate error', s == 200, j)

s, j = api('/api/admin/wallet-agents', {'name': 'Dup', 'email': AGENT_EMAIL, 'password': AGENT_PW,
                                        'country': 'BD', 'methodId': 'PM-BKASH'}, admin)
ck('a second account cannot reuse the email', s == 409, j)

s, j = api(f'/api/management/wallet-agents/{agent_id}', {'password': 'short'}, mgmt, method='PATCH')
ck('a short password is refused', s == 400, j)

s, j = api(f'/api/management/wallet-agents/{agent_id}', {'country': 'US', 'methodId': 'PM-BKASH'}, mgmt, method='PATCH')
ck('a method that is not offered in that country is refused', s == 400, j)

s, j = api(f'/api/management/wallet-agents/{agent_id}', {'name': '   '}, mgmt, method='PATCH')
ck('an empty name is refused', s == 400, j)

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []

    # ── B. admin console ────────────────────────────────────────────────────
    page = b.new_page(viewport={'width': 1400, 'height': 950})
    page.on('pageerror', lambda e: errs.append('admin: ' + str(e)[:160]))
    page.goto(ADMIN_URL, wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    page.fill('input[type=email]', ADMIN['email'])
    page.fill('input[type=password]', ADMIN['password'])
    page.keyboard.press('Enter')
    page.wait_for_timeout(3500)
    page.click('text=Wallet Agents')
    page.wait_for_timeout(2500)
    page.locator(f'button:has-text("{AGENT_EMAIL}")').first.click()
    page.wait_for_timeout(600)
    page.click('text=Edit details')
    page.wait_for_timeout(600)
    ck('admin: the Edit details form opens', page.locator('text=Edit WAG-').count() > 0)

    admin_name = f'Edited By Admin {TAG}'
    page.fill('input[value="Edit Target"]', admin_name)
    page.fill(f'input[value="{AGENT_EMAIL}"]', NEW_EMAIL)
    page.screenshot(path=os.path.join(SHOTS, 'admin-walletagent-edit.png'), full_page=True)
    page.click('button:has-text("Save")')
    page.wait_for_timeout(2500)
    body = page.locator('body').inner_text()
    ck('admin: the new name is in the list', admin_name in body, body[:200])
    ck('admin: the new email is in the list', NEW_EMAIL in body)

    # ── C. the wallet-agent panel follows the data ──────────────────────────
    s, j = api('/api/walletagent/login', {'email': NEW_EMAIL, 'password': AGENT_PW})
    ck('panel: the edited email + unchanged password sign in', s == 200 and bool(j.get('token')), j)
    agent_tok = j.get('token')
    s, j = api('/api/walletagent/login', {'email': AGENT_EMAIL, 'password': AGENT_PW})
    ck('panel: the old email no longer signs in', s == 401, j)

    # ── D. password set from the management console ─────────────────────────
    s, j = api(f'/api/management/wallet-agents/{agent_id}', {'password': NEW_PW}, mgmt, method='PATCH')
    ck('management: a new password is accepted',
       s == 200 and any('password' in c for c in (j.get('changes') or [])), j)
    s, j = api('/api/walletagent/me', tok=agent_tok)
    ck('management: the password change killed the old session', s in (401, 403), j)
    s, j = api('/api/walletagent/login', {'email': NEW_EMAIL, 'password': AGENT_PW})
    ck('panel: the old password is dead', s == 401, j)
    s, j = api('/api/walletagent/login', {'email': NEW_EMAIL, 'password': NEW_PW})
    ck('panel: the new password signs in', s == 200 and bool(j.get('token')), j)

    # ── E. management console ───────────────────────────────────────────────
    m = b.new_page(viewport={'width': 430, 'height': 950})
    m.on('pageerror', lambda e: errs.append('mgmt: ' + str(e)[:160]))
    m.goto(MGMT_URL, wait_until='domcontentloaded')
    m.wait_for_timeout(2500)
    # the management login asks for the Gmail *local part* (mgrname -> mgrname@gmail.com)
    m.fill('input[placeholder="mgrname"]', MGMT_EMAIL.split('@')[0])
    m.fill('input[type=password]', MGMT_PW)
    m.keyboard.press('Enter')
    m.wait_for_timeout(3500)
    ck('management: login lands on the console', 'MY MANAGEMENT WALLET' in m.locator('body').inner_text().upper())
    # the "Wallet" tab is the bottom-nav button (exact label), not the "MY MANAGEMENT WALLET" heading
    m.get_by_role('button', name='Wallet', exact=True).last.click()
    m.wait_for_timeout(2500)
    ck('management: the Wallet tab lists the account', NEW_EMAIL in m.locator('body').inner_text(),
       m.locator('body').inner_text()[:200])

    m.locator('button:has-text("Edit details")').first.click()
    m.wait_for_timeout(700)
    mgmt_name = f'Edited By Mgmt {TAG}'
    m.fill('input[placeholder="Agent name"]', mgmt_name)
    m.screenshot(path=os.path.join(SHOTS, 'management-walletagent-edit.png'), full_page=True)
    m.click('button:has-text("Save")')
    m.wait_for_timeout(2500)
    mbody = m.locator('body').inner_text()
    ck('management: the new name is shown', mgmt_name in mbody, mbody[:300])

    s, j = api('/api/walletagent/login', {'email': NEW_EMAIL, 'password': NEW_PW})
    s, j = api('/api/walletagent/me', tok=(j or {}).get('token'))
    ck('panel: the panel shows the name management saved', (j.get('agent') or {}).get('name') == mgmt_name, j.get('agent'))

    # disable from the management console → the panel refuses
    m.locator('button:has-text("Disable")').first.click()
    m.wait_for_timeout(2000)
    s, j = api('/api/walletagent/login', {'email': NEW_EMAIL, 'password': NEW_PW})
    ck('management: Disable blocks the panel login', s == 403, j)
    m.screenshot(path=os.path.join(SHOTS, 'management-walletagent-disabled.png'))
    ck('no uncaught page errors in either console', not errs, errs[:2])
    b.close()

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
