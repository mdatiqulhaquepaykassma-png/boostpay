#!/usr/bin/env python3
"""Build a production-shaped data document at N times the current prod size.
Shape is taken from the real INITIAL_DB literal in server.ts (template.json)."""
import json, random, sys, time
random.seed(1234)
USERS = int(sys.argv[1]); TX_PER_USER = int(sys.argv[2]); MSG_CONVS = int(sys.argv[3]); OUT = sys.argv[4]
tpl = json.load(open('/home/user/loadtest/template.json'))
now = int(time.time()*1000)
cfg = tpl['config']
# staging only: the load generator is a single IP, so fraud controls would fire
# and the test would measure the antifraud engine instead of capacity.
cfg['antifraud']['enabled'] = False
cfg['antifraud']['ipAutoBlockEnabled'] = False
cfg['antifraud']['ipBlockEnabled'] = False
cfg['antifraud']['features'] = {k: False for k in cfg['antifraud']['features']}

WORDS = "alpha beacon crypto dynamic ember falcon galaxy harbor impact jupiter kinetic legacy".split()
users, sessions, txs, notifs = [], [], [], []
TYPES = ['REWARD','DEPOSIT','WITHDRAW','TRANSFER_IN','TRANSFER_OUT']
for i in range(1, USERS+1):
    uid = f'U{i:05d}'
    bal = round(random.uniform(5, 500), 2)
    users.append({
        'id': uid, 'balance': bal, 'lifetimeProfit': round(bal*random.uniform(0,0.3),2),
        'phrase': ' '.join(random.sample(WORDS, 12)) + f' {i}',
        'password': 'Staging123!', 'email': f's{ i:05d}@gmail.com',
        'createdAt': now - random.randint(1, 90)*86400000,
        'boostState': {'isActive': False, 'isPaused': False, 'startedAt': 0, 'pausedAt': 0,
                       'elapsedMs': 0, 'targetDurationMs': 86400000,
                       'startingBalance': bal, 'accumulatedYield': 0},
    })
    sessions.append({'id': f'SESS-S{i}', 'userId': uid, 'role': 'USER', 'ip': '10.9.9.9',
                     'userAgent': 'staging-loadtest', 'createdAt': now, 'lastSeenAt': now, 'revoked': False})
    for k in range(TX_PER_USER):
        txs.append({'id': f'TX-{i:05d}{k:03d}', 'userId': uid, 'type': TYPES[(i+k) % len(TYPES)],
                    'amount': round(random.uniform(0.5, 120), 2),
                    'timestamp': now - (k*3600000 + random.randint(0, 60000)),
                    'notes': 'staging seed'})
    notifs.append({'id': f'NOTIF-{i:05d}', 'userId': uid, 'type': 'YIELD_REWARD', 'title': 'BOOSTPAY-ALERTS',
                   'message': 'YIELD ALERT: staging seed notification', 'amount': 0,
                   'referenceId': f'TX-{i:05d}000', 'timestamp': now-3600000, 'isRead': True,
                   'metadata': {'balanceAfter': bal}})
txs.sort(key=lambda t: -t['timestamp'])
convs, msgs = [], []
for c in range(MSG_CONVS):
    a, b = (c*2) % USERS + 1, (c*2+1) % USERS + 1
    cid = f'CONV-U{a:05d}-U{b:05d}'
    convs.append({'id': cid, 'participants': [f'U{a:05d}', f'U{b:05d}'], 'createdAt': now-86400000,
                  'updatedAt': now-3600000, 'lastMessageAt': now-3600000})
    for m in range(12):
        msgs.append({'id': f'MSG-{c:04d}-{m:02d}', 'conversationId': cid,
                     'senderId': f'U{a:05d}' if m % 2 == 0 else f'U{b:05d}',
                     'text': f'seed message {m}', 'timestamp': now - (12-m)*600000, 'read': True})
doc = dict(tpl)
doc.update({'users': users, 'sessions': sessions, 'transactions': txs, 'conversations': convs,
            'messages': msgs, 'notifications': notifs, 'config': cfg})
json.dump(doc, open(OUT, 'w'), separators=(',', ':'))
print(f"users={len(users)} tx={len(txs)} msgs={len(msgs)} convs={len(convs)} sessions={len(sessions)} "
      f"bytes={len(json.dumps(doc, separators=(',',':')))}")
