#!/usr/bin/env python3
"""
tools/seed-local-db.py — put a small, predictable dataset into the LOCAL dev
database so tools/regression.cjs can run. NEVER run this against production:
it only writes data/boostpay_db.json in this checkout.

  python3 tools/seed-local-db.py 100     # U1 balance $100 (with $90 lifetime profit)
  python3 tools/seed-local-db.py 0       # U1 empty (hold-above-balance cases)
  python3 tools/seed-local-db.py 10      # the "hold $10 on $10" case
"""
import json
import os
import sys
import time

balance = float(sys.argv[1]) if len(sys.argv) > 1 else 100.0
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
template_path = os.path.join(root, 'loadtest', 'template.json')
out_path = os.path.join(root, 'data', 'boostpay_db.json')

with open(template_path) as fh:
    doc = dict(json.load(fh))

now = int(time.time() * 1000)
cfg = doc['config']
cfg.setdefault('antifraud', {})
cfg['antifraud']['enabled'] = False
cfg['antifraud']['ipAutoBlockEnabled'] = False
cfg.pop('mfaEnabled', None)


def user(uid, bal, profit=0.0):
    return {
        'id': uid, 'balance': bal, 'lifetimeProfit': profit, 'boostProfitWithdrawn': 0,
        'phrase': 'p' + uid, 'password': 'Staging123!', 'passwordHash': '',
        'email': uid.lower() + '@gmail.com', 'createdAt': now - 86400000,
        'allowMessages': True, 'allowVoiceCall': True,
        'boostState': {'isActive': False, 'isPaused': False, 'startedAt': 0, 'pausedAt': 0,
                       'elapsedMs': 0, 'targetDurationMs': 60000,
                       'startingBalance': bal, 'accumulatedYield': 0},
    }


doc.update({
    'users': [user('U1', balance, 90.0 if balance else 0.0), user('U2', 10.0), user('U3', 50.0, 30.0)],
    'agents': [{'id': 'AGT-1', 'email': 'agent1@gmail.com', 'name': 'Agent One', 'balance': 10,
                'isActive': True, 'ownerManagementId': '', 'createdAt': now}],
    'conversations': [], 'messages': [], 'agentMessages': [],
    'transactions': [], 'notifications': [],
    'sessions': [{'id': 'SESS-' + u, 'userId': u, 'role': 'USER', 'ip': '127.0.0.1',
                  'userAgent': 'local', 'createdAt': now, 'lastSeenAt': now, 'revoked': False}
                 for u in ('U1', 'U2', 'U3')],
    'config': cfg,
})

os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'w') as fh:
    json.dump(doc, fh)

mfa = os.path.join(root, 'data', '.admin-mfa.json')
if os.path.exists(mfa):
    os.remove(mfa)

print(f'seeded local db: U1 balance ${balance}')
