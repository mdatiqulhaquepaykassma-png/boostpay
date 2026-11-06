#!/usr/bin/env python3
"""tools/ui-smoke.py — the cheapest possible guard against a blank app.

A single malformed hook turns the whole bundle into a white screen while every
API test still passes, so this loads the built app in a real browser, fails on
ANY uncaught React/page error, and checks that the sign-in screen actually paints.

    LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu python3 tools/ui-smoke.py
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get('API', 'http://127.0.0.1:3901')
PAGES = ['/', '/?ref=TESTCODE']

async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for path in PAGES:
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e, path=path: errors.append(f'{path}: {str(e)[:160]}'))
            await pg.goto(BASE + path, wait_until='networkidle')
            await pg.wait_for_timeout(1500)
            body = (await pg.inner_text('body')).strip()
            if len(body) < 30:
                errors.append(f'{path}: page rendered almost nothing ({len(body)} chars)')
            await ctx.close()
        await b.close()
    if errors:
        print('UI SMOKE FAILED')
        for e in errors:
            print('  -', e)
        return 1
    print('UI smoke OK — app renders, no page errors')
    return 0

sys.exit(asyncio.run(main()))
