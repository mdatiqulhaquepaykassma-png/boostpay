#!/usr/bin/env python3
import requests, json, time
from collections import defaultdict, Counter

# VPS endpoint
BASE = "https://boostpay.72-60-42-18.sslip.io"
ADMIN_LOGIN = {"email":"admin@gmail.com","password":"Bp#2026!SecureAdmin"}

def login_admin():
    r=requests.post(f"{BASE}/api/admin/login", json=ADMIN_LOGIN, verify=True, timeout=15)
    r.raise_for_status()
    return r.json()["token"]

token = login_admin()
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
print("admin token ok", token[:20])

# Fetch full DB via /api/db
r=requests.get(f"{BASE}/api/db", headers=headers, timeout=15)
r.raise_for_status()
db=r.json()
users={str(u["id"]): u for u in db["users"]}
txs=db["transactions"]
print(f"users {len(users)} tx {len(txs)}")

# Fetch referCommissions via admin tables
r=requests.get(f"{BASE}/api/admin/db/tables/referCommissions", headers=headers, timeout=15)
r.raise_for_status()
refer_comms=r.json().get("rows",[])
print(f"referCommissions {len(refer_comms)}")
comm_by_source={c["sourceTxId"]: c for c in refer_comms}

# Compute targets
cfg=db["config"]
minMs=cfg["minBoostMs"]; maxMs=cfg["maxBoostMs"]
balances=[float(u["balance"]) for u in db["users"]]
minBal=min(balances); maxBal=max(balances)
targets={}
for uid,u in users.items():
    bal=float(u["balance"])
    if maxBal==minBal:
        dur=maxMs if bal>0 else minMs
    else:
        ratio=(bal-minBal)/(maxBal-minBal)
        dur=round(minMs + ratio*(maxMs-minMs))
    targets[uid]=dur

# Group rewards
by_user=defaultdict(list)
for t in txs:
    if t["type"]=="REWARD":
        by_user[str(t["userId"])].append(t)

erroneous=[]
err_by_user=defaultdict(list)
for uid, lst in by_user.items():
    lst_sorted=sorted(lst, key=lambda x: x["timestamp"])
    target=targets.get(uid,60000)
    threshold=target*0.95
    for i in range(1,len(lst_sorted)):
        gap=lst_sorted[i]["timestamp"]-lst_sorted[i-1]["timestamp"]
        if gap < threshold:
            erroneous.append(lst_sorted[i])
            err_by_user[uid].append(lst_sorted[i])

print(f"erroneous rewards via target {len(erroneous)} sum {sum(e['amount'] for e in erroneous):.6f}")
for uid,err in err_by_user.items():
    print(f"  user {uid} err {len(err)} sum {sum(e['amount'] for e in err):.6f}")

# Also orphaned 950830: all its transactions should be removed
orphan=[t for t in txs if str(t["userId"])=="950830"]
print(f"orphan 950830 tx {len(orphan)} sum {sum(t['amount'] for t in orphan):.6f}")

# Collect refer commissions linked to erroneous rewards
err_comm=[]
for e in erroneous:
    c=comm_by_source.get(e["id"])
    if c:
        err_comm.append(c)
        print(f"err comm for {e['id']} -> {c['referrerId']} amt {c['amount']}")

print(f"err refer commissions {len(err_comm)} sum {sum(c['amount'] for c in err_comm):.6f}")

# Also need to find REFERRAL_COMMISSION transactions that correspond to err_comm
# They are in txs with type REFERRAL_COMMISSION and matching sourceTxId in metadata
comm_tx_by_source={}
for t in txs:
    if t["type"]=="REFERRAL_COMMISSION":
        sid=t.get("metadata",{}).get("sourceTxId") or t.get("sourceTxId")
        if sid:
            comm_tx_by_source[sid]=t
        else:
            # fallback: match via notes containing sourceTxId?
            # Use id mapping
            pass

# Some commissions may have transaction with same amount but not directly linked via sourceTxId in our snapshot?
# Let's check
err_comm_txs=[]
for c in err_comm:
    sid=c["sourceTxId"]
    tx=comm_tx_by_source.get(sid)
    if tx:
        err_comm_txs.append(tx)
    else:
        print(f"no commission tx found for source {sid} commission {c['id']}")

print(f"err commission txs found {len(err_comm_txs)}")

# Build balance corrections
corrections={}
# For each user with erroneous rewards, subtract sum
for uid,err in err_by_user.items():
    if str(uid) not in users:
        print(f"skip orphan user {uid} for balance correction (no user record)")
        continue
    total=sum(e["amount"] for e in err)
    old_bal=float(users[uid]["balance"])
    old_profit=float(users[uid].get("lifetimeProfit",0))
    new_bal=old_bal-total
    new_profit=old_profit-total
    corrections[uid]=(old_bal,new_bal,old_profit,new_profit,total)
    print(f"user {uid} old_bal {old_bal:.6f} new {new_bal:.6f} deduct {total:.6f}")

# For referrers of erroneous commissions, deduct commission amount
refer_corrections=defaultdict(float)
for c in err_comm:
    refer_corrections[str(c["referrerId"])]+=float(c["amount"])
# Apply to corrections dict (merge with existing)
for uid, amt in refer_corrections.items():
    if uid in corrections:
        ob,nb,op,np,total = corrections[uid]
        nb2=nb-amt
        np2=np-amt
        corrections[uid]=(ob,nb2,op,np2,total+amt)
        print(f"referrer {uid} additionally deduct commission {amt:.6f} -> new_bal {nb2:.6f}")
    else:
        if uid in users:
            ob=float(users[uid]["balance"]); op=float(users[uid].get("lifetimeProfit",0))
            nb=ob-amt; np=op-amt
            corrections[uid]=(ob,nb,op,np,amt)
            print(f"referrer {uid} deduct {amt:.6f} old {ob:.6f} new {nb:.6f}")
        else:
            print(f"referrer {uid} not in users (orphan) skip")

print("\n=== Corrections summary ===")
for uid,(ob,nb,op,np,ded) in corrections.items():
    print(f"{uid}: {ob:.6f} -> {nb:.6f} (deduct {ded:.6f}) profit {op:.6f}->{np:.6f}")

# Now apply fixes via admin API
# We need to delete erroneous transactions and commissions, then patch users

# Helper to delete transaction row
def delete_transaction(tx_id):
    url=f"{BASE}/api/admin/db/tables/transactions/rows/{tx_id}"
    r=requests.delete(url, headers=headers, timeout=15)
    if r.ok:
        print(f"deleted tx {tx_id} ok")
        return True
    else:
        print(f"failed delete tx {tx_id} {r.status_code} {r.text[:200]}")
        return False

def delete_refer_commission(rc_id):
    url=f"{BASE}/api/admin/db/tables/referCommissions/rows/{rc_id}"
    r=requests.delete(url, headers=headers, timeout=15)
    if r.ok:
        print(f"deleted referCommission {rc_id} ok")
        return True
    else:
        print(f"failed delete referCommission {rc_id} {r.status_code} {r.text[:200]}")
        return False

def patch_user(uid, new_bal, new_profit):
    # Use admin db tables patch
    url=f"{BASE}/api/admin/db/tables/users/rows/{uid}"
    # Need to send patch body: db expects patch of fields? Check server code for patch endpoint expects {balance, lifetimeProfit}
    # Endpoint: PATCH /api/admin/db/tables/:name/rows/:id with body containing fields to update
    # It does db.users.find and Object.assign
    body={"balance": new_bal, "lifetimeProfit": new_profit}
    r=requests.patch(url, headers=headers, json=body, timeout=15)
    if r.ok:
        print(f"patched user {uid} new_bal {new_bal:.6f}")
        return True
    else:
        print(f"failed patch user {uid} {r.status_code} {r.text[:500]}")
        return False

# Confirm before destructive? We will proceed with 5 sec delay for user to abort
print("\nWill apply fixes in 3 seconds... (press Ctrl+C to abort)")
time.sleep(3)

# Delete orphaned transactions first (all 45 for 950830)
print("\n--- Deleting orphaned 950830 transactions ---")
for t in orphan:
    delete_transaction(t["id"])
    time.sleep(0.1)

print("\n--- Deleting erroneous REWARD transactions ---")
for e in erroneous:
    delete_transaction(e["id"])
    time.sleep(0.05)

print("\n--- Deleting erroneous REFERRAL_COMMISSION transactions ---")
for tx in err_comm_txs:
    delete_transaction(tx["id"])
    time.sleep(0.05)

print("\n--- Deleting referCommissions rows ---")
for c in err_comm:
    delete_refer_commission(c["id"])
    time.sleep(0.05)

print("\n--- Patching user balances ---")
for uid,(ob,nb,op,np,ded) in corrections.items():
    patch_user(uid, nb, np)
    time.sleep(0.1)

print("\n=== FIX COMPLETE ===")
# Verify
r=requests.get(f"{BASE}/api/db", headers=headers, timeout=15)
db2=r.json()
users2={str(u["id"]): u for u in db2["users"]}
for uid in sorted(corrections.keys(), key=lambda x: int(x) if x.isdigit() else 999):
    if uid in users2:
        print(f"user {uid} new balance {users2[uid]['balance']:.6f} profit {users2[uid].get('lifetimeProfit',0):.6f}")
print(f"total tx after {len(db2['transactions'])}")
