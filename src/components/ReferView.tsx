import { FC, useEffect, useState } from 'react';
import { Gift, Users, Copy, Check, TrendingUp, Zap, Share2, Award, Clock, DollarSign, Activity, MessageCircle } from 'lucide-react';
import { BoostPayStore, copyToClipboard } from '../services/store';
import { ReferralTree } from './ReferralTree';
import { formatPrecisionAmount } from '../utils/format';

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  if (h>0) return `${h}h ${m}m ${sec}s`;
  if (m>0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export const ReferView: FC<{ userId: string; onMessageUser?: (id:string)=>void }> = ({ userId, onMessageUser }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'code'|'link'|null>(null);
  const [showApply, setShowApply] = useState(false);
  const [applyCode, setApplyCode] = useState('');
  const [applyMsg, setApplyMsg] = useState('');
  const [applyErr, setApplyErr] = useState('');
  const [countdown, setCountdown] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const [lastFetch, setLastFetch] = useState(Date.now());
  const [selectedCommission, setSelectedCommission] = useState<any>(null);
  const [recentPage, setRecentPage] = useState(0);
  // promotion bonus wallet
  const [bonus, setBonus] = useState<any>(null);
  // custom (vanity) code creator
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [codeCheck, setCodeCheck] = useState<any>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [referErr, setReferErr] = useState<string | null>(null);
  const recentPageSize = 5;

  const refresh = async () => {
    try {
      setReferErr(null);
      const d = await BoostPayStore.getReferMy();
      if (d) setData(d);
      else setReferErr('Empty response — please retry');
    } catch (e:any) {
      setReferErr(e?.message || 'Network error');
    } finally {
      setLoading(false);
      setLastFetch(Date.now());
    }
  };

  useEffect(()=>{ refresh(); const id=setInterval(()=> { if (document.visibilityState==='visible') refresh(); }, 15000); return ()=> clearInterval(id); }, [userId]);
  useEffect(()=>{ BoostPayStore.getBonusWallet().then(setBonus).catch(()=>{}); }, [userId]);
  useEffect(()=>{ const id=setInterval(()=> setNowTick(Date.now()), 1000); return ()=> clearInterval(id); },[]);
  // live countdown to UTC midnight
  useEffect(()=>{
    const tick = () => {
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1, 0,0,0));
      const diff = next.getTime() - now.getTime();
      const h = Math.floor(diff/3600000);
      const m = Math.floor((diff%3600000)/60000);
      const s2 = Math.floor((diff%60000)/1000);
      setCountdown(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s2).padStart(2,'0')} UTC`);
    };
    tick(); const id=setInterval(tick,1000); return ()=> clearInterval(id);
  },[]);

  // Availability check, debounced — the same public endpoint the signup form uses.
  useEffect(() => {
    const draft = codeDraft.trim();
    if (!draft) { setCodeCheck(null); return; }
    let dead = false;
    const t = setTimeout(async () => {
      const r = await BoostPayStore.checkReferCode(draft);
      if (!dead) setCodeCheck(r);
    }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [codeDraft]);

  const saveCustomCode = async () => {
    setCodeBusy(true); setCodeErr(''); setCodeMsg('');
    const res = await BoostPayStore.setCustomReferCode(codeDraft.trim());
    setCodeBusy(false);
    if (!res.success) { setCodeErr(res.error || 'Could not save that code.'); return; }
    setCodeMsg(`Saved! Your new code is ${res.referCode}`);
    setCodeOpen(false); setCodeDraft(''); setCodeCheck(null);
    await refresh();
    setTimeout(() => setCodeMsg(''), 4000);
  };

  const doCopy = async (text: string, which: 'code'|'link') => {
    const ok = await copyToClipboard(text);
    if (ok) { setCopied(which); setTimeout(()=> setCopied(null),1500); }
  };

  const handleApply = async (e: React.FormEvent)=>{
    e.preventDefault();
    setApplyErr(''); setApplyMsg('');
    const res = await BoostPayStore.applyReferCode(applyCode.trim());
    if (res.success) {
      setApplyMsg('Refer code applied! Refreshing...');
      setTimeout(()=> { setShowApply(false); refresh(); }, 800);
    } else setApplyErr(res.error || 'Failed');
  };

  if (loading && !data) {
    return <div className="p-6 space-y-3"><div className="h-24 rounded-2xl bg-zinc-900 animate-pulse"/><div className="h-40 rounded-2xl bg-zinc-900 animate-pulse"/></div>;
  }

  if (!data) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-xs text-zinc-500">Failed to load referral data.{referErr ? ` ${referErr}` : ''}</p>
        <button onClick={refresh} className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer">Retry</button>
        <p className="text-[10px] text-zinc-600">Pull to retry or tap Retry — will auto-retry in 15s</p>
      </div>
    );
  }

  const referrals: any[] = data.referrals || [];
  const recent: any[] = data.recentCommissions || [];

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-4 space-y-4 text-zinc-100 pb-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Gift className="w-5 h-5 text-amber-400"/> Refer & Earn</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Earn 1-10% on level 1, then half at every level (L2 5%, L3 2.5% …, unlimited)</p>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-mono font-bold text-amber-300">{data.rate}% RATE</span>
      </div>

      {/* Refer code card */}
      <div className="relative overflow-hidden rounded-[26px] border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[120%] -translate-x-1/2 rounded-full bg-amber-500/[0.06] blur-3xl"/>
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400">Your Refer Code</span>
            <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-mono text-zinc-400">LIVE 24h UTC</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 flex items-center justify-between">
              <span className="font-mono text-xl font-black text-white">#{data.referCode}</span>
              <button onClick={()=> doCopy(String(data.referCode), 'code')} className="rounded-xl bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition flex items-center gap-1 cursor-pointer">
                {copied==='code'? <Check className="w-3.5 h-3.5 text-emerald-400"/> : <Copy className="w-3.5 h-3.5"/>} {copied==='code'?'Copied':'Copy'}
              </button>
            </div>
          </div>
          {/* ── Custom (vanity) code ───────────────────────────────────── */}
          <div className="mt-3 rounded-2xl border border-zinc-800/70 bg-zinc-950/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">Custom code</span>
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 font-mono text-[9px] text-zinc-500">
                {Number(data.claimsUsed ?? 0)}/{Number(data.claimsLimit ?? 3)} used
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
              4–16 characters, letters/numbers/_. Great for a channel name (e.g. <span className="font-mono text-zinc-300">MRBEAST</span>).
              Your older codes keep working, so old links still pay you.
            </p>

            {Array.isArray(data.codes) && data.codes.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {data.codes.map((c: any) => (
                  <span key={c.code} className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${c.primary ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400'}`}>
                    {c.kind === 'id' ? '#' : ''}{c.code}{c.primary ? ' · active' : ''}
                  </span>
                ))}
              </div>
            )}

            {codeMsg && <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-300">{codeMsg}</p>}

            {!codeOpen ? (
              <button
                onClick={() => { setCodeOpen(true); setCodeErr(''); setCodeDraft(''); }}
                disabled={Number(data.codeClaimsLeft ?? 1) <= 0}
                className="mt-2 w-full rounded-xl bg-zinc-800 py-2 text-[11px] font-bold text-zinc-100 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 transition cursor-pointer"
              >
                {Number(data.codeClaimsLeft ?? 1) > 0 ? (data.customCode ? 'Change custom code' : 'Create custom code') : 'No custom codes left'}
              </button>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={codeDraft}
                    onChange={(e) => { setCodeDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16)); setCodeErr(''); }}
                    placeholder="MRBEAST"
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    onClick={saveCustomCode}
                    disabled={codeBusy || !codeCheck?.available}
                    className="rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 transition cursor-pointer"
                  >
                    {codeBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {codeDraft.trim().length > 0 && (
                  <p className={`font-mono text-[10px] ${codeCheck == null ? 'text-zinc-500' : codeCheck.formatOk && codeCheck.available ? 'text-emerald-400' : codeCheck.formatOk && codeCheck.yours ? 'text-sky-400' : 'text-rose-400'}`}>
                    {codeCheck == null ? 'checking…'
                      : !codeCheck.formatOk ? `✕ ${codeCheck.formatError}`
                      : codeCheck.yours ? '• this is already one of your codes'
                      : codeCheck.available ? `✓ ${codeCheck.code} is available`
                      : `✕ ${codeCheck.code} is already taken`}
                  </p>
                )}
                {codeErr && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">{codeErr}</p>}
                <button onClick={() => { setCodeOpen(false); setCodeDraft(''); setCodeCheck(null); setCodeErr(''); }}
                  className="w-full rounded-xl border border-zinc-800 py-1.5 text-[10px] text-zinc-400 hover:text-white transition cursor-pointer">
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="mt-2 rounded-2xl border border-zinc-800/60 bg-zinc-950/60 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-zinc-500 truncate flex-1">{data.referLink}</span>
            <button onClick={()=> doCopy(data.referLink,'link')} className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer">
              {copied==='link'? <Check className="w-3 h-3 text-emerald-400"/> : <Share2 className="w-3 h-3"/>} Share
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">Share your link: <span className="font-mono text-zinc-300">{data.referLink}</span> — new users signup with your code, you get <span className="text-amber-400 font-bold">1-10% daily tier</span> of their boosting profits.</p>
        </div>
      </div>

      {/* ── Promotion bonus wallet ─────────────────────────────────────── */}
      {bonus && bonus.wallet && (Number(bonus.wallet.granted) > 0 || Number(bonus.wallet.available) > 0) && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">🎁 Bonus wallet</span>
            {bonus.campaignCode && <span className="rounded-full bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{bonus.campaignCode}</span>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Bonus balance</div>
              <div className="font-mono text-sm font-bold text-emerald-300">${Number(bonus.wallet.available).toFixed(4)}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Used</div>
              <div className="font-mono text-sm font-bold text-zinc-300">${Number(bonus.wallet.used).toFixed(4)}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${bonus.wallet.canTransfer ? 'bg-sky-500/15 text-sky-300' : 'bg-zinc-800 text-zinc-400'}`}>
              Transfer {bonus.wallet.canTransfer ? 'allowed' : 'not allowed'}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${bonus.wallet.canWithdraw ? 'bg-sky-500/15 text-sky-300' : 'bg-zinc-800 text-zinc-400'}`}>
              Withdraw {bonus.wallet.canWithdraw ? 'allowed' : 'not allowed'}
            </span>
            {Number(bonus.wallet.nextExpiryAt) > 0 && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold text-violet-300">
                expires {new Date(Number(bonus.wallet.nextExpiryAt)).toLocaleDateString()}
              </span>
            )}
            {Number(bonus.wallet.nextExpiryAt) > 0 && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] font-bold text-zinc-300">
                {(bonus.wallet.grants || []).some((g: any) => g.expiryAction === 'TO_BALANCE')
                  ? 'unused → main balance'
                  : 'unused expires'}
              </span>
            )}
          </div>
          {bonus.waitingDeposit?.length > 0 && (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300">
              ⏳ ${Number(bonus.waitingDeposit[0].amount).toFixed(2)} bonus waits for a deposit of ${Number(bonus.waitingDeposit[0].minDeposit).toFixed(2)}.
            </p>
          )}
          {bonus.pendingReviews?.length > 0 && (
            <p className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[10px] text-zinc-400">
              🕒 A bonus is under review — you will be credited once it is approved.
            </p>
          )}
          {Array.isArray(bonus.ledger) && bonus.ledger.length > 0 && (
            <div className="mt-2 max-h-[110px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1">
              {bonus.ledger.slice(0, 20).map((row: any) => (
                <div key={row.id} className="flex items-center justify-between gap-2 border-b border-zinc-900 py-1 last:border-0 font-mono text-[9px]">
                  <span className="text-zinc-500">{row.type.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className={row.type === 'BONUS_CREDIT' || row.type === 'BONUS_RECEIVED' ? 'text-emerald-400' : 'text-zinc-400'}>
                    {row.type === 'BONUS_CREDIT' || row.type === 'BONUS_RECEIVED' ? '+' : '−'}${Number(row.amount).toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
            {bonus.wallet.canWithdraw
              ? 'You can move this bonus into your main balance, and boost it like normal money.'
              : 'This bonus can only be boosted — it cannot be sent or withdrawn. Profit you earn on top of it can be.'}
            {Number(bonus.wallet.nextExpiryAt) > 0 && (
              (bonus.wallet.grants || []).some((g: any) => g.expiryAction === 'TO_BALANCE')
                ? ' Whatever you have not used when it expires is added to your main balance — not lost.'
                : ' Whatever you have not used when it expires is cancelled, so use it before then.'
            )}
          </p>
        </div>
      )}

      {/* Upline — who referred you */}
      {data.upline && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">Your Upline</span>
            <span className="text-[10px] font-mono text-zinc-500">{new Date(data.upline.createdAt).toLocaleString()}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500 text-white font-mono font-bold text-sm">#{data.upline.referrerId}</div>
            <div className="flex-1">
              <div className="text-xs font-bold text-white font-mono">User #{data.upline.referrerId}</div>
              <div className="text-[11px] text-zinc-400">Referrals: {data.upline.referralsCount} · Rate {data.upline.referRate}% · Lifetime ${formatPrecisionAmount(data.upline.referLifetime||0,6)}</div>
            </div>
          </div>
          <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">Upline earned from you</span>
            <span className="font-mono text-xs font-bold text-emerald-400">+${formatPrecisionAmount(data.upline.earnedFromMe||0,8)}</span>
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">Your boosting rewards give your upline {data.upline.referRate}% commission (global tier).</p>
          <button onClick={()=> onMessageUser?.(String(data.upline.referrerId))} className="mt-2 w-full rounded-xl bg-sky-500/15 border border-sky-500/20 py-2 text-[11px] font-bold text-sky-300 hover:bg-sky-500/25 transition cursor-pointer flex items-center justify-center gap-1.5"><MessageCircle className="w-3.5 h-3.5"/> Message Upline</button>
        </div>
      )}

      {/* Countdown */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-400" /> Next tier reset</span>
        <span className="font-mono text-xs font-bold text-amber-400">{countdown}</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500"><Users className="w-3 h-3 text-sky-400"/> Referred</div>
          <div className="mt-1 font-mono text-lg font-bold text-white">{data.referralsCount}</div>
          <div className="text-[10px] text-zinc-500">Total users</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400"><Zap className="w-3 h-3"/> Today</div>
          <div className="mt-1 font-mono text-lg font-bold text-amber-400">{data.dailyCount}</div>
          <div className="text-[10px] text-zinc-500">24h cycle (UTC)</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400"><Award className="w-3 h-3"/> Rate</div>
          <div className="mt-1 font-mono text-lg font-bold text-emerald-400">{data.rate}%</div>
          <div className="text-[10px] text-zinc-500">Current tier</div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold text-zinc-400">Lifetime Referral Earnings</div>
          <div className="font-mono text-sm font-bold text-emerald-400">+${formatPrecisionAmount(data.lifetime||0,8)} USD</div>
        </div>
        <TrendingUp className="w-5 h-5 text-emerald-400"/>
      </div>

      {/* Today Active Boosted Referrals */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> Today Active Boosted</div>
          <div className="font-mono text-sm font-bold text-white mt-0.5">{referrals.filter((r:any)=> r.boostActive).length} active <span className="text-zinc-500 text-xs font-normal">of {referrals.length} referred</span></div>
          <div className="text-[10px] text-zinc-500">Referred users currently boosting</div>
        </div>
        <span className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-mono text-xs font-bold">{referrals.filter((r:any)=> r.boostActive).length}</span>
      </div>

      {/* Whole team, unlimited levels */}
      <ReferralTree onMessageUser={onMessageUser} />

      {/* Live boosting of referrals */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400"/> Live Referral Panel <span className="ml-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/></h3>
          <span className="text-[11px] font-mono text-zinc-500">{referrals.length} referred</span>
        </div>
        {referrals.length===0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center">
            <Users className="w-6 h-6 text-zinc-600 mx-auto mb-2"/>
            <p className="text-xs font-bold text-zinc-400">No referrals yet</p>
            <p className="text-[11px] text-zinc-500 mt-1">Share your code above — when they join and start boosting, you earn 1-10% automatically.</p>
            <button onClick={()=> setShowApply(false)} className="mt-3 text-xs text-amber-400 hover:underline cursor-pointer">Invite friends</button>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {referrals.map((r:any)=> (
              <div key={r.referredId} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-bold text-amber-400">#{r.referredId}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">Joined {new Date(r.createdAt).toLocaleString()} • Day {r.dayKey}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold border flex items-center gap-1 ${r.boostActive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : r.boostPaused ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-zinc-800/60 text-zinc-500 border-zinc-800'}`}>
                    {r.boostActive ? <><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"/> Boosting • {formatDuration(Math.max(0, (r.cycleDurationMs||0) - (r.elapsedMs||0) - (r.boostActive ? (nowTick - lastFetch) : 0)))}</> : r.boostPaused ? 'Paused • ' + formatDuration(Math.max(0, (r.cycleDurationMs||0) - (r.elapsedMs||0))) : 'Idle'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Balance</div>
                    <div className="font-mono text-xs font-bold text-white">${formatPrecisionAmount(r.balance,4)}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Cycle</div>
                    <div className="font-mono text-xs font-bold text-amber-400 flex items-center gap-1"><Clock className="w-3 h-3"/> {formatDuration(r.cycleDurationMs)}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Live Remaining</div>
                    <div className="font-mono text-xs font-bold flex items-center gap-1" style={{color: (r.boostActive || r.boostPaused) ? '#fbbf24' : '#71717a'}}>
                      <Clock className="w-3 h-3"/> {(r.boostActive || r.boostPaused) ? formatDuration(Math.max(0, (r.cycleDurationMs||0) - (r.elapsedMs||0) - (r.boostActive ? (nowTick - lastFetch) : 0))) : '—'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Earned</div>
                    <div className="font-mono text-xs font-bold text-emerald-400">+${formatPrecisionAmount(r.earnedFromThis||0,6)}</div>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all" style={{ width: `${r.cycleDurationMs>0 ? Math.min(100, ((r.elapsedMs + (r.boostActive ? (nowTick - lastFetch) : 0)) / r.cycleDurationMs)*100) : 0}%` }}/>
                </div>
                <div className="mt-2 flex justify-end">
                  <button onClick={()=> onMessageUser?.(String(r.referredId))} className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition cursor-pointer flex items-center gap-1"><MessageCircle className="w-3 h-3"/> Message</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Apply code if user has no referrer yet */}
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
          <button onClick={()=> setShowApply(v=> !v)} className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition cursor-pointer">Have a refer code? Apply now</button>
          {showApply && (
            <form onSubmit={handleApply} className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input value={applyCode} onChange={e=> setApplyCode(e.target.value)} placeholder="Enter referrer ID e.g. 1" className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"/>
                <button type="submit" className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer">Apply</button>
              </div>
              {applyMsg && <p className="text-[11px] text-emerald-400 font-medium">{applyMsg}</p>}
              {applyErr && <p className="text-[11px] text-red-400">{applyErr}</p>}
              <p className="text-[10px] text-zinc-500">You can only set referrer once. Commission stays 1-10% on your boosting.</p>
            </form>
          )}
        </div>
      </div>

      {/* Recent commissions — paginated sliding 5-window to prevent crush */}
      {recent.length>0 && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-white flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-400"/> Recent Referral Earnings</h3>
            <span className="text-[11px] font-mono text-zinc-500">{recent.length>0 ? `${Math.min(recentPage*recentPageSize+1, recent.length)}–${Math.min((recentPage+1)*recentPageSize, recent.length)} of ${recent.length}` : ''}</span>
          </div>
          <div className="space-y-2">
            {recent.slice(recentPage*recentPageSize, (recentPage+1)*recentPageSize).map((c:any)=>(
              <button key={c.id} onClick={()=> setSelectedCommission(c)} className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 hover:border-amber-500/30 hover:bg-zinc-900 transition text-left cursor-pointer">
                <div>
                  <div className="text-xs font-mono font-bold text-emerald-400">+${formatPrecisionAmount(c.amount,8)}</div>
                  <div className="text-[10px] text-zinc-500">
                    From #{c.referredId} @ {c.rate}%{Number(c.level) > 1 ? ` · L${c.level}` : ' · L1'} • {new Date(c.timestamp).toLocaleString()}
                  </div>
                </div>
                <span className="rounded-full bg-amber-500/15 text-amber-400 px-2 py-1 text-[10px] font-mono font-bold">
                  {Number(c.level) > 1 ? `L${c.level} ` : ''}{c.rate}%
                </span>
              </button>
            ))}
          </div>
          {recent.length > recentPageSize && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <button disabled={recentPage===0} onClick={()=> setRecentPage(p=> Math.max(0,p-1))} className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-900 cursor-pointer">← Load Previous</button>
              <span className="text-[11px] font-mono text-zinc-500">{recentPage+1}/{Math.ceil(recent.length/recentPageSize)}</span>
              <button disabled={(recentPage+1)*recentPageSize >= recent.length} onClick={()=> setRecentPage(p=> Math.min(Math.ceil(recent.length/recentPageSize)-1, p+1))} className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-900 cursor-pointer">Load More →</button>
            </div>
          )}
        </div>
      )}

      {/* Commission Detail Modal */}
      {selectedCommission && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={()=> setSelectedCommission(null)}>
          <div onClick={e=> e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-white">Referral Commission Details</h3>
              <button onClick={()=> setSelectedCommission(null)} className="rounded-xl p-1 text-zinc-500 hover:text-white cursor-pointer">✕</button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between gap-2"><span className="text-zinc-500 shrink-0">Commission ID</span><span className="font-mono text-[10px] text-zinc-400 break-all text-right">{selectedCommission.id}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Amount</span><span className="font-mono font-bold text-emerald-400">+${formatPrecisionAmount(selectedCommission.amount,8)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Level</span><span className="font-mono text-white">L{Number(selectedCommission.level) || 1}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Rate</span><span className="font-mono text-amber-400">{selectedCommission.rate}%</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">From User</span><span className="font-mono text-white">#{selectedCommission.referredId}</span></div>
              <div className="flex justify-between gap-2"><span className="text-zinc-500 shrink-0">Date &amp; Time</span><span className="text-zinc-300 text-right">{new Date(selectedCommission.timestamp).toLocaleString()}</span></div>
              {selectedCommission.sourceTxId && <div className="flex justify-between gap-2"><span className="text-zinc-500 shrink-0">Source TX</span><span className="font-mono text-[11px] text-zinc-400 break-all text-right">{selectedCommission.sourceTxId}</span></div>}
              {selectedCommission.dayKey && <div className="flex justify-between"><span className="text-zinc-500">Day Key</span><span className="font-mono text-zinc-400">{selectedCommission.dayKey}</span></div>}
              {selectedCommission.balanceAfter != null && <div className="flex justify-between"><span className="text-zinc-500">Balance After</span><span className="font-mono text-zinc-300">${formatPrecisionAmount(selectedCommission.balanceAfter,6)}</span></div>}
              <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2 text-[11px] text-zinc-400">This commission was earned when User #{selectedCommission.referredId} completed a boosting cycle. Your rate {selectedCommission.rate}% was applied to their yield. Duplicate commission IDs are blocked server-side.</div>
            </div>
            <button onClick={()=> setSelectedCommission(null)} className="w-full rounded-xl bg-zinc-800 py-2 text-xs font-semibold text-white hover:bg-zinc-700 cursor-pointer">Close</button>
          </div>
        </div>
      )}

      {/* Tier explainer */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-400">
        <span className="font-bold text-zinc-200">How rate works — Global Ranking (24h UTC) + multi-level:</span> Each day your referral count is ranked vs everyone. Highest referrals get 10%, lowest 1% (linear, single user = 10%). You earn that % of your <b>level 1</b> user’s boosting reward. <b>Every level deeper pays half:</b> L1 10% → L2 5% → L3 2.5% → L4 1.25% …, unlimited levels. Resets at UTC midnight.
      </div>
    </div>
  );
};
