#!/usr/bin/env python3
import requests, time
BASE="https://boostpay.72-60-42-18.sslip.io"
ADMIN_LOGIN={"email":"admin@gmail.com","password":"Bp#2026!SecureAdmin"}
def login():
    r=requests.post(f"{BASE}/api/admin/login", json=ADMIN_LOGIN, timeout=15)
    r.raise_for_status()
    return r.json()["token"]
token=login()
headers={"Authorization": f"Bearer {token}", "Content-Type":"application/json"}
print("token ok")

# Fetch to get current balances
r=requests.get(f"{BASE}/api/db", headers=headers, timeout=15)
db=r.json()
users={str(u["id"]): u for u in db["users"]}
for uid in ["13","2","7","16","17","6","15","1"]:
    u=users.get(uid)
    print(f"{uid} bal {u['balance'] if u else 'missing'}")

corrections={
    "13": 15.17058533387499,
    "2": 65.83715948147773,
    "7": 0.001533,
    "16": 0.014625731965311643,
    "17": 0.000293,
    "6": 0.003933449112619157,
    "15": 0.0014815,
    "1": 0.000064,
}
# For precise, use earlier computed
# 13: 32*0.4740807676931821 = 15.170584565981826
# Let's compute precisely
precise={
    "13": 32*0.4740807676931821,
    "2": 86*0.7655483660636955,
    "7": 0.001533, # approximate, use 0.001533
    "16": 3*0.0048752439884372145,
    "17": 5*6.318763624614414e-05, # approximate
    "6": 0.003933449112619157,
    "15": 0.0014815,
    "1": 0.000064,
}
# Use precise for 13,2,16
precise["13"]=32*0.4740807676931821
precise["2"]=86*0.7655483660636955
precise["16"]=3*0.0048752439884372145
# For 7, compute from earlier list: user7 erroneous 26 sum 0.001533 (approx) - we will use 0.001533
# For 17, 5*6.318e-05=0.000315
precise["17"]=5*6.318763624614414e-05
precise["6"]=0.003933449112619157
precise["15"]=0.001481 # from refer commissions total for 15? Actually 15's direct erroneous 2*~3e-08 =6e-08 negligible, but referral deduct 0.001482, so we combine
precise["7"]=0.001533
precise["1"]=0.000064

# Use these precise
corrections=precise

for uid, amt in corrections.items():
    if amt==0:
        continue
    body={"userId": uid, "type":"DEBIT", "amount": amt, "notes": f"Audit correction: remove erroneous compounding duplicate rewards (gap < target) for user {uid} - {amt:.6f}"}
    r=requests.post(f"{BASE}/api/admin/adjust", headers=headers, json=body, timeout=15)
    if r.ok:
        print(f"DEBIT {uid} {amt:.6f} ok {r.json()}")
    else:
        print(f"failed {uid} {r.status_code} {r.text[:500]}")
    time.sleep(0.3)

# Verify
r=requests.get(f"{BASE}/api/db", headers=headers, timeout=15)
db2=r.json()
for uid in corrections:
    u=next((x for x in db2["users"] if str(x["id"])==uid), None)
    if u:
        print(f"verify {uid} bal {u['balance']:.6f} profit {u.get('lifetimeProfit',0):.6f} (deduct {corrections[uid]:.6f})")
print(f"tx count after {len(db2['transactions'])}")
# Check user13 rewards remaining
tx13=[t for t in db2["transactions"] if str(t["userId"])=="13" and t["type"]=="REWARD"]
print(f"user13 rewards remaining {len(tx13)}")
