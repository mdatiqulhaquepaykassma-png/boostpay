#!/usr/bin/env python3
"""
tools/cf-access-promotion.py — put Cloudflare in front of the promotion console.

Two separate, opt-in steps (nothing happens unless you ask for it):

    # 1. DNS only (A record, proxied)
    CF_API_TOKEN=... python3 tools/cf-access-promotion.py --dns --target 203.0.113.10

    # 2. Access (Zero Trust) on the host, allowing only these e-mails / domain
    CF_API_TOKEN=... python3 tools/cf-access-promotion.py --access \
        --emails you@example.com --emails team@example.com --domain boostpay.online

    # both at once
    CF_API_TOKEN=... python3 tools/cf-access-promotion.py --dns --target IP --access --emails you@example.com

Auth: `CF_API_TOKEN` (preferred) or `CF_API_EMAIL` + `CF_API_KEY`.
The API token needs  Zone:DNS:Edit  +  Account:Access: Apps and Policies:Edit.
Never pass the token on the command line in a shared shell — export it for that
shell only. The script never prints the token, and it prints IDs, not secrets.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = 'https://api.cloudflare.com/client/v4'
HOST = os.environ.get('CF_HOST', 'promotion.boostpay.online')
ZONE_NAME = os.environ.get('CF_ZONE', 'boostpay.online')


def auth_headers(token=''):
    """Bearer API token (preferred) or the legacy Global API Key + account e-mail."""
    if token:
        return {'authorization': 'Bearer ' + token}
    email = os.environ.get('CF_API_EMAIL', '').strip()
    key = os.environ.get('CF_API_KEY', '').strip()
    if email and key:
        return {'x-auth-email': email, 'x-auth-key': key}
    return {}


def call(path, method='GET', body=None, token=''):
    data = json.dumps(body).encode() if body is not None else None
    headers = auth_headers(token)
    headers['content-type'] = 'application/json'
    r = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as x:
            return x.status, json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}


def fail(msg, extra=None):
    print(f'FAIL  {msg}')
    if extra:
        print('      ', json.dumps(extra)[:400])
    sys.exit(1)


def zone_id(token):
    s, j = call(f'/zones?name={ZONE_NAME}', token=token)
    if s != 200 or not j.get('result'):
        fail('cannot read the zone — the token needs Zone:Read (or Zone:DNS:Edit) on ' + ZONE_NAME, j.get('errors'))
    return j['result'][0]['id']


def account_id(token):
    s, j = call('/accounts?per_page=5', token=token)
    if s != 200 or not j.get('result'):
        fail('cannot read accounts — the token needs Account:Access Apps and Policies:Edit', j.get('errors'))
    return j['result'][0]['id']


def do_dns(token, target, proxied=False):
    """Write the A record. `proxied=False` (grey cloud) on purpose: a brand-new
    host has no Let's Encrypt certificate yet, and Cloudflare answers 526 until
    Traefik has one. Flip it to orange once https works."""
    zid = zone_id(token)
    s, j = call(f'/zones/{zid}/dns_records?name={HOST}', token=token)
    rows = j.get('result') or []
    body = {'type': 'A', 'name': HOST, 'content': target, 'proxied': bool(proxied), 'ttl': 1,
            'comment': 'BoostPay console (PWA)'}
    if rows:
        rid = rows[0]['id']
        s, j = call(f'/zones/{zid}/dns_records/{rid}', 'PUT', body, token=token)
        action = 'updated'
    else:
        s, j = call(f'/zones/{zid}/dns_records', 'POST', body, token=token)
        action = 'created'
    if s != 200:
        fail('DNS record could not be written', j.get('errors'))
    print(f'OK    DNS {HOST} {action} -> {target} ({"proxied" if proxied else "DNS only — grey cloud"})')
    return (j.get('result') or {}).get('id')


def set_proxied(token, proxied: bool):
    zid = zone_id(token)
    s, j = call(f'/zones/{zid}/dns_records?name={HOST}', token=token)
    rows = j.get('result') or []
    if not rows:
        fail('there is no DNS record for ' + HOST)
    rid = rows[0]['id']
    body = {'type': 'A', 'name': HOST, 'content': rows[0]['content'],
            'proxied': bool(proxied), 'ttl': 1}
    s, j = call(f'/zones/{zid}/dns_records/{rid}', 'PATCH', body, token=token)
    if s != 200:
        fail('could not change the proxy status', j.get('errors'))
    print(f'OK    Cloudflare proxy {"ON (orange)" if proxied else "OFF (grey)"} for {HOST}')


def host_status(timeout=12):
    """GET https://HOST/api/health with the normal certificate check."""
    import ssl
    ctx = ssl.create_default_context()
    r = urllib.request.Request(f'https://{HOST}/api/health', headers={'user-agent': 'boostpay-verify'})
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=ctx) as x:
            return x.status, (x.read() or b'')[:120].decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, str(e)[:120]


def wait_for_cert(seconds=240):
    """Let's Encrypt needs the record to answer before it issues. Poll until the
    real certificate works, so we never flip the proxy on a host that would 526."""
    import time
    print(f'...   waiting up to {seconds}s for the certificate on {HOST}')
    for i in range(max(1, seconds // 10)):
        code, body = host_status()
        if code == 200:
            print(f'OK    https://{HOST}/api/health -> 200 {body[:60]}')
            return True
        time.sleep(10)
    print(f'WARN  https://{HOST} still not answering 200 — the proxy was left OFF; '
          f'fix the app/DNS and run with --proxied when it does')
    return False


def do_access(token, emails, domains, name):
    aid = account_id(token)
    s, j = call(f'/accounts/{aid}/access/apps', token=token)
    if s != 200:
        fail('cannot list Access apps — token needs Account:Access: Apps and Policies:Edit', j.get('errors'))
    existing = next((a for a in (j.get('result') or []) if a.get('domain') == HOST), None)
    app_body = {'name': name, 'domain': HOST, 'type': 'self_hosted',
                'session_duration': '24h', 'app_launcher_visible': False}
    if existing:
        app_id = existing['id']
        s, j = call(f'/accounts/{aid}/access/apps/{app_id}', 'PUT', app_body, token=token)
        state = 'updated'
    else:
        s, j = call(f'/accounts/{aid}/access/apps', 'POST', app_body, token=token)
        state = 'created'
        app_id = (j.get('result') or {}).get('id')
    if s != 200 or not app_id:
        fail('Access application could not be written', j.get('errors'))
    print(f'OK    Access app {HOST} {state} ({app_id})')

    include = []
    for e in emails or []:
        include.append({'email': {'email': e}})
    for d in domains or []:
        include.append({'email_domain': {'domain': d}})
    if not include:
        fail('no allowed e-mails/domains given — refusing to create a policy nobody can pass')

    pol_body = {'name': f'Allow {HOST}', 'decision': 'allow', 'include': include, 'exclude': [], 'require': []}
    s, j = call(f'/accounts/{aid}/access/apps/{app_id}/policies', token=token)
    pols = j.get('result') or []
    if pols:
        pid = pols[0]['id']
        s, j = call(f'/accounts/{aid}/access/apps/{app_id}/policies/{pid}', 'PUT', pol_body, token=token)
        pstate = 'updated'
    else:
        s, j = call(f'/accounts/{aid}/access/apps/{app_id}/policies', 'POST', pol_body, token=token)
        pstate = 'created'
    if s != 200:
        fail('Access policy could not be written', j.get('errors'))
    print(f'OK    policy {pstate}: allow {len(include)} rule(s)')
    print('      One-time PIN (e-mail OTP) works out of the box; add Google/OTP provider in Zero Trust if you want SSO.')




def verify(token, host=HOST):
    """Prove the credential works and print the account/zone state — never secrets."""
    mode = 'Global API Key' if (os.environ.get('CF_API_KEY') and not token) else 'API token'
    print(f'credential: {mode}')
    s, j = call('/user', token=token)
    who = (j.get('result') or {})
    if s == 200:
        print(f'OK    user: {who.get("email", "—")} ({who.get("id", "")[:8]}…)')
    else:
        print(f'...   /user -> {s} (a scoped token cannot read /user; that is fine)')
    s, j = call('/accounts?per_page=20', token=token)
    accts = j.get('result') or []
    if s != 200:
        fail('cannot list accounts — the credential lacks Account:Read', j.get('errors'))
    for a in accts[:5]:
        print(f'OK    account: {a.get("name")} ({a.get("id")})')
    s, j = call(f'/zones?name={ZONE_NAME}', token=token)
    zones = j.get('result') or []
    if s != 200 or not zones:
        fail(f'cannot read zone {ZONE_NAME}', j.get('errors'))
    z = zones[0]
    print(f'OK    zone: {z["name"]} ({z["id"]}) status={z.get("status")}')
    # DNS state of the target host
    zid = z['id']
    s, j = call(f'/zones/{zid}/dns_records?name={host}', token=token)
    rows = j.get('result') or []
    if rows:
        r = rows[0]
        print(f'OK    DNS {host} -> {r.get("content")} type={r.get("type")} proxied={r.get("proxied")}')
    else:
        print(f'MISS  DNS {host} has no record yet')
    # SSL mode
    s, j = call(f'/zones/{zid}/settings/ssl', token=token)
    if s == 200:
        print(f'OK    SSL mode: {(j.get("result") or {}).get("value")}')
    # Access / Zero Trust
    s, j = call('/accounts', token=token)
    if accts:
        aid = accts[0]['id']
        s, j = call(f'/accounts/{aid}/access/apps', token=token)
        if s == 200:
            apps = j.get('result') or []
            hit = [a for a in apps if a.get('domain') == host]
            print(f'OK    Access apps: {len(apps)} total, {1 if hit else 0} for {host}')
        else:
            print(f'WARN  Access API -> {s}: ' + str((j.get("errors") or [{}])[0].get("message", ""))[:110])
    # https reachability (informational)
    code, body = host_status()
    print(f'...   https://{host}/api/health -> {code} {body[:50]}')
    print('\ncredential verified. Nothing above is secret.')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dns', action='store_true')
    ap.add_argument('--access', action='store_true')
    ap.add_argument('--target', default='', help='IPv4 of the Dokploy server for the A record')
    ap.add_argument('--emails', action='append', default=[])
    ap.add_argument('--domain', action='append', default=[], help='allow every address on this domain')
    ap.add_argument('--name', default=os.environ.get('CF_APP_NAME', 'BoostPay Console'))
    ap.add_argument('--proxied', action='store_true', help='write/turn ON the orange cloud')
    ap.add_argument('--no-proxied', action='store_true', help='write/turn OFF the orange cloud (needed before the first certificate)')
    ap.add_argument('--wait-cert', action='store_true', help='poll https until the certificate works')
    ap.add_argument('--verify', action='store_true', help='prove the stored credential works and print the state')
    ap.add_argument('--full', action='store_true',
                    help='the whole sequence: grey-cloud A record -> wait for the certificate -> proxy on -> verify -> Access')
    a = ap.parse_args()
    token = os.environ.get('CF_API_TOKEN', '').strip()
    if not token and not (os.environ.get('CF_API_EMAIL') and os.environ.get('CF_API_KEY')):
        fail('set CF_API_TOKEN (preferred), or CF_API_EMAIL + CF_API_KEY for the legacy global key.')
    if a.full:
        a.dns = True
        a.wait_cert = True
        if not a.emails and not a.domain:
            fail('--full needs --emails (or --domain) so Access has an allow policy')
        a.access = True
    if a.verify:
        verify(token)
        return
    if not (a.dns or a.access or a.proxied or a.no_proxied):
        fail('nothing to do — pass --full, or --dns/--access/--proxied')
    if a.dns:
        if not a.target:
            fail('--dns needs --target <server IPv4>')
        # with --full we start grey and switch after the certificate; otherwise
        # honour --proxied/--no-proxied (the historical default was proxied)
        do_dns(token, a.target, proxied=(a.proxied and not a.full) or (not a.full and not a.no_proxied and not a.wait_cert))
    if a.wait_cert:
        ok = wait_for_cert()
        if ok and a.full:
            set_proxied(token, True)
        elif not ok and a.full:
            fail('certificate never came up — the proxy stays OFF, nothing was locked behind a 526')
    elif a.proxied and not a.dns:
        set_proxied(token, True)
    elif a.no_proxied and not a.dns:
        set_proxied(token, False)
    if a.access:
        do_access(token, a.emails, a.domain, a.name)
    print('\nDone. Check https://one.dash.cloudflare.com/ for the Access app.')


if __name__ == '__main__':
    main()
