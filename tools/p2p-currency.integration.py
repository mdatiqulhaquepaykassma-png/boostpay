#!/usr/bin/env python3
"""Isolated JSON-backed P2P tests; starts its own server and never connects to production."""
import concurrent.futures, json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.error, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
assert (ROOT / 'node_modules' / '.bin' / 'tsx').exists(), 'Run npm ci first'
with tempfile.TemporaryDirectory(prefix='boostpay-p2p-test-', dir='/home/user') as directory:
    root = pathlib.Path(directory)
    for name in ('server.ts','currency-data.ts','payments.ts','sms-parse.ts','payout-queue.ts','agent-contacts.ts','community-channels.ts','package.json'):
        shutil.copy2(ROOT / name, root / name)
    (root/'node_modules').symlink_to(ROOT/'node_modules', target_is_directory=True)
    (root/'data').mkdir()
    now = int(time.time()*1000)
    boost = {'isActive':False,'isPaused':False,'startedAt':0,'pausedAt':0,'elapsedMs':0,'targetDurationMs':86400000,'startingBalance':0,'accumulatedYield':0}
    user = {'id':'1','email':'sandboxsender@gmail.com','password':'sandboxpass','balance':100,'lifetimeProfit':0,'currency':'BDT','createdAt':now-86400000,'boostState':boost}
    recipient = {**user,'id':'2','email':'sandboxreceiver@gmail.com','balance':0,'currency':'USD'}
    state={'users':[user,recipient],'transactions':[],'notifications':[],'config':{'antifraud':{'enabled':False}},'currencyConfig':{'default':'USD','disabled':[],'manualRates':{'BDT':120},'refreshMinutes':60},'fxCache':{'rates':{'USD':1,'BDT':120},'fetchedAt':now,'source':'test'}}
    (root/'data'/'boostpay_db.json').write_text(json.dumps(state))
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env=os.environ.copy();env.pop('DATABASE_URL',None);env.update({'PORT':str(port),'NODE_ENV':'production','HOST_WATCHDOG':'off','API_SECRET':'isolated-test-only-secret'})
    base=f'http://127.0.0.1:{port}'
    log=(root/'server.log').open('w')
    def boot():
        proc=subprocess.Popen([str(ROOT/'node_modules'/'.bin'/'tsx'),'server.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        for _ in range(100):
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=.2): return proc
            except Exception:
                if proc.poll() is not None: raise RuntimeError('Sandbox server failed to start')
                time.sleep(.1)
        raise RuntimeError('Sandbox server did not start')
    def stop(proc):
        import signal
        os.killpg(proc.pid,signal.SIGTERM)
        try: proc.wait(timeout=8)
        except subprocess.TimeoutExpired: os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    def request(path, payload=None, token=''):
        headers={'Content-Type':'application/json'}
        if token: headers['Authorization']='Bearer '+token
        req=urllib.request.Request(base+path, headers=headers, data=json.dumps(payload).encode() if payload is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=10) as res: return res.status,json.load(res)
        except urllib.error.HTTPError as e: return e.code,json.load(e)
    proc=boot()
    try:
        status,login=request('/api/users/login',{'email':'sandboxsender@gmail.com','password':'sandboxpass'});assert status==200,login;token=login['token']
        def send(payload): return request('/api/transfer',payload,token)
        def choose(code): assert request('/api/user/currency',{'code':code},token)[0]==200
        first={'senderId':'1','recipientId':'2','amount':120,'currency':'BDT','expectedRate':120,'idempotencyKey':'test-intent-00001','transferVersion':2}
        status,result=send(first);assert status==200 and result['sentTx']['amount']==1 and result['sender']['balance']==99 and result['recipient']['balance']==1
        choose('USD');status,result=send(first);assert status==200 and result.get('duplicate') and result['sender']['balance']==99
        status,result=send({**first,'amount':240});assert status==409 and result.get('duplicate')
        status,result=send({**first,'amount':2,'currency':'USD','expectedRate':1,'idempotencyKey':'test-intent-00002'});assert status==200 and result['sender']['balance']==97
        # A stale client sync cannot revert a chosen currency or user acknowledgement.
        status,_=request('/api/sync',{'users':[{'id':'1','currency':'BDT','balance':999999}]},token);assert status==200
        status,opts=request('/api/currency/options',token=token);assert status==200 and opts['selected']=='USD'
        choose('BDT');status,result=send({**first,'expectedRate':121,'idempotencyKey':'test-stale-00001'});assert status==409 and result.get('transferNotExecuted')
        con={**first,'amount':240,'idempotencyKey':'test-concurrent-01'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: answers=list(pool.map(send,[con,con]))
        assert all(status==200 for status,_ in answers) and sum(bool(x.get('duplicate')) for _,x in answers)==1
        assert all(x['sender']['balance']==95 for _,x in answers)
        stop(proc);proc=boot()
        status,result=send(first);assert status==200 and result.get('duplicate') and result['sender']['balance']==95
        legacy={'senderId':'1','recipientId':'2','amount':60,'currency':'BDT'}
        assert send(legacy)[0]==200
        status,result=send(legacy);assert status==409 and result.get('duplicate')
        stop(proc)
        file = root/'data'/'boostpay_db.json'
        doc = json.loads(file.read_text())
        doc['users'][0]['balance'] = 100
        doc['users'][0]['currency'] = 'BDT'
        doc['users'][0]['sendLock'] = {'mode':'amount','amount':90}
        doc['users'][0]['referSend'] = {'mode':'l1','amount':5,'period':'transfer'}
        doc['referrals'] = [{'referredId':'1','referrerId':'2'}]
        doc['transactions'] = []
        file.write_text(json.dumps(doc))
        proc = boot()
        base_intent = {**first, 'idempotencyKey':'test-refer-limit-1'}
        status,result=send({**base_intent,'amount':720});assert status==403 and result.get('referSendLimited') and result.get('transferNotExecuted'),(status,result)
        status,result=send({**base_intent,'amount':600,'idempotencyKey':'test-refer-limit-2'});assert status==200 and result['sentTx']['amount']==5 and result['sender']['sendLock']['sendable']==5,(status,result)
        status,result=send({**base_intent,'amount':720,'idempotencyKey':'test-hold-limit-01'});assert status==403 and result.get('transferNotExecuted'),(status,result)
        print('PASS isolated P2P: USD/BDT conversion, distinct intent, stale rate, conflict, concurrency, restart, old-client duplicate, stale sync, USD hold/referral limits')
    finally:
        stop(proc);log.close()
