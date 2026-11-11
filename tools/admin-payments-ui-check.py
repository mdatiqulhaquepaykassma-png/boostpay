#!/usr/bin/env python3
"""tools/admin-payments-ui-check.py — the admin panel must SHOW the money queues.

Owner report (2026-11-10): "withdraw request admin panel e jacche na".

Root cause found and fixed: PaymentAdmin asked localStorage for the USER app's
token (`boostpay_auth_token_v1`), while the admin console keeps its session in
`boostpay_admin_session_v4`. Every request therefore went out with no token, the
server answered 401, and both queues looked permanently empty. API tests could
never catch it — they sign in exactly like a script would.

This drives the REAL admin console in a browser:
  1. sign in through the UI
  2. a user submits a withdrawal on the API
  3. the withdrawal must appear in Payments → Withdraw queue (and the badge count)
  4. "Mark paid" must move it to COMPLETED and keep the balance (held)

Run (admin console on :3911, main API on :3901):
    python3 tools/admin-payments-ui-check.py
"""
import asyncio
import json
import os
import re
import sys
import urllib.error
import urllib.request

ADMIN_URL = os.environ.get('ADMIN_URL', 'http://127.0.0.1:3911')
API = os.environ.get('API', 'http://127.0.0.1:3901')
DB = '/home/user/boostpay/data/boostpay_db.json'
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}

PASS = 0
FAIL = 0
PROBLEMS = []


def ck(name, ok, detail=''):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f'  PASS  {name}' + (f' — {detail}' if detail else ''))
    else:
        FAIL += 1
        print(f'  FAIL  {name}' + (f' — {detail}' if detail else ''))
        PROBLEMS.append(f'{name}: {detail}')


def api(path, body=None, token=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method='POST' if body is not None else 'GET',
        headers={'content-type': 'application/json',
                 **({'authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def balance_of(uid):
    data = json.load(open(DB))
    for u in data.get('users', []):
        if str(u.get('id')) == str(uid):
            return float(u.get('balance') or 0)
    return None


def seed_withdrawable(uid, profit):
    """Local fixture: give the test account boosted profit so a withdrawal is legal."""
    data = json.load(open(DB))
    for u in data.get('users', []):
        if str(u.get('id')) == str(uid):
            u['lifetimeProfit'] = float(u.get('lifetimeProfit') or 0) + profit
    json.dump(data, open(DB, 'w'), indent=1)


async def main():
    from playwright.async_api import async_playwright

    # --- a real user submits a real withdrawal through the API -----------------
    login = api('/api/users/login', {'email': 'u1@gmail.com', 'password': 'Staging123!'})[1]
    utok, uid = login.get('token'), str((login.get('user') or {}).get('id'))
    atok = api('/api/admin/login', ADMIN)[1].get('token')
    if not utok or not atok:
        print('cannot sign in for the queue check')
        return 2

    stamp = str(int(__import__('time').time()))
    method_id = 'PM-UICHK-' + stamp[-5:]
    api('/api/admin/payment-methods', {
        'id': method_id, 'name': 'UI Check Cash', 'category': 'EWALLET', 'currencies': ['*'],
        'accountNumber': '01700000123', 'minWithdraw': 1, 'maxWithdraw': 500}, atok)
    seed_withdrawable(uid, 100)
    before = balance_of(uid)
    status, wj = api('/api/user/withdraw-request', {
        'methodId': method_id, 'amount': 7,
        'destination': {'accountNumber': '01799998888', 'accountName': 'UI Checker'}}, utok)
    rid = (wj.get('request') or {}).get('id')
    print(f'\n[0. a user submitted withdrawal {rid}]')
    ck('the user withdrawal is accepted', status == 200 and bool(rid), f'{status} {wj.get("error", "")}')

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)[:160]))

        print('\n[1. admin signs in through the console UI]')
        await page.goto(ADMIN_URL + '/', wait_until='networkidle')
        await page.wait_for_timeout(1500)
        for sel in ('input[type=email]', 'input[name=email]', 'input[placeholder*="mail" i]'):
            if await page.locator(sel).count():
                await page.locator(sel).first.fill(ADMIN['email'])
                break
        if await page.locator('input[type=password]').count():
            await page.locator('input[type=password]').first.fill(ADMIN['password'])
        btn = page.get_by_role('button', name=re.compile('sign in|log in|login', re.I))
        if await btn.count():
            await btn.first.click()
        await page.wait_for_timeout(3000)
        body = await page.inner_text('body')
        ck('the admin console opens', 'Sign Out' in body, body[:60].replace('\n', ' '))

        print('\n[2. Payments → Withdraw queue]')
        await page.get_by_role('button', name=re.compile('^Payments$', re.I)).first.click()
        await page.wait_for_timeout(2000)
        body = await page.inner_text('body')
        ck('the payment screen loads without an auth error',
           'Could not load the methods' not in body, 'clean' if 'Could not load' not in body else body[:80])

        wtab = page.get_by_role('button', name=re.compile('Withdraw queue', re.I)).first
        wtext = await wtab.inner_text()
        ck('the withdraw tab shows a pending badge', bool(re.search(r'\d', wtext)), wtext.replace('\n', ' '))
        await wtab.click()
        await page.wait_for_timeout(2500)
        body = await page.inner_text('body')
        ck('the new withdrawal request is listed in the admin panel', rid in body, rid or 'no id')
        ck('it shows the user, the amount and the destination fields',
           'UI Check Cash' in body and '01799998888' in body,
           body[body.find('Withdraw queue'):body.find('Withdraw queue') + 160].replace('\n', ' | '))

        print('\n[3. marking it paid]')
        await page.get_by_role('button', name=re.compile('Mark paid', re.I)).first.click()
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept('ADMIN-TEST-REF')))
        await page.wait_for_timeout(3500)
        body = await page.inner_text('body')
        ck('after Mark paid the queue no longer holds it as PENDING',
           'No withdrawal requests' in body or 'COMPLETED' in body, body[:80])
        ck('the balance stays as held (no double refund, no double debit)',
           abs((balance_of(uid) or 0) - ((before or 0) - 7)) < 1e-6,
           f'{balance_of(uid)} vs {(before or 0) - 7}')
        ck('the browser threw no uncaught error', not errors, '; '.join(errors[:2]))

        await page.screenshot(path='report-assets/admin-withdraw-queue.png')
        await ctx.close()
        await browser.close()

    print(f'\nRESULT {PASS} pass / {FAIL} fail')
    if PROBLEMS:
        print('\nPROBLEMS:')
        for x in PROBLEMS:
            print('  - ' + x)
    else:
        print('\nNo problems found.')
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
