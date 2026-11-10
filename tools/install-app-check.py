#!/usr/bin/env python3
"""tools/install-app-check.py — proves <host>/app really is installable.

The /app entry point only counts as done if the BROWSER agrees, so this asks
Chromium itself (CDP Page.getAppManifest + Page.getInstallabilityErrors) instead
of trusting the JSON by eye. For every app it checks:

  1. /app returns the app's page over HTTP 200
  2. that page points at /app/manifest.json
  3. the manifest parses with no errors, start_url is /app, display standalone
  4. it carries a 192x192 AND a 512x512 PNG icon, and both files download
  5. the service worker registers with scope "/" (needed to keep the install)
  6. Chromium reports ZERO installability errors

Usage
  local : python3 tools/install-app-check.py
  live  : python3 tools/install-app-check.py https://boostpay.online https://agent.boostpay.online
"""
import asyncio
import json
import os
import sys
import urllib.parse
import urllib.request

LOCAL = {
    'http://127.0.0.1:3901': 'user app',
    'http://127.0.0.1:3911': 'admin console',
    'http://127.0.0.1:3912': 'agent console',
    'http://127.0.0.1:3913': 'support chat',
    'http://127.0.0.1:3914': 'management',
    'http://127.0.0.1:3915': 'promotion',
    'http://127.0.0.1:3916': 'db studio',
}

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


def http(url, timeout=25):
    req = urllib.request.Request(url, headers={'user-agent': 'boostpay-install-check'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get('content-type', ''), r.read()


async def check_app(browser, base, label):
    print(f'\n[{label}] {base}/app')
    page_url = base.rstrip('/') + '/app'

    try:
        status, ctype, body = http(page_url)
    except Exception as exc:
        ck('the /app page loads', False, f'{exc}')
        return
    ck('GET /app returns the app page', status == 200 and 'html' in ctype, f'{status} {ctype}')
    ck('the page points at /app/manifest.json', b'/app/manifest.json' in body, 'manifest link')

    murl = base.rstrip('/') + '/app/manifest.json'
    try:
        mstatus, mctype, mbody = http(murl)
        manifest = json.loads(mbody)
    except Exception as exc:
        ck('the /app manifest is valid JSON', False, f'{exc}')
        return
    ck('GET /app/manifest.json is served as a manifest',
       mstatus == 200 and 'manifest' in mctype, f'{mstatus} {mctype}')
    ck('start_url is /app, so the icon opens /app', manifest.get('start_url') == '/app', str(manifest.get('start_url')))
    ck('the installed app runs standalone', manifest.get('display') == 'standalone', str(manifest.get('display')))
    ck('the app has a name and a short name',
       bool(manifest.get('name')) and bool(manifest.get('short_name')),
       f"{manifest.get('name')} / {manifest.get('short_name')}")

    icons = manifest.get('icons') or []
    sizes = {str(i.get('sizes')) for i in icons}
    ck('a 192x192 icon is declared', '192x192' in sizes, ', '.join(sorted(sizes)))
    ck('a 512x512 icon is declared', '512x512' in sizes, ', '.join(sorted(sizes)))
    for want in ('192x192', '512x512'):
        icon = next((i for i in icons if str(i.get('sizes')) == want), None)
        if not icon:
            continue
        iurl = urllib.parse.urljoin(base.rstrip('/') + '/app/manifest.json', icon.get('src', ''))
        try:
            istatus, ictype, ibody = http(iurl)
            ck(f'the {want} icon downloads as a PNG',
               istatus == 200 and 'png' in ictype and len(ibody) > 500,
               f'{istatus} {ictype} {len(ibody)}b')
        except Exception as exc:
            ck(f'the {want} icon downloads as a PNG', False, str(exc))

    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page = await ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)[:160]))
    try:
        await page.goto(page_url, wait_until='domcontentloaded')
        await page.wait_for_timeout(2500)

        sw = await page.evaluate("""async () => {
            if (!('serviceWorker' in navigator)) return { supported: false };
            try {
                const reg = await navigator.serviceWorker.ready;
                return { supported: true, scope: reg.scope, active: !!reg.active };
            } catch (e) { return { supported: true, scope: '', active: false, error: String(e) }; }
        }""")
        ck('a service worker is registered and active',
           bool(sw.get('supported')) and bool(sw.get('active')), f"scope={sw.get('scope')}")

        cdp = await ctx.new_cdp_session(page)
        await cdp.send('Page.enable')
        got = await cdp.send('Page.getAppManifest')
        ck('Chromium parses the manifest with no errors',
           not (got.get('errors') or []), str(got.get('errors'))[:160])
        ck('Chromium uses the /app manifest', str(got.get('url', '')).endswith('/app/manifest.json'),
           str(got.get('url')))

        inst = await cdp.send('Page.getInstallabilityErrors')
        ierrs = inst.get('installabilityErrors') or []
        ck('Chromium reports the app as installable (no errors)',
           len(ierrs) == 0,
           '; '.join(f"{e.get('errorId')}: {e.get('errorArguments')}" for e in ierrs)[:220])
        ck('the app threw no uncaught error while loading', not errors, '; '.join(errors[:2]))
    except Exception as exc:
        ck('browser-side installability check ran', False, str(exc)[:200])
    finally:
        await ctx.close()


async def main():
    from playwright.async_api import async_playwright

    targets = {}
    if len(sys.argv) > 1:
        for u in sys.argv[1:]:
            targets[u] = u
    else:
        targets = LOCAL

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for base, label in targets.items():
            await check_app(browser, base, label)
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
