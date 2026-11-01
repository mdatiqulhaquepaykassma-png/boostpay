#!/usr/bin/env python3
"""
tools/cloudflare-setup.py — BoostPay zone setup via the Cloudflare API v4.

Never run this without reading the plan first: every command is DRY-RUN unless
you pass `--apply`.

Environment
  CF_API_TOKEN   Cloudflare API token. Needs exactly these permissions:
                   Zone → Zone → Read
                   Zone → DNS → Edit
                   Zone → Zone Settings → Edit
                   Zone → Cache Rules → Edit   (a.k.a. Zone → Config → Edit)
                   Zone → Rulesets → Read      (listed for completeness)
                 Scope it to boostpay.online (Zone Resources → Include → Specific zone).
  CF_ZONE        zone name, default boostpay.online

Usage
  python3 tools/cloudflare-setup.py status            # token + zone + current settings
  python3 tools/cloudflare-setup.py dns --apply       # A/CNAME records, proxied
  python3 tools/cloudflare-setup.py settings --apply  # SSL/TLS, HTTP3, Rocket Loader OFF …
  python3 tools/cloudflare-setup.py rules --apply     # cache rules: /api bypass, /assets 1y
  python3 tools/cloudflare-setup.py verify            # post-nameserver-switch checks

Safety: the token is only ever read from the environment, never printed, never
written to disk. Nothing here changes nameservers — that is a registrar action.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = 'https://api.cloudflare.com/client/v4'
ZONE_NAME = os.environ.get('CF_ZONE', 'boostpay.online')
ORIGIN_IP = '72.60.42.18'
APPLY = '--apply' in sys.argv


def token():
    t = os.environ.get('CF_API_TOKEN', '').strip()
    if not t:
        sys.exit('CF_API_TOKEN is not set — paste it into the environment for this shell only.')
    return t


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header('Authorization', 'Bearer ' + token())
    req.add_header('Content-Type', 'application/json')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf8', 'ignore')
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {'errors': [{'message': raw[:300]}]}
        return {'success': False, 'errors': parsed.get('errors') or parsed, 'status': e.code}


def need(ok, what):
    if not ok.get('success'):
        sys.exit(f'✗ {what} failed: {json.dumps(ok.get("errors"))[:400]}')
    return ok


def zone_id():
    r = need(call('GET', f'/zones?name={ZONE_NAME}'), 'zone lookup')
    if not r.get('result'):
        sys.exit(f'✗ zone {ZONE_NAME} not found on this token. Add the site in the Cloudflare '
                 f'dashboard first (Add a site → Free), then run again.')
    z = r['result'][0]
    print(f'zone: {z["name"]}  id={z["id"]}  status={z["status"]}  plan={z["plan"]["name"]}')
    print(f'nameservers Cloudflare assigned: {", ".join(z.get("name_servers", []))}')
    return z['id']


# ── 1. DNS ────────────────────────────────────────────────────────────────────
DESIRED_DNS = [
    ('A', '@', ORIGIN_IP, True),
    ('A', 'supportchat', ORIGIN_IP, True),
    ('CNAME', 'www', ZONE_NAME, True),
]


def cmd_dns(zid):
    cur = need(call('GET', f'/zones/{zid}/dns_records?per_page=100'), 'list dns')['result']
    have = {(r['type'], r['name']): r for r in cur}
    for rtype, name, content, proxied in DESIRED_DNS:
        fqdn = ZONE_NAME if name == '@' else f'{name}.{ZONE_NAME}'
        existing = have.get((rtype, fqdn))
        if existing:
            wants = existing['content'] == content and bool(existing.get('proxied')) == proxied
            print(f'  {"OK  " if wants else "EDIT"} {rtype:5} {fqdn:34} → {existing["content"]:15} '
                  f'proxied={existing.get("proxied")}')
            if not wants and APPLY:
                need(call('PUT', f'/zones/{zid}/dns_records/{existing["id"]}',
                          {'type': rtype, 'name': fqdn, 'content': content, 'proxied': proxied, 'ttl': 1}),
                     f'update {fqdn}')
                print(f'       updated → {content} proxied={proxied}')
        else:
            print(f'  NEW  {rtype:5} {fqdn:34} → {content:15} proxied={proxied}')
            if APPLY:
                need(call('POST', f'/zones/{zid}/dns_records',
                          {'type': rtype, 'name': fqdn, 'content': content, 'proxied': proxied, 'ttl': 1}),
                     f'create {fqdn}')


# ── 2. Zone settings ──────────────────────────────────────────────────────────
DESIRED_SETTINGS = {
    'ssl': 'strict',                    # Full (strict): origin cert must be valid
    'always_use_https': 'on',
    'min_tls_version': '1.2',
    'tls_1_3': 'on',
    'http3': 'on',
    'brotli': 'on',
    '0rtt': 'off',                      # 0-RTT replay risk on POST /api*
    'rocket_loader': 'off',             # ← breaks React apps, must stay OFF
    'websockets': 'on',                 # calls need it
    'browser_cache_ttl': 0,             # respect origin headers (we set immutable ourselves)
    'ipv6': 'on',
}


def cmd_settings(zid):
    for name, want in DESIRED_SETTINGS.items():
        r = call('GET', f'/zones/{zid}/settings/{name}')
        cur = r['result']['value'] if r.get('success') and r.get('result') else '(unsupported)'
        same = str(cur) == str(want)
        print(f'  {"OK  " if same else "SET "} {name:22} {cur!r} → {want!r}')
        if not same and APPLY:
            u = call('PATCH', f'/zones/{zid}/settings/{name}', {'value': want})
            print(f'       {"updated" if u.get("success") else "FAILED: " + json.dumps(u.get("errors"))[:200]}')


# ── 3. Cache rules ────────────────────────────────────────────────────────────
PHASE = 'http_request_cache_settings'
RULES = [
    {
        'description': 'BoostPay: never cache the API (per-user data)',
        'expression': '(starts_with(http.request.uri.path, "/api/"))',
        'action': 'set_cache_settings',
        'action_parameters': {'cache': False},
        'enabled': True,
    },
    {
        'description': 'BoostPay: hashed assets cache 1 year at the edge',
        'expression': '(starts_with(http.request.uri.path, "/assets/"))',
        'action': 'set_cache_settings',
        'action_parameters': {
            'cache': True,
            'edge_ttl': {'mode': 'override_origin', 'default': 31536000},
            'browser_ttl': {'mode': 'respect_origin'},
        },
        'enabled': True,
    },
    {
        'description': 'BoostPay: HTML / service worker always revalidate',
        'expression': '(http.request.uri.path eq "/" or ends_with(http.request.uri.path, ".html") '
                      'or ends_with(http.request.uri.path, "/sw.js") '
                      'or ends_with(http.request.uri.path, "/manifest.webmanifest"))',
        'action': 'set_cache_settings',
        'action_parameters': {'cache': False},
        'enabled': True,
    },
]


def cmd_rules(zid):
    r = call('GET', f'/zones/{zid}/rulesets/phases/{PHASE}/entrypoint')
    existing = r.get('result', {}).get('rules', []) if r.get('success') else []
    print(f'  existing rules: {len(existing)}')
    for x in existing:
        print(f'    - {x.get("description", "")[:70]}')
    for rule in RULES:
        print(f'  WILL SET  {rule["description"]}')
    if APPLY:
        body = {'rules': RULES + [x for x in existing if not str(x.get('description', '')).startswith('BoostPay')]}
        out = call('PUT', f'/zones/{zid}/rulesets/phases/{PHASE}/entrypoint', body)
        need(out, 'cache rules')
        print('  ✓ cache rules applied')


# ── 4. Verify (after the nameservers are live) ────────────────────────────────
def cmd_verify():
    import urllib.request as u
    def head(url):
        # Cloudflare returns 403 to the bare "Python-urllib" signature, so identify
        # like the apps do (browser UA) — the check is about caching, not bots.
        req = u.Request(url, method='GET', headers={
            'accept-encoding': 'gzip',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        })
        with u.urlopen(req, timeout=25) as r:
            return dict(r.headers), r.status
    for path in ('/', '/api/health', '/assets/index-BdMWRXmr.js'):
        try:
            h, s = head(f'https://{ZONE_NAME}{path}')
            cf = h.get('cf-cache-status') or h.get('Cf-Cache-Status') or '(none)'
            print(f'  {path:28} {s}  cf-cache-status={cf}  server={h.get("Server") or h.get("server")}')
        except Exception as e:
            print(f'  {path:28} ERROR {e}')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'status'
    print(f'Cloudflare setup — mode: {"APPLY" if APPLY else "DRY RUN"}  zone: {ZONE_NAME}\n')
    if cmd == 'verify':
        return cmd_verify()
    zid = zone_id()
    print()
    if cmd == 'status':
        cmd_settings(zid)
        print()
        cmd_rules(zid)
    elif cmd == 'dns':
        cmd_dns(zid)
    elif cmd == 'settings':
        cmd_settings(zid)
    elif cmd == 'rules':
        cmd_rules(zid)
    else:
        sys.exit(f'unknown command {cmd}')
    if not APPLY:
        print('\n(dry run — add --apply to make changes)')


if __name__ == '__main__':
    main()
