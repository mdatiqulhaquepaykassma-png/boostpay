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

Tokens: the API token needs  Zone:DNS:Edit  +  Account:Access: Apps and Policies:Edit.
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


def call(path, method='GET', body=None, token=''):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method,
                               headers={'authorization': 'Bearer ' + token,
                                        'content-type': 'application/json'})
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


def do_dns(token, target):
    zid = zone_id(token)
    s, j = call(f'/zones/{zid}/dns_records?name={HOST}', token=token)
    rows = j.get('result') or []
    body = {'type': 'A', 'name': HOST, 'content': target, 'proxied': True, 'ttl': 1,
            'comment': 'promotion console (PWA)'}
    if rows:
        rid = rows[0]['id']
        s, j = call(f'/zones/{zid}/dns_records/{rid}', 'PUT', body, token=token)
        action = 'updated'
    else:
        s, j = call(f'/zones/{zid}/dns_records', 'POST', body, token=token)
        action = 'created'
    if s != 200:
        fail('DNS record could not be written', j.get('errors'))
    print(f'OK    DNS {HOST} {action} -> {target} (proxied)')


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dns', action='store_true')
    ap.add_argument('--access', action='store_true')
    ap.add_argument('--target', default='', help='IPv4 of the Dokploy server for the A record')
    ap.add_argument('--emails', action='append', default=[])
    ap.add_argument('--domain', action='append', default=[], help='allow every address on this domain')
    ap.add_argument('--name', default='BoostPay Promotion Console')
    a = ap.parse_args()
    token = os.environ.get('CF_API_TOKEN', '').strip()
    if not token:
        fail('CF_API_TOKEN is not set — export it for this shell only.')
    if not (a.dns or a.access):
        fail('nothing to do — pass --dns and/or --access')
    if a.dns:
        if not a.target:
            fail('--dns needs --target <server IPv4>')
        do_dns(token, a.target)
    if a.access:
        do_access(token, a.emails, a.domain, a.name)
    print('\nDone. Check https://one.dash.cloudflare.com/ for the Access app.')


if __name__ == '__main__':
    main()
