#!/usr/bin/env python3
"""
tools/walletagent-admin-ui-check.py — Job 14 admin-console test.

Proves the whole flow from the console a real admin uses:
  log in → Wallet Agents tab → pick country → pick method → create account →
  the account appears → the country/method selecters are scoped → disable/enable →
  the new agent can sign in to the panel and sees only its own method.

Run (admin console on :3911, root API on :3901):
  LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu python3 tools/walletagent-admin-ui-check.py
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

CONSOLE = os.environ.get('CONSOLE_URL', 'http://127.0.0.1:3911')
PANEL = os.environ.get('PANEL_URL', 'http://127.0.0.1:3921')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))[-5:]
EMAIL = f'waadmin{TAG}@boostpay.test'
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'report-assets')
PASS, FAIL = [], []


def check(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else f'  → {detail}'))


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1400, 'height': 950})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(CONSOLE, wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    # admin login form
    page.fill('input[type=email]', ADMIN['email'])
    page.fill('input[type=password]', ADMIN['password'])
    page.keyboard.press('Enter')
    page.wait_for_timeout(3500)
    check('1 admin console signed in', page.locator('text=Wallet Agents').count() > 0,
          page.locator('body').inner_text()[:200])

    page.click('text=Wallet Agents')
    page.wait_for_timeout(2500)
    body = page.locator('body').inner_text()
    check('2 Wallet Agents screen opens', 'Create an account' in body or 'Wallet agents' in body, body[:200])
    page.screenshot(path=os.path.join(SHOTS, 'admin-walletagents.png'), full_page=True)

    # fill the create form
    page.fill('input[placeholder="e.g. Rahim (bKash BD)"]', f'Panel Agent {TAG}')
    page.fill('input[placeholder="agent@boostpay.online"]', EMAIL)
    page.fill('input[placeholder="give this to the agent"]', 'AgentPass123!')

    country_select = page.locator('select').filter(has=page.locator('option:has-text("Select a country")'))
    country_select.first.select_option('BD')
    page.wait_for_timeout(800)
    method_select = page.locator('select').filter(has=page.locator('option:has-text("Select the method")'))
    opts = method_select.first.locator('option').all_inner_texts()
    check('3 method list only shows BD methods', any('bKash' in o for o in opts) and not any('Tether' in o for o in opts), opts)
    method_select.first.select_option(label=[o for o in opts if 'bKash' in o][0])
    page.wait_for_timeout(300)

    page.click('text=Create wallet agent')
    page.wait_for_timeout(2500)
    body = page.locator('body').inner_text()
    check('4 account created', EMAIL in body, body[:300])
    check('5 the binding is shown in the list', 'BD · bKash' in body, body[:400])
    page.screenshot(path=os.path.join(SHOTS, 'admin-walletagents-created.png'), full_page=True)

    # open the row → disable
    page.locator(f'button:has-text("{EMAIL}")').first.click()
    page.wait_for_timeout(700)
    det = page.locator('body').inner_text()
    check('6 row detail shows id + decisions', 'WAG-' in det)
    page.click('button:has-text("Disable")')
    page.wait_for_timeout(2000)
    check('7 disabling an agent works', 'DISABLED' in page.locator('body').inner_text())

    # the disabled agent cannot sign in to the panel
    panel = b.new_page(viewport={'width': 420, 'height': 900})
    panel.goto(PANEL, wait_until='domcontentloaded')
    panel.wait_for_selector('form.login', timeout=15000)
    panel.fill('input[type=email]', EMAIL)
    panel.fill('input[type=password]', 'AgentPass123!')
    panel.click('button.primary')
    panel.wait_for_timeout(1800)
    check('8 disabled agent is refused at the panel login', panel.locator('.msg.bad').count() > 0)

    # re-enable in the console
    page.click('button:has-text("Enable")')
    page.wait_for_timeout(2000)
    check('9 enabling again works', 'ACTIVE' in page.locator('body').inner_text())

    panel.fill('input[type=password]', 'AgentPass123!')
    panel.click('button.primary')
    panel.wait_for_timeout(2500)
    ok = panel.locator('.brand small').count() > 0
    check('10 enabled agent can sign in', ok, panel.locator('body').inner_text()[:200])
    if ok:
        hdr = panel.locator('.brand small').first.inner_text().upper()
        check('11 the panel shows the admin-chosen scope', 'BD' in hdr and 'BKASH' in hdr, hdr)
    panel.screenshot(path=os.path.join(SHOTS, 'walletagent-panel-live.png'), full_page=True)

    check('12 no uncaught page errors', not errors, errors[:2])
    b.close()

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
