#!/usr/bin/env python3
"""tools/seed-heavy.py — make U1 look like a long-time heavy user.

Used to measure the difference between a full `/api/db` payload and the slim
bootstrap. Adds 4,000 transactions / 3,000 notifications / 1,500 chats to U1
on top of whatever `seed-local-db.py` produced. Idempotent: it removes its own
previous rows (`*-heavy-*` ids) before inserting.

  python3 tools/seed-local-db.py 100 && python3 tools/seed-heavy.py
"""
import json, time, os, sys

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'boostpay_db.json')
now = int(time.time() * 1000)

db = json.load(open(DB))
uid = 'U1'
if not any(u.get('id') == uid for u in db.get('users', [])):
    sys.exit('U1 not found — run tools/seed-local-db.py first')

db['transactions'] = [t for t in db.get('transactions', []) if 'heavy-' not in str(t.get('id'))]
notifs_key = 'notifications'
db[notifs_key] = [n for n in db.get(notifs_key, []) if 'heavy-' not in str(n.get('id'))]
db['messages'] = [m for m in db.get('messages', []) if 'heavy-' not in str(m.get('id'))]

db['transactions'] += [{
    'id': f'TX-heavy-{i}', 'userId': uid, 'type': 'BOOST_PROFIT', 'amount': round(0.5 + (i % 7) * 0.25, 2),
    'timestamp': now - (i + 1) * 3600_000, 'notes': 'seeded history'
} for i in range(4000)]

db.setdefault(notifs_key, []).extend([{
    'id': f'N-heavy-{i}', 'userId': uid, 'title': 'Boost payout', 'body': f'Cycle {i} completed',
    'read': i > 20, 'createdAt': now - (i + 1) * 1800_000, 'timestamp': now - (i + 1) * 1800_000
} for i in range(3000)])

# Optional prod-like directory: `--users 140` adds U4..U140 with light history,
# so the FULL /api/db payload looks like a busy production database.
extra_users = 0
if '--users' in sys.argv:
    extra_users = int(sys.argv[sys.argv.index('--users') + 1])
db['users'] = [u for u in db['users'] if not str(u.get('id', '')).startswith('UF-')]
for i in range(4, 4 + max(0, extra_users - 3)):
    uid_i = f'UF-{i}'
    if not any(u.get('id') == uid_i for u in db['users']):
        db['users'].append({
            'id': uid_i, 'balance': 5.0, 'lifetimeProfit': 1.0, 'boostProfitWithdrawn': 0,
            'phrase': 'p' + uid_i, 'password': 'Staging123!', 'passwordHash': '',
            'email': uid_i.lower() + '@gmail.com', 'createdAt': now - 86400000,
            'allowMessages': True, 'allowVoiceCall': True,
            'boostState': {'isActive': False, 'isPaused': False, 'startedAt': 0, 'pausedAt': 0,
                           'elapsedMs': 0, 'targetDurationMs': 60000, 'startingBalance': 5.0, 'accumulatedYield': 0},
        })
    db['transactions'] += [{'id': f'TX-heavy-{uid_i}-{k}', 'userId': uid_i, 'type': 'BOOST_PROFIT',
                            'amount': 0.5, 'timestamp': now - (k + 1) * 7200_000, 'notes': 'seeded'} for k in range(40)]

db['conversations'] = [c for c in db.get('conversations', []) if str(c.get('id')) != 'CONV-heavy']
db['conversations'].append({
    'id': 'CONV-heavy', 'participants': [uid, 'SUPPORT'], 'type': 'SUPPORT',
    'createdAt': now - 9_000_000, 'lastMessageAt': now - 900_000
})
db['messages'] += [{
    'id': f'M-heavy-{i}', 'conversationId': 'CONV-heavy', 'senderId': 'SUPPORT', 'senderRole': 'SUPPORT', 'recipientId': uid, 'text': f'Support note {i}',
    'timestamp': now - (i + 1) * 900_000
} for i in range(1500)]

json.dump(db, open(DB, 'w'))
size = os.path.getsize(DB)
print(f'heavy seed ok — {size/1024/1024:.2f} MB, users={len(db["users"])}, tx={len(db["transactions"])}, notif={len(db[notifs_key])}, msg={len(db["messages"])}')
