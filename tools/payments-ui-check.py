#!/usr/bin/env python3
"""tools/payments-ui-check.py — real-browser guard for the Deposit / Withdraw pages.

Why this exists: two owner rules cannot be proven by API tests —
  1. the Back button must land on the WALLET page (never a blank tab, never the
     other tab of the payment page);
  2. on the withdraw side the Telegram-agent channel is labelled "Cash Agent",
     while the deposit side keeps "Telegram Agent".
This drives the built app in headless Chromium and asserts both, plus the
section order, then fails on any uncaught page error.

Run (local server on :3901, dist built with `npm run build`):
    python3 tools/payments-ui-check.py
"""
import asyncio
import json
import os
import sys
import urllib.request

BASE = os.environ.get('API', 'http://127.0.0.1:3901')
USER = {'email': 'u1@gmail.com', 'password': 'Staging123!'}

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
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method='POST' if body is not None else 'GET',
        headers={'content-type': 'application/json',
                 **({'authorization': 'Bearer ' + token} if token else {})},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read() or b'{}')


async def main():
    from playwright.async_api import async_playwright

    login = api('/api/users/login', USER)
    token = login.get('token')
    user = login.get('user') or {}
    if not token:
        print('cannot sign in for the UI check:', login)
        return 2

    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        # sign the browser in before the app boots
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

        # headers are CSS-uppercased, so every text assertion is case-insensitive
        def low(t):
            return ' '.join(t.split()).lower()

        print('\n[1. the wallet page]')
        body = low(await page.inner_text('body'))
        ck('the wallet page is what a signed-in user lands on',
           'available balance' in body, body[:60])
        dep = page.get_by_role('button', name='Deposit', exact=True)
        wdr = page.get_by_role('button', name='Withdraw', exact=True)
        ck('the wallet has a Deposit button', await dep.count() > 0)
        ck('the wallet has a Withdraw button', await wdr.count() > 0)
        if await dep.count() and await wdr.count():
            bd = await dep.first.bounding_box()
            bw = await wdr.first.bounding_box()
            ck('Deposit sits to the LEFT of Withdraw on the same row',
               bool(bd and bw) and bd['x'] < bw['x'] and abs(bd['y'] - bw['y']) < 12,
               f"deposit x={bd and round(bd['x'])} withdraw x={bw and round(bw['x'])}")

        os.makedirs('report-assets', exist_ok=True)
        await page.screenshot(path='report-assets/wallet-deposit-withdraw.png')

        print('\n[2. the withdraw page and the "Cash Agent" label]')
        await wdr.first.click()
        await page.wait_for_timeout(1600)
        await page.screenshot(path='report-assets/withdraw-page.png')
        ck('opening Withdraw puts #/withdraw in the URL',
           page.url.endswith('#/withdraw'), page.url)
        wbody = low(await page.inner_text('body'))
        ck('the withdraw page lists a Cash Agent channel', 'cash agent' in wbody,
           'cash agent present' if 'cash agent' in wbody else 'missing')
        ck('the withdraw page no longer says "Telegram Agent"',
           'telegram agent' not in wbody,
           'still present' if 'telegram agent' in wbody else 'clean')

        # read the section HEADERS in DOM order (card titles inside the featured
        # grid would otherwise match the same words)
        heads = [low(t) for t in await page.locator('section > button[aria-expanded]').all_inner_texts()]
        heads = [h for h in heads if h]
        order = ['recommended', 'e-wallets', 'internet banking', 'cryptocurrency', 'cash agent']
        idx = []
        for label in order:
            hit = next((i for i, h in enumerate(heads) if label in h), -1)
            idx.append(hit)
        ck('the sections appear in the agreed order',
           all(x >= 0 for x in idx) and idx == sorted(idx), f'{heads} -> {idx}')

        print('\n[3. the back button goes to the wallet]')
        await page.get_by_role('button', name='Back', exact=True).first.click()
        await page.wait_for_timeout(1200)
        bbody = low(await page.inner_text('body'))
        ck('Back clears the payment URL', '#' not in page.url, page.url)
        ck('Back lands on the wallet page', 'available balance' in bbody, bbody[:60])
        ck('the payment page is gone', 'cash agent' not in bbody and 'recommended payment methods' not in bbody)

        print('\n[4. tab switching does not pile up history entries]')
        await page.get_by_role('button', name='Withdraw', exact=True).first.click()
        await page.wait_for_timeout(1400)
        await page.get_by_role('tab', name='deposit', exact=True).click()
        await page.wait_for_timeout(1400)
        ck('switching to the deposit tab changes the URL', page.url.endswith('#/deposit'), page.url)
        await page.screenshot(path='report-assets/deposit-page.png')
        dbody = low(await page.inner_text('body'))
        ck('the deposit side keeps the Telegram Agent label', 'telegram agent' in dbody,
           'telegram agent present' if 'telegram agent' in dbody else 'missing')
        ck('the deposit side does not say Cash Agent', 'cash agent' not in dbody)
        await page.get_by_role('button', name='Back', exact=True).first.click()
        await page.wait_for_timeout(1200)
        ck('one Back press from the deposit tab returns to the wallet',
           'available balance' in low(await page.inner_text('body')), page.url)

        print('\n[5. the browser back gesture behaves the same]')
        await page.get_by_role('button', name='Withdraw', exact=True).first.click()
        await page.wait_for_timeout(1400)
        await page.go_back()
        await page.wait_for_timeout(1400)
        gbody = low(await page.inner_text('body'))
        ck('an OS/browser back gesture lands on the wallet',
           'available balance' in gbody, page.url)
        ck('the browser back gesture left no payment page behind',
           'recommended payment methods' not in gbody)

        ck('the app threw no uncaught error the whole time', not errors, '; '.join(errors[:2]))
        await ctx.close()
        await browser.close()

    print(f'\nRESULT {PASS} pass / {FAIL} fail')
    if PROBLEMS:
        print('\nPROBLEMS:')
        for p_ in PROBLEMS:
            print('  - ' + p_)
    else:
        print('\nNo problems found.')
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
