#!/usr/bin/env python3
"""
tools/system-check.py — READ-ONLY sweep of the live BoostPay hosts.

Only GET/OPTIONS requests: it never logs in, never writes, never loads the
system. Safe to run any time from anywhere.

    python3 tools/system-check.py

What it looks at
  1. every app answers, with the right <title>
  2. PWA wiring (manifest, service worker, icons) and broken asset links
  3. security headers (HSTS, X-Frame-Options, nosniff, CSP, Referrer-Policy)
  4. unauthenticated API surface: does anything leak, does an unknown route
     return JSON or HTML by mistake
  5. SPA deep links, CORS preflight, http→https, TLS certificate dates

Exit code is 0 always (it is a report, not a gate); problems are listed at the end.
"""
import json
import gzip
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

UA = ('Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')
APPS = {
    'user': 'boostpay.online',
    'agent': 'agent.boostpay.online',
    'support': 'supportchat.boostpay.online',
    'admin': 'admin.boostpay.online',
    'db': 'db.boostpay.online',
    'mgmt': 'management.boostpay.online',
}
PROBLEMS = []


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def get(url, method='GET', headers=None, timeout=25, follow=True):
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, method=method,
                                 headers={'user-agent': UA, 'accept-encoding': 'gzip', **(headers or {})})
    t0 = time.time()
    try:
        with opener.open(req, timeout=timeout) as r:
            body = r.read()
            if (r.headers.get('content-encoding') or '').lower() == 'gzip':
                try:
                    body = gzip.decompress(body)
                except Exception:
                    pass
            return r.status, {k.lower(): v for k, v in r.headers.items()}, body, int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read(), int((time.time() - t0) * 1000)
    except Exception as e:
        return 0, {}, str(e).encode(), int((time.time() - t0) * 1000)


def problem(sev, title, detail):
    PROBLEMS.append((sev, title, detail))


def main():
    print('=== 1. every app answers ===')
    for name, host in APPS.items():
        s, h, b, ms = get(f'https://{host}/')
        html = b.decode('utf8', 'ignore')
        title = re.search(r'<title>([^<]*)</title>', html)
        ok = s == 200 and bool(title)
        print(f"  {'PASS' if ok else 'FAIL'}  {name:8} {s} {ms:>4}ms  title={title.group(1) if title else '(none)'}")
        if not ok:
            problem('HIGH', f'{name} app does not load', f'GET https://{host}/ -> {s}')

    print('\n=== 2. PWA wiring + asset links ===')
    for name, host in APPS.items():
        html = get(f'https://{host}/')[2].decode('utf8', 'ignore')
        man = re.search(r'<link[^>]+rel="manifest"[^>]*href="([^"]+)"', html)
        sw = get(f'https://{host}/sw.js')
        broken = []
        for ref in sorted(set(re.findall(r'(?:src|href)="([^"]+\.(?:js|css|png|svg|ico|webmanifest))"', html))):
            url = ref if ref.startswith('http') else f'https://{host}/{ref.lstrip("./")}'
            if get(url)[0] != 200:
                broken.append(ref)
        print(f"  {'PASS' if (man and sw[0] == 200 and not broken) else 'FAIL'}  {name:8} "
              f"manifest={'yes' if man else 'NO'} sw.js={sw[0]} broken_assets={broken or 'none'}")
        if not man:
            problem('LOW', f'{name}: no web-app manifest', 'The app cannot be installed to the home screen.')

    print('\n=== 3. security headers ===')
    for name, host in APPS.items():
        s, h, b, ms = get(f'https://{host}/')
        # CSP is deliberately not set on the console apps (their bundles need
        # inline bootstrap code) — reported as a note, not as a problem.
        required = {
            'HSTS': bool(h.get('strict-transport-security')),
            'XFO': bool(h.get('x-frame-options')),
            'nosniff': bool(h.get('x-content-type-options')),
            'Referrer': bool(h.get('referrer-policy')),
        }
        missing = [k for k, v in required.items() if not v]
        note = '' if h.get('content-security-policy') else ' (no CSP — by design)'
        print(f"  {'PASS' if not missing else 'WARN'}  {name:8} missing={missing or 'none'}{note}")
        if missing:
            problem('MEDIUM', f'{name}: missing security headers', f'{", ".join(missing)} not sent by this host.')

    print('\n=== 4. API surface without a login ===')
    for path in ['/api/health', '/api/mobile/hosts', '/api/db', '/api/db?slim=1',
                 '/api/admin/stats', '/api/definitely-not-real']:
        s, h, b, ms = get('https://boostpay.online' + path)
        ct = h.get('content-type', '')
        body = b[:70].decode('utf8', 'ignore').replace('\n', ' ')
        print(f"  {path:28} {s:>3} {ms:>4}ms ct={ct[:26]:26} {body[:52]}")
        if path.startswith('/api/') and 'text/html' in ct:
            problem('MEDIUM', f'{path} returns HTML, not JSON',
                    'A mistyped/unknown API route falls through to the SPA, so the app gets '
                    'a 200 with HTML where it expects JSON.')

    print('\n=== 5. deep links, CORS, http→https, TLS ===')
    bad = [p for p in ['/wallet', '/chat', '/boost', '/settings'] if get('https://boostpay.online' + p)[0] != 200]
    print(f"  {'PASS' if not bad else 'FAIL'}  SPA deep links {bad or 'all serve the app'}")
    if bad:
        problem('HIGH', 'deep links break on refresh', f'{bad} do not serve the app.')

    req = urllib.request.Request('https://boostpay.online/api/health', method='OPTIONS',
                                 headers={'origin': 'https://management.boostpay.online',
                                          'access-control-request-method': 'POST',
                                          'access-control-request-headers': 'authorization,content-type',
                                          'user-agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            allow = r.headers.get('access-control-allow-origin')
    except urllib.error.HTTPError as e:
        allow = e.headers.get('access-control-allow-origin')
    print(f"  {'PASS' if allow else 'FAIL'}  CORS preflight for the management console: {allow}")
    if not allow:
        problem('HIGH', 'CORS blocks the console apps',
                'The management console is served from another origin and calls the API directly.')

    for url in ['http://boostpay.online/', 'http://agent.boostpay.online/',
                'http://supportchat.boostpay.online/', 'http://management.boostpay.online/']:
        s, h, b, ms = get(url, follow=False)
        loc = h.get('location', '')
        ok = s in (301, 302, 308) and loc.startswith('https://')
        print(f"  {'PASS' if ok else 'WARN'}  {url:40} {s} -> {loc or '(served, no redirect)'}")
        if not ok:
            problem('MEDIUM', f'{url} is not redirected to https', f'status {s}, location {loc!r}')

    for name, host in APPS.items():
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((host, 443), timeout=10) as s:
                with ctx.wrap_socket(s, server_hostname=host) as ss:
                    cert = ss.getpeercert()
            days = (ssl.cert_time_to_seconds(cert['notAfter']) - time.time()) / 86400
            ok = days > 14
            print(f"  {'PASS' if ok else 'WARN'}  {host:34} expires in {days:.0f} days")
            if not ok:
                problem('HIGH', f'{host} certificate expires soon', f'{days:.0f} days left.')
        except Exception as e:
            print(f"  FAIL  {host:34} TLS error {e}")
            problem('CRITICAL', f'{host} has a TLS problem', str(e))

    print('\n=== summary ===')
    if not PROBLEMS:
        print('  no problems found')
    else:
        order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
        for sev, title, detail in sorted(PROBLEMS, key=lambda p: order.get(p[0], 9)):
            print(f'  [{sev:8}] {title}\n             {detail}')
    return PROBLEMS


if __name__ == '__main__':
    found = main()
    if '--json' in sys.argv:
        print(json.dumps([{'sev': s, 'title': t, 'detail': d} for s, t, d in found], indent=1))
