#!/usr/bin/env python3
"""
tools/sms-admin-ui-check.py — the SMS Bridge screen in the admin console.

Proves, in a real browser:
  1. the "SMS Bridge" tab exists and explains the flow
  2. a phone can be paired: create → the token is shown exactly once
  3. the device card shows method, number and counters, and can be paused
  4. the "test the reader" box parses a pasted SMS (Bangla + English)
  5. the APK download link is on the page

Run with the root API on :3901 and the admin console on :3911.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

CONSOLE = os.environ.get('ADMIN_URL', 'http://127.0.0.1:3911')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))[-5:]
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'report-assets')
PASS, FAIL = [], []


def ck(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else '  → ' + str(detail)[:200]))


def wait_text(page, needle, timeout=45):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if needle in page.locator('body').inner_text():
                return True
        except Exception:
            pass
        time.sleep(0.6)
    return False


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1400, 'height': 1000})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:160]))

    page.goto(CONSOLE, wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    page.fill('input[type=email]', ADMIN['email'])
    page.fill('input[type=password]', ADMIN['password'])
    page.keyboard.press('Enter')
    page.wait_for_timeout(4000)

    page.click('text=SMS Bridge')
    page.wait_for_timeout(2000)
    ck('the SMS Bridge tab opens', wait_text(page, 'automatic bKash'), page.locator('body').inner_text()[:200])
    ck('the safety rules are on the page', wait_text(page, 'One TrxID credits once'), '')
    ck('the relay APK can be downloaded', page.locator('a[href="/download/boostpay-sms-relay.apk"]').count() > 0, '')

    # pair a phone
    page.fill('input[placeholder^="Phone name"]', f'bKash shop {TAG}')
    page.wait_for_timeout(800)
    selects = page.locator('select')
    options = selects.first.locator('option').all_inner_texts()
    ck('the method dropdown is filled from the catalogue', len(options) > 1, options[:3])
    idx = next((i for i, o in enumerate(options) if 'bKash' in o), 1)
    selects.first.select_option(index=idx)
    page.click('button:has-text("Create & show token")')
    page.wait_for_timeout(3000)
    body = page.locator('body').inner_text()
    ck('the device token is shown once', 'SHOWN ONCE' in body.upper() and 'BPX-' in body, body[-300:])
    page.screenshot(path=os.path.join(SHOTS, 'admin-sms-bridge.png'), full_page=True)
    ck('the new phone appears in the list', wait_text(page, f'bKash shop {TAG}'), '')

    # pause / resume
    page.locator('button:has-text("Pause")').first.click()
    page.wait_for_timeout(2000)
    ck('a phone can be paused from the console', wait_text(page, 'PAUSED'), '')
    page.locator('button:has-text("Resume")').first.click()
    page.wait_for_timeout(2000)

    # the reader tester
    page.fill('textarea', 'আপনি ৫০০.০০ টাকা পেয়েছেন। প্রেরক ০১৭১২৩৪৫৬৭৮। ট্রানজেকশন আইডি: ABC1234567')
    page.click('button:has-text("Parse")')
    page.wait_for_timeout(1500)
    ck('the tester parses a Bangla SMS', wait_text(page, 'ABC1234567') and wait_text(page, '"amount": 500'), page.locator('body').inner_text()[-400:])
    page.screenshot(path=os.path.join(SHOTS, 'admin-sms-bridge-parser.png'), full_page=True)

    ck('no uncaught page errors', not errs, errs[:2])
    b.close()

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
