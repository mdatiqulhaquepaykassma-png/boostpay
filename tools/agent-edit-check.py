#!/usr/bin/env python3
"""
tools/agent-edit-check.py — editing an AGENT account (the people who sign in at
agent.boostpay.online) from BOTH consoles.

Owner request (2026-11-11):
  "management.boostpay.online theke agent er details edit kora jabe,
   agent.boostpay.online er details edit korte parbe — agent er name etc change
   kora jabe, admin panel theke and management theke."

What it proves, against the LOCAL stack:
  A. guard rails: duplicate email 409, short password 400, empty name 400,
     a non-Gmail email 400, another management's agent 403
  B. admin console (browser): Agents & Management → agent card → Edit details →
     rename → saved and shown
  C. management console (browser, 430 px): agent card → sheet → Edit details →
     rename + new password → saved
  D. the agent app follows: the new email/password sign in at agent.boostpay.online,
     the old ones do not, and a password change kills the live AGENT session
  E. disabling from the management console blocks the agent login

Run (root API :3901, admin :3911, management :3931):
  LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu \
    python3 tools/agent-edit-check.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

API = 'http://127.0.0.1:3901'
ADMIN_URL = os.environ.get('ADMIN_URL', 'http://127.0.0.1:3911')
MGMT_URL = os.environ.get('MGMT_URL', 'http://127.0.0.1:3931')
ADMIN = {'email': os.environ.get('ADMIN_EMAIL', 'admin@boostpay.local'),
         'password': os.environ.get('ADMIN_PASSWORD', 'AdminPass123')}
TAG = str(int(time.time()))[-5:]
PASS, FAIL = [], []
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'report-assets')


def gmail(local):
    return f'{local}@gmail.com'


A_LOCAL = f'bpagent{TAG}'
B_LOCAL = f'bpagentB{TAG}'
MGMT_LOCAL = f'bpmgmt{TAG}'
MGMT_PW = 'MgmtPass123!'
AGENT_PW = 'AgentPass123!'


def wait_text(page, needle, timeout=45):
    """Poll until the rendered console contains `needle` (both consoles load over XHR)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if needle in page.locator('body').inner_text():
                return True
        except Exception:
            pass                      # the SPA was mid-navigation — just try again
        time.sleep(0.7)
    return False


def ck(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else '  → ' + str(detail)[:200]))


def api(path, body=None, tok=None, method=None):
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                               method=method or ('POST' if body is not None else 'GET'))
    r.add_header('Content-Type', 'application/json')
    if tok:
        r.add_header('Authorization', 'Bearer ' + tok)
    try:
        with urllib.request.urlopen(r, timeout=20) as x:
            return x.status, json.loads(x.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def agent_login(email, pw):
    return api('/api/agent/login', {'email': email, 'password': pw})


# ── fixtures ────────────────────────────────────────────────────────────────
s, j = api('/api/admin/login', ADMIN)
admin = j.get('token')
ck('admin login', bool(admin), j)

s, j = api('/api/admin/management', {'email': MGMT_LOCAL, 'password': MGMT_PW, 'name': 'Edit Ops'}, admin)
ck('management account created', s in (200, 201, 409), j)
mgmt_id = (j.get('management') or {}).get('id')
s, j = api('/api/management/login', {'email': gmail(MGMT_LOCAL), 'password': MGMT_PW})
mgmt = j.get('token')
ck('management login', bool(mgmt), j)

# management-A agent, created the way an operator creates one
s, j = api('/api/management/agents', {'name': 'Agent One', 'email': A_LOCAL, 'password': AGENT_PW}, mgmt)
agent_id = (j.get('agent') or {}).get('id')
ck('agent account created by management', s == 200 and bool(agent_id), j)

# a second agent (for the duplicate-email check)
s, j = api('/api/management/agents', {'name': 'Agent Two', 'email': B_LOCAL, 'password': AGENT_PW}, mgmt)
agent2_id = (j.get('agent') or {}).get('id')
ck('second agent created', s == 200 and bool(agent2_id), j)

# ── A. guard rails ──────────────────────────────────────────────────────────
s, j = api(f'/api/management/agents/{agent_id}', {'email': B_LOCAL}, mgmt, method='PATCH')
ck('an email already used by another agent is refused (409)', s == 409, j)

s, j = api(f'/api/management/agents/{agent_id}', {'password': '12345'}, mgmt, method='PATCH')
ck('a password shorter than 6 is refused', s == 400, j)

s, j = api(f'/api/management/agents/{agent_id}', {'name': '  '}, mgmt, method='PATCH')
ck('an empty name is refused', s == 400, j)

s, j = api(f'/api/management/agents/{agent_id}', {'email': 'someone@yahoo.com'}, mgmt, method='PATCH')
ck('a non-Gmail login email is refused', s == 400, j)

# another management's agent must stay untouchable
s, j = api('/api/admin/management', {'email': f'bpmgmtOther{TAG}', 'password': MGMT_PW, 'name': 'Other Ops'}, admin)
s, j = api('/api/management/login', {'email': gmail(f'bpmgmtOther{TAG}'), 'password': MGMT_PW})
other = j.get('token')
s, j = api(f'/api/management/agents/{agent_id}', {'name': 'Hijack'}, other, method='PATCH')
ck("another management cannot edit this agent (403)", s == 403, j)

# ── D (api half). the agent app follows the data ────────────────────────────
s, j = agent_login(gmail(A_LOCAL), AGENT_PW)
ck('agent app: the original credentials sign in', s == 200 and bool(j.get('token')), j)
live_tok = j.get('token')

# admin renames + changes the email
new_local = f'bpagentNEW{TAG}'
s, j = api(f'/api/admin/agents/{agent_id}',
           {'name': f'Renamed By Admin {TAG}', 'email': gmail(new_local)}, admin, method='PATCH')
ck('admin: name + email saved', s == 200 and {'name', 'email'} <= set(j.get('changes') or []), j)
s, j = api('/api/agent/me', tok=live_tok)
ck('admin: the email change killed the live agent session', s in (401, 403), j)
s, j = agent_login(gmail(A_LOCAL), AGENT_PW)
ck('agent app: the old email no longer signs in', s == 401, j)
s, j = agent_login(gmail(new_local), AGENT_PW)
ck('agent app: the new email signs in with the same password', s == 200, j)
sess_tok = j.get('token')
s, j = api('/api/agent/me', tok=sess_tok)
ck('agent app: the profile shows the admin-set name', (j.get('agent') or {}).get('name') == f'Renamed By Admin {TAG}', j.get('agent'))

# management sets a new password
NEW_PW = 'MgmtSetPass789!'
s, j = api(f'/api/management/agents/{agent_id}', {'password': NEW_PW}, mgmt, method='PATCH')
ck('management: a new password is accepted', s == 200 and any('password' in c for c in (j.get('changes') or [])), j)
s, j = api('/api/agent/me', tok=sess_tok)
ck('management: the password change killed the live agent session', s in (401, 403), j)
s, j = agent_login(gmail(new_local), AGENT_PW)
ck('agent app: the old password is dead', s == 401, j)
s, j = agent_login(gmail(new_local), NEW_PW)
ck('agent app: the new password signs in', s == 200, j)

# ── B. admin console ────────────────────────────────────────────────────────
with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []

    page = b.new_page(viewport={'width': 1400, 'height': 950})
    page.on('pageerror', lambda e: errs.append('admin: ' + str(e)[:160]))
    page.goto(ADMIN_URL, wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    page.fill('input[type=email]', ADMIN['email'])
    page.fill('input[type=password]', ADMIN['password'])
    page.keyboard.press('Enter')
    page.wait_for_timeout(3500)
    page.click('text=Agents & Management')
    page.wait_for_timeout(4500)
    _t = page.locator('body').inner_text()
    ck('admin: the agent list loads', wait_text(page, gmail(new_local).lower()),
       _t[:400])

    admin_name = f'Edited By Admin {TAG}'
    # open the editor on the card that belongs to THIS agent (not the first card)
    card = page.locator('div').filter(has_text=gmail(new_local).lower()).filter(has_text='Edit details').last
    card.locator('button:has-text("Edit details")').first.click()
    page.wait_for_timeout(700)
    ck('admin: the Edit details panel opens', page.locator('text=This agent signs in at agent.boostpay.online').count() > 0)
    page.fill('input[value^="Renamed By Admin"]', admin_name)
    page.locator('text=New password (blank = unchanged)').first.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(SHOTS, 'admin-agent-edit.png'))
    page.click('button:has-text("Save")')
    page.wait_for_timeout(2500)
    ck('admin: the new name appears in the list', wait_text(page, admin_name),
       page.locator('body').inner_text()[:200])

    # ── C/E. management console ─────────────────────────────────────────────
    m = b.new_page(viewport={'width': 430, 'height': 950})
    m.on('pageerror', lambda e: errs.append('mgmt: ' + str(e)[:160]))
    m.goto(MGMT_URL, wait_until='domcontentloaded')
    m.wait_for_timeout(2500)
    m.fill('input[placeholder="mgrname"]', MGMT_LOCAL)
    m.fill('input[type=password]', MGMT_PW)
    m.keyboard.press('Enter')
    m.wait_for_timeout(3500)
    m.get_by_role('button', name='Agents', exact=True).last.click()
    # the first agent now carries the name the ADMIN saved, the second is still "Agent Two"
    ck('management: the agent list shows both agents',
       wait_text(m, admin_name) and wait_text(m, 'Agent Two'), m.locator('body').inner_text()[:200])

    m.locator(f'button:has-text("{admin_name}")').first.click()
    m.wait_for_timeout(1200)
    ck('management: the agent sheet opens', m.locator('text=Agent password').count() > 0)
    m.locator('button:has-text("Edit details")').first.click()
    m.wait_for_timeout(700)
    ck('management: the inline editor opens', m.locator('text=Changing the email or the password signs them out').count() > 0)
    mgmt_name = f'Edited By Mgmt {TAG}'
    m.fill('input[placeholder="Agent name"]', mgmt_name)
    m.fill('input[placeholder="New password (min 6)"]', 'FinalPass321!')
    m.screenshot(path=os.path.join(SHOTS, 'management-agent-edit.png'), full_page=True)
    m.click('button:has-text("Save")')
    m.wait_for_timeout(2500)
    ck('management: the sheet shows the new name', wait_text(m, mgmt_name),
       m.locator('body').inner_text()[:300])

    s, j = agent_login(gmail(new_local), 'FinalPass321!')
    ck('agent app: the password saved from the management console works', s == 200, j)
    s2, j2 = api('/api/agent/me', tok=j.get('token'))
    ck('agent app: the name management saved is what the agent sees', (j2.get('agent') or {}).get('name') == mgmt_name, j2.get('agent'))

    m.locator('button:has-text("Disable agent account")').first.click()
    m.wait_for_timeout(2000)
    s, j = agent_login(gmail(new_local), 'FinalPass321!')
    ck('management: Disable blocks the agent login', s == 403, j)
    m.screenshot(path=os.path.join(SHOTS, 'management-agent-disabled.png'))
    ck('no uncaught page errors in either console', not errs, errs[:2])
    b.close()

print(f"\n{len(PASS)} pass / {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
