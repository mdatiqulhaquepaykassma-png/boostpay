#!/usr/bin/env python3
"""
tools/payment-country-ui-check.py — Job 14, user-app side.

Owner rule: "jei country er currency select korbe sei country er local payment
methods deposit and withdraw te show korbe."

This drives the real built app in headless Chromium and proves:
  1. a BDT account sees bKash on Deposit AND on Withdraw;
  2. a USD account does NOT see bKash;
  3. the country chip shows which country is being used;
  4. switching the country from the payment screen reloads the catalogue for
     that country (BD → US makes bKash disappear again);
  5. no uncaught page errors.

Run (root server on :3901, `npm run build` done):
  LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu python3 tools/payment-country-ui-check.py
"""
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get('API', 'http://127.0.0.1:3901')
TAG = str(int(time.time()))[-5:]
PASS, FAIL = [], []


def ck(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else f'  → {detail}'))


def api(path, body=None, token=None):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                               method='POST' if body is not None else 'GET',
                               headers={'content-type': 'application/json',
                                        **({'authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            return resp.status, json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def make_user(kind):
    email = f'cc{TAG}{kind}@gmail.com'
    s, j = api('/api/users/register', {'email': email, 'password': 'Staging123!', 'referralCode': 'U1'})
    if not j.get('token'):
        s, j = api('/api/users/login', {'email': email, 'password': 'Staging123!'})
    return email, j.get('token') or '', j.get('user') or {}


async def main():
    from playwright.async_api import async_playwright

    # bKash must be payable (admin fills the pay-to number)
    s, aj = api('/api/admin/login', {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
                                     'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')})
    admin = aj.get('token') or ''
    if admin:
        api('/api/admin/payment-methods', {'id': 'PM-BKASH', 'accountNumber': '01711111111', 'accountName': 'BoostPay'}, admin)

    bd_email, bd_token, bd_user = make_user('bd')
    us_email, us_token, us_user = make_user('us')
    api('/api/user/currency', {'code': 'BDT'}, bd_token)
    api('/api/user/currency', {'code': 'USD'}, us_token)

    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        async def open_payments(token, user, mode='deposit'):
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            await ctx.add_init_script(
                "(() => {try{"
                f"localStorage.setItem('boostpay_auth_token_v1', {json.dumps(token)});"
                f"localStorage.setItem('boostpay_current_user_v4', {json.dumps(json.dumps(user))});"
                f"localStorage.setItem('boostpay_current_user_id_v4', {json.dumps(str(user.get('id')))});"
                "}catch(e){}})()")
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)[:200]))
            await page.goto(BASE + '/', wait_until='networkidle')
            await page.wait_for_timeout(1800)
            btn = page.get_by_role('button', name='Deposit' if mode == 'deposit' else 'Withdraw', exact=True)
            await btn.first.click()
            await page.wait_for_timeout(1800)
            return ctx, page

        low = lambda t: ' '.join(t.split()).lower()

        # ── BD account ────────────────────────────────────────────────────────
        print('\n[1. BDT account — deposit]')
        ctx, page = await open_payments(bd_token, bd_user, 'deposit')
        body = low(await page.inner_text('body'))
        ck('the BD deposit page lists bKash', 'bkash' in body, body[:200])
        ck('the country chip names Bangladesh', 'bangladesh' in body, body[:200])
        ck('the country chip shows the taka currency', 'bdt' in body)
        await page.screenshot(path='report-assets/payments-country-bd-deposit.png')

        # country panel
        await page.get_by_role('button', name='Country and currency').first.click()
        await page.wait_for_timeout(700)
        panel = low(await page.inner_text('body'))
        ck('the country panel explains the rule', 'methods of your selected country' in panel, panel[:300])
        await page.screenshot(path='report-assets/payments-country-panel.png')
        await page.get_by_role('button', name='Back', exact=True).first.click()
        await page.wait_for_timeout(600)

        # ── BD account — withdraw ────────────────────────────────────────────
        print('\n[2. BDT account — withdraw]')
        await page.get_by_role('button', name='Withdraw', exact=True).first.click()
        await page.wait_for_timeout(1800)
        wbody = low(await page.inner_text('body'))
        ck('the BD withdraw page lists bKash too', 'bkash' in wbody, wbody[:200])
        await page.screenshot(path='report-assets/payments-country-bd-withdraw.png')
        await ctx.close()

        # ── US account ────────────────────────────────────────────────────────
        print('\n[3. USD account — deposit]')
        ctx2, page2 = await open_payments(us_token, us_user, 'deposit')
        ubody = low(await page2.inner_text('body'))
        ck('the US deposit page does not list bKash', 'bkash' not in ubody, ubody[:300])
        ck('the US chip names the United States', 'united states' in ubody, ubody[:200])
        await page2.screenshot(path='report-assets/payments-country-us-deposit.png')
        await ctx2.close()

        # ── switching country inside the payment screen ──────────────────────
        print('\n[4. switch the country from the payment screen]')
        ctx3, page3 = await open_payments(bd_token, bd_user, 'deposit')
        before = low(await page3.inner_text('body'))
        ck('starts on Bangladesh (bKash visible)', 'bkash' in before)
        await page3.get_by_role('button', name='Country and currency').first.click()
        await page3.wait_for_timeout(700)
        # pick the United States in the panel
        us_btn = page3.locator('button', has_text='United States').first
        if await us_btn.count():
            await us_btn.click()
            await page3.wait_for_timeout(2500)
            after = low(await page3.inner_text('body'))
            ck('after switching to the US, bKash is gone', 'bkash' not in after, after[:300])
            ck('the chip now says United States', 'united states' in after, after[:200])
            await page3.screenshot(path='report-assets/payments-country-switched.png')
        else:
            ck('the United States is offered in the country panel', False, 'not found')
        await ctx3.close()
        await browser.close()

    ck('no uncaught page errors', not errors, errors[:2])
    print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
    return 1 if FAIL else 0


sys.exit(asyncio.run(main()))
