#!/usr/bin/env python3
"""Test only an isolated local JSON server using documentation-range IPs."""
import json, os, pathlib, shutil, signal, socket, subprocess, tempfile, time, urllib.error, urllib.request, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='boostpay-ip-test-',dir='/home/user') as directory:
 root=pathlib.Path(directory)
 for name in ('server.ts','currency-data.ts','payments.ts','sms-parse.ts','payout-queue.ts','agent-contacts.ts','community-channels.ts','package.json'): shutil.copy2(ROOT/name,root/name)
 (root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True);(root/'data').mkdir()
 boost={'isActive':False,'isPaused':False,'startedAt':0,'elapsedMs':0,'targetDurationMs':86400000,'startingBalance':0,'accumulatedYield':0}
 state={'users':[{'id':'1','email':'sender@example.com','password':'testpass','balance':10,'currency':'USD','boostState':boost}], 'admins':[{'email':'owner@example.com','passwordHash':'testpass','role':'SUPERADMIN'}, {'email':'support@example.com','passwordHash':'testpass','role':'SUPPORT'}], 'transactions':[], 'config':{'antifraud':{'enabled':True,'ipAutoBlockEnabled':True,'ipAutoBlockThreshold':1,'ipAutoBlockDurationMs':600000,'ipBlockEnabled':True,'blockedIps':[]}}}
 (root/'data'/'boostpay_db.json').write_text(json.dumps(state)); sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env=os.environ.copy();env.pop('DATABASE_URL',None);env.update({'PORT':str(port),'NODE_ENV':'production','HOST_WATCHDOG':'off','API_SECRET':'isolated-only','TRUST_CF_IP':'1'})
 log=(root/'server.log').open('w');p=subprocess.Popen([str(ROOT/'node_modules'/'.bin'/'tsx'),'server.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);base=f'http://127.0.0.1:{port}'
 def req(path,method='GET',data=None,token=None,ip='192.0.2.1'):
  headers={'Content-Type':'application/json','CF-Connecting-IP':ip}
  if token:headers['Authorization']='Bearer '+token
  r=urllib.request.Request(base+path,method=method,headers=headers,data=json.dumps(data).encode() if data is not None else None)
  try:
   with urllib.request.urlopen(r,timeout=10) as f:return f.status,json.loads(f.read())
  except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
 def login(email,ip='192.0.2.1',admin=True):
  status,d=req('/api/admin/login' if admin else '/api/users/login','POST',{'email':email,'password':'testpass'},ip=ip);assert status==200,(status,d);return d['token']
 def trigger(ip,user):
  for i in range(32):req('/api/user/currency','POST',{'code':'INVALID'},user,ip)
  status,d=req('/api/user/currency','POST',{'code':'INVALID'},user,ip);assert status==429 and 'temporarily blocked for abuse' in d.get('error',''),(status,d)
 try:
  for _ in range(100):
   try:
    if req('/api/health')[0]==200:break
   except Exception:
    if p.poll() is not None:raise RuntimeError('Sandbox server exited')
    time.sleep(.1)
  owner=login('owner@example.com');support=login('support@example.com');victim='198.51.100.24';user=login('sender@example.com',victim,False)
  trigger(victim,user)
  path='/api/admin/antifraud/ip-blocks';status,d=req(path,token=owner);assert status==200 and any(x['ip']==victim and x['until']>time.time()*1000 for x in d['temporaryBlocks'])
  assert req(path)[0]==401
  target=path+'/temporary/'+urllib.parse.quote(victim,safe='')
  assert req(target,'DELETE',token=support)[0]==403
  status,d=req(target,'DELETE',token=owner);assert status==200 and not d['persistentStillBlocked']
  assert not any(x['ip']==victim for x in req(path,token=owner)[1]['temporaryBlocks'])
  status,d=req('/api/user/currency','POST',{'code':'INVALID'},user,victim);assert status==400,(status,d)
  assert req(target,'DELETE',token=owner)[0]==404
  print('PASS temporary list, authentication, support denial, unblock, no immediate reblock, missing block')
  # Manual block master controls only persisted entries and must take effect immediately.
  manual='203.0.113.17';assert req(path,'POST',{'ip':manual,'reason':'test','durationMs':600000},owner)[0]==200
  assert req('/api/health',ip=manual)[0]==403
  assert req(path+'/toggle-enabled','POST',{'enabled':False},owner)[0]==200
  assert req('/api/health',ip=manual)[0]==200
  assert req(path+'/toggle-enabled','POST',{'enabled':True},owner)[0]==200
  assert req('/api/health',ip=manual)[0]==403
  assert req(path+'/'+manual,'PUT',{'enabled':False},owner)[0]==200
  assert req('/api/health',ip=manual)[0]==200
  print('PASS manual block master and individual toggles do not leave stale in-memory block')
  # Both block types can coexist; removing auto must not remove persistent entry.
  trigger(victim,user)
  assert req(path,'POST',{'ip':victim,'reason':'test','durationMs':600000},owner)[0]==200
  status,d=req(target,'DELETE',token=owner);assert status==200 and d['persistentStillBlocked']
  assert req('/api/health',ip=victim)[0]==403
  assert req(path+'/'+victim,'DELETE',token=owner)[0]==200
  assert req('/api/health',ip=victim)[0]==200
  # Auto remains when only the manual entry is deleted.
  trigger(victim,user);assert req(path,'POST',{'ip':victim,'durationMs':600000},owner)[0]==200
  status,d=req(path+'/'+victim,'DELETE',token=owner);assert status==200 and d['temporaryStillBlocked']
  assert req('/api/health',ip=victim)[0]==429
  assert req(target,'DELETE',token=owner)[0]==200
  doc=json.loads((root/'data'/'boostpay_db.json').read_text());assert sum(x.get('action')=='IP_TEMP_BLOCK_REMOVE' for x in doc.get('auditLogs',[]))==3
  print('PASS overlapping auto/manual remain independent; audited temporary unblocks')
 finally:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=8)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  log.close()
