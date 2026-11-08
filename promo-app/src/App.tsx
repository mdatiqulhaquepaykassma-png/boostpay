import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Promotion console — a standalone PWA for the Promotional & Referral Management
 * System. Its own login screen (same admin credentials as the BoostPay console),
 * its own domain (promotion.boostpay.online) and its own deploy.
 *
 * Screens
 *   Dashboard  — every campaign as a card with live stats, pause/resume, delete
 *   Campaign   — full editor: code, bonus per user, max uses, budget, dates,
 *                min deposit, transfer/withdraw permissions, bonus expiry,
 *                audience + country restriction, first-deposit reward
 *   Reviews    — bonuses the fraud engine held; approve (pays) or reject
 *   Leaders    — which campaign brings the most joins and first deposits
 *   Grants     — every paid bonus, with revoke + reason
 */

type Campaign = {
  id: string; code: string; name: string; bonusPerUser: number; valid: boolean; reason: string;
  kind?: 'CODE' | 'WELCOME'; stackWithCode?: boolean; dupIp?: boolean; dupDevice?: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'INACTIVE';
  remainingSlots: number | null; minDeposit: number; bonusTransfer: boolean; bonusWithdraw: boolean;
  bonusExpiryDays: number; expiryAction?: 'BURN' | 'TO_BALANCE'; startAt: number; endAt: number; budgetLimit: number;
  firstDepositBonus: number; firstDepositMin: number; audience: 'NEW' | 'ALL';
  countries?: string[]; note: string;
  stats: {
    joins: number; successful: number; pending: number; rejected: number; bonusIssued: number;
    remainingSlots: number | null; usagePercent: number | null; firstDeposits: number;
    conversionRate: number; budgetLimit: number; budgetUsed: number; budgetLeft: number;
    days: { day: string; joins: number }[];
  };
};

type Review = {
  id: string; userId: string; campaignId: string; campaignCode: string; amount: number;
  status: string; reason: string; timestamp: number; matchedUserId?: string; ip?: string;
};

const TOKEN_KEY = 'bp_promo_token';
const EMAIL_KEY = 'bp_promo_email';

const authHeaders = (): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
});

const money = (n: number) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 1) return '$' + v.toFixed(4);
  return '$' + v.toFixed(2);
};
const when = (ts: number) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString();
};
const day = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
const fromDay = (s: string) => (s ? new Date(s + 'T00:00:00Z').getTime() : 0);

export function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'DASH' | 'CAMPAIGN' | 'REVIEWS' | 'LEADERS' | 'GRANTS'>('DASH');

  const [totals, setTotals] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewCounts, setReviewCounts] = useState<any>(null);
  const [leaders, setLeaders] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  // editor state
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>({
    code: '', name: '', bonusPerUser: 1, maxUses: 500, minDeposit: 0,
    status: 'ACTIVE', startAt: '', endAt: '', budgetLimit: 0,
    bonusTransfer: true, bonusWithdraw: true, bonusExpiryDays: 0, expiryAction: 'BURN',
    audience: 'NEW', firstDepositBonus: 0, firstDepositMin: 0, kind: 'CODE', stackWithCode: true,
    dupIp: true, dupDevice: true, countries: '', note: '',
  });

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(''), 4000); };

  /** Give the welcome bonus to accounts that already exist (dry-run first). */
  const backfill = async (campaignId: string, userIds?: string[]) => {
    const dry = await postRaw('/api/admin/promo/welcome/backfill', { campaignId, userIds, dryRun: true });
    if (!dry) return;
    const target = userIds && userIds.length ? `user ${userIds.join(', ')}` : 'every eligible existing account';
    const msg = `Give the welcome bonus to ${target}?\n\nWould pay ${dry.wouldPay} account(s) · total $${Number(dry.total || 0).toFixed(2)}\nAlready paid: ${dry.alreadyPaid || 0}`;
    if (!confirm(msg)) return;
    const res = await postRaw('/api/admin/promo/welcome/backfill', { campaignId, userIds, confirm: true });
    if (res) {
      flash(`Welcome bonus paid to ${res.paid} account(s) · $${Number(res.total || 0).toFixed(2)}`);
      void load();
    }
  };

  /** Rebuild a campaign's slot/budget counters from the bonus ledger (no money moves). */
  const recount = async (campaignId: string) => {
    const dry = await postRaw('/api/admin/promo/campaigns/recount', { campaignId, dryRun: true });
    if (!dry) return;
    const row = (dry.campaigns || [])[0];
    if (!row) return;
    if (!row.changed) { flash(`${row.code} counters already match the bonus ledger.`); return; }
    const msg = `Recalculate ${row.code}?\n\nslots used: ${row.before.used} → ${row.after.used}\nbudget used: $${Number(row.before.budgetUsed).toFixed(2)} → $${Number(row.after.budgetUsed).toFixed(2)}\n\nNo money moves — the counters are re-read from the bonus ledger.`;
    if (!confirm(msg)) return;
    const res = await postRaw('/api/admin/promo/campaigns/recount', { campaignId, confirm: true });
    if (res) {
      const r2 = (res.campaigns || [])[0] || row;
      flash(`${r2.code} counters rebuilt · ${r2.after.used} slots used`);
      void load();
    }
  };

  const postRaw = async (path: string, body: any): Promise<any | null> => {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { flash(j?.error || `HTTP ${r.status}`); return null; }
      return j;
    } catch (e: any) { flash(e?.message || 'Network error'); return null; }
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setLoginErr('');
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) throw new Error(j?.error || 'Sign in failed.');
      localStorage.setItem(TOKEN_KEY, j.token);
      localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
      setToken(j.token);
    } catch (e2: any) {
      setLoginErr(e2?.message || 'Sign in failed.');
    } finally { setBusy(false); }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken('');
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr('');
    try {
      const [c, rv, lb] = await Promise.all([
        fetch('/api/admin/promo/campaigns', { headers: authHeaders() }),
        fetch('/api/admin/promo/reviews?status=PENDING', { headers: authHeaders() }),
        fetch('/api/admin/promo/leaderboard', { headers: authHeaders() }),
      ]);
      if (c.status === 401) { logout(); return; }
      const cj = await c.json(); const rj = await rv.json(); const lj = await lb.json();
      if (!c.ok) throw new Error(cj?.error || 'Could not load campaigns.');
      setTotals(cj.totals); setCampaigns(cj.campaigns || []);
      setReviews(rj.reviews || []); setReviewCounts(rj.counts || null);
      setLeaders(lj.leaderboard || []);
      // grants of the newest campaign for the Grants tab
      if ((cj.campaigns || []).length) {
        const one = await fetch(`/api/admin/promo/campaign/${cj.campaigns[0].id}`, { headers: authHeaders() });
        const oj = await one.json();
        setGrants(oj.grants || []);
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not load the promotion data.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: any, okMsg: string) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { logout(); throw new Error('Session expired — sign in again.'); }
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      flash(okMsg);
      await load();
      return j;
    } catch (e: any) {
      setErr(e?.message || 'Action failed.');
      return null;
    } finally { setBusy(false); }
  };

  const startNew = () => {
    setEditId('');
    setForm({
      code: '', name: '', bonusPerUser: 1, maxUses: 500, minDeposit: 0,
      status: 'ACTIVE', startAt: '', endAt: '', budgetLimit: 0,
      bonusTransfer: true, bonusWithdraw: true, bonusExpiryDays: 0, expiryAction: 'BURN',
      audience: 'NEW', firstDepositBonus: 0, firstDepositMin: 0, kind: 'CODE', stackWithCode: true,
      dupIp: true, dupDevice: true, countries: '', note: '',
    });
    setTab('CAMPAIGN');
  };

  const edit = (c: Campaign) => {
    setEditId(c.id);
    setForm({
      code: c.code, name: c.name || '', bonusPerUser: c.bonusPerUser, maxUses: c.remainingSlots === null ? 0 : (Number(c.remainingSlots) + Number(c.stats?.joins || 0)),
      minDeposit: c.minDeposit, status: c.status, startAt: day(c.startAt), endAt: day(c.endAt),
      budgetLimit: c.budgetLimit, bonusTransfer: c.bonusTransfer, bonusWithdraw: c.bonusWithdraw,
      bonusExpiryDays: c.bonusExpiryDays, expiryAction: c.expiryAction || 'BURN', audience: c.audience,
      firstDepositBonus: c.firstDepositBonus, firstDepositMin: c.firstDepositMin,
      kind: c.kind || 'CODE', stackWithCode: c.stackWithCode !== false,
      dupIp: c.dupIp !== false, dupDevice: c.dupDevice !== false,
      countries: (c.countries || []).join(', '), note: c.note || '',
    });
    setTab('CAMPAIGN');
  };

  const save = async () => {
    const body: any = {
      id: editId || undefined,
      code: form.code, name: form.name,
      bonusPerUser: Number(form.bonusPerUser),
      maxUses: Number(form.maxUses),
      minDeposit: Number(form.minDeposit),
      status: form.status,
      startAt: fromDay(form.startAt), endAt: fromDay(form.endAt),
      budgetLimit: Number(form.budgetLimit),
      bonusTransfer: !!form.bonusTransfer,
      bonusWithdraw: !!form.bonusWithdraw,
      bonusExpiryDays: Number(form.bonusExpiryDays),
      expiryAction: form.expiryAction === 'TO_BALANCE' ? 'TO_BALANCE' : 'BURN',
      kind: form.kind === 'WELCOME' ? 'WELCOME' : 'CODE',
      stackWithCode: !!form.stackWithCode,
      dupIp: !!form.dupIp,
      dupDevice: !!form.dupDevice,
      audience: form.audience,
      firstDepositBonus: Number(form.firstDepositBonus),
      firstDepositMin: Number(form.firstDepositMin),
      countries: String(form.countries || '').split(',').map((x) => x.trim()).filter(Boolean),
      note: form.note,
    };
    const j = await post('/api/admin/promo/campaigns/save', body, editId ? 'Campaign updated.' : 'Campaign created.');
    if (j) setTab('DASH');
  };

  const randomCode = async () => {
    try {
      const r = await fetch('/api/admin/promo/random-code', { headers: authHeaders() });
      const j = await r.json();
      if (j?.code) setForm((f: any) => ({ ...f, code: j.code }));
    } catch { /* ignore */ }
  };

  const totalJoins = useMemo(() => (totals?.joins ?? 0), [totals]);

  if (!token) {
    return (
      <div className="login-wrap">
        <form className="login card" onSubmit={login}>
          <div className="brand" style={{ marginBottom: 14 }}>
            <div className="logo">⚡</div>
            <div>BoostPay <small>Promotion console</small></div>
          </div>
          {loginErr && <div className="err" style={{ marginBottom: 10 }}>{loginErr}</div>}
          <label className="f">Admin e-mail
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="admin@boostpay.local" />
          </label>
          <label className="f" style={{ marginTop: 10 }}>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" />
          </label>
          <button className="primary" style={{ width: '100%', marginTop: 14 }} disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="dim center" style={{ marginTop: 12 }}>
            Separate login for the Promotional &amp; Referral Management System.<br />
            Same admin account as the BoostPay console.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="top">
        <div className="brand">
          <div className="logo">⚡</div>
          <div>Promotion <small>Referral &amp; bonus</small></div>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => void load()} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
          <button className="danger" onClick={logout}>Sign out</button>
        </div>
      </div>

      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
      {note && <div className="ok" style={{ marginBottom: 10 }}>✓ {note}</div>}

      <div className="grid g4" style={{ marginBottom: 12 }}>
        <div className="stat"><span>Campaigns</span><b>{totals?.campaigns ?? 0}</b></div>
        <div className="stat"><span>Live now</span><b style={{ color: '#6ee7b7' }}>{totals?.active ?? 0}</b></div>
        <div className="stat"><span>Total joins</span><b>{totalJoins}</b></div>
        <div className="stat"><span>Bonus issued</span><b className="money">{money(totals?.bonusIssued ?? 0)}</b></div>
      </div>

      <div className="tabs">
        {(['DASH', 'CAMPAIGN', 'REVIEWS', 'LEADERS', 'GRANTS'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'DASH' ? 'Campaigns' : t === 'CAMPAIGN' ? (editId ? 'Edit' : 'New') : t === 'REVIEWS' ? `Reviews${reviewCounts?.pending ? ` (${reviewCounts.pending})` : ''}` : t === 'LEADERS' ? 'Leaderboard' : 'Grants'}
          </button>
        ))}
      </div>

      {tab === 'DASH' && (
        <>
          <div className="h">
            <h2>Campaigns</h2>
            <button className="primary" onClick={startNew}>+ New campaign</button>
          </div>
          {campaigns.length === 0 && <div className="card empty">No campaigns yet — create your first one.</div>}
          <div className="list">
            {campaigns.map((c) => (
              <div className="item" key={c.id}>
                <div className="t">
                  <span className="code">{c.code}</span>
                  <span className="money">{money(c.bonusPerUser)}</span>
                  <span className={`pill ${c.status === 'ACTIVE' && c.valid ? 'on' : c.status === 'PAUSED' ? 'warn' : 'off'}`}>
                    {c.status === 'ACTIVE' ? (c.valid ? 'Running' : c.reason) : c.status}
                  </span>
                  <span className={`pill ${c.bonusTransfer ? 'sky' : 'off'}`}>{c.bonusTransfer ? 'transfer ✓' : 'no transfer'}</span>
                  <span className={`pill ${c.bonusWithdraw ? 'sky' : 'off'}`}>{c.bonusWithdraw ? 'withdraw ✓' : 'no withdraw'}</span>
                  {(c.dupIp === false || c.dupDevice === false) && (
                    <span className="pill off">
                      dup: {c.dupIp === false ? 'no IP' : 'IP'}{c.dupDevice === false ? ' · no device' : ' · device'}
                    </span>
                  )}
                  {c.bonusExpiryDays > 0 && <span className="pill violet">{c.bonusExpiryDays}d expiry · {(c.expiryAction || 'BURN') === 'TO_BALANCE' ? 'to balance' : 'burn'}</span>}
                  {c.audience === 'ALL' && <span className="pill off">all users</span>}
                </div>
                <div className="grid g4" style={{ marginTop: 9 }}>
                  <div className="stat"><span>Joins</span><b>{c.stats.joins}{c.remainingSlots !== null ? `/${c.stats.joins + c.remainingSlots}` : ''}</b></div>
                  <div className="stat"><span>Bonus paid</span><b className="money">{money(c.stats.bonusIssued)}</b></div>
                  <div className="stat"><span>First deposits</span><b>{c.stats.firstDeposits}</b></div>
                  <div className="stat"><span>Conversion</span><b>{c.stats.conversionRate}%</b></div>
                </div>
                {c.stats.usagePercent !== null && (
                  <div style={{ marginTop: 9 }}>
                    <div className="bar"><i style={{ width: `${Math.min(100, c.stats.usagePercent)}%` }} /></div>
                    <div className="dim" style={{ marginTop: 4 }}>usage {c.stats.usagePercent}% · {c.remainingSlots} slots left
                      {c.budgetLimit > 0 ? ` · budget ${money(c.stats.budgetUsed)}/${money(c.budgetLimit)}` : ''}
                      {c.minDeposit > 0 ? ` · min deposit ${money(c.minDeposit)}` : ''}</div>
                  </div>
                )}
                <div className="row" style={{ marginTop: 10 }}>
                  {c.kind === 'WELCOME' && (
                    <button onClick={() => void backfill(c.id)} title="Give the welcome bonus to accounts that already exist">
                      Give to existing users
                    </button>
                  )}
                  <button onClick={() => void recount(c.id)} title="Rebuild slot and budget counters from the bonus ledger (no money moves)">Fix counters</button>
                  <button onClick={() => edit(c)}>Edit</button>
                  {c.status === 'ACTIVE'
                    ? <button onClick={() => void post('/api/admin/promo/campaigns/status', { id: c.id, status: 'PAUSED' }, `${c.code} paused.`)}>Pause</button>
                    : <button onClick={() => void post('/api/admin/promo/campaigns/status', { id: c.id, status: 'ACTIVE' }, `${c.code} resumed.`)}>Resume</button>}
                  <button className="danger" onClick={() => {
                    if (confirm(`Delete ${c.code}? People who already got the bonus keep it; the code stops paying.`)) {
                      void post('/api/admin/promo/campaigns/remove', { id: c.id }, `${c.code} deleted.`);
                    }
                  }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'CAMPAIGN' && (
        <div className="card">
          <div className="h"><h2>{editId ? 'Edit campaign' : 'New campaign'}</h2><span className="sub">every field is enforced by the backend</span></div>
          <div className="grid g2">
            <label className="f">Campaign type
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                disabled={!!editId}
              >
                <option value="CODE">Referral / promo code</option>
                <option value="WELCOME">Welcome bonus (automatic, every new user)</option>
              </select>
            </label>
            {form.kind === 'WELCOME' ? (
              <label className="f">Applies to
                <input value="Every new account, once — no code needed" disabled />
              </label>
            ) : (
              <label className="f">Referral code
              <div className="row" style={{ gap: 6 }}>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16) })} placeholder="BP2026VIP" disabled={!!editId} />
                {!editId && <button className="ghost" onClick={() => void randomCode()} title="Generate">🎲</button>}
              </div>
            </label>
            )}
            <label className="f">Campaign name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VIP 2026" />
            </label>
            <label className="f">Bonus per user ($)
              <input value={form.bonusPerUser} onChange={(e) => setForm({ ...form, bonusPerUser: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" />
            </label>
            <label className="f">Maximum uses (people)
              <input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" />
            </label>
            <label className="f">Minimum deposit ($)
              <input value={form.minDeposit} onChange={(e) => setForm({ ...form, minDeposit: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" />
            </label>
            <label className="f">Campaign budget ($)
              <input value={form.budgetLimit} onChange={(e) => setForm({ ...form, budgetLimit: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" />
            </label>
            <label className="f">Start date
              <input type="date" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
            </label>
            <label className="f">Expiry date
              <input type="date" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
            </label>
            <label className="f">Bonus validity after join
              <select value={form.bonusExpiryDays} onChange={(e) => setForm({ ...form, bonusExpiryDays: e.target.value })}>
                <option value={0}>Never expires</option>
                <option value={7}>7 days</option>
                <option value={15}>15 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <label className="f">When the unused bonus expires
              <select value={form.expiryAction} onChange={(e) => setForm({ ...form, expiryAction: e.target.value })}>
                <option value="BURN">Expire — the unused bonus is cancelled</option>
                <option value="TO_BALANCE">Move to the user's main balance</option>
              </select>
            </label>
            <label className="f">Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <label className="f">Bonus transfer
              <select value={form.bonusTransfer ? '1' : '0'} onChange={(e) => setForm({ ...form, bonusTransfer: e.target.value === '1' })}>
                <option value="1">Allowed</option>
                <option value="0">Not allowed</option>
              </select>
            </label>
            <label className="f">Bonus withdrawal
              <select value={form.bonusWithdraw ? '1' : '0'} onChange={(e) => setForm({ ...form, bonusWithdraw: e.target.value === '1' })}>
                <option value="1">Allowed</option>
                <option value="0">Not allowed</option>
              </select>
            </label>
            {form.kind === 'WELCOME' && (
              <label className="f">If the user also joined with a code
                <select value={form.stackWithCode ? '1' : '0'} onChange={(e) => setForm({ ...form, stackWithCode: e.target.value === '1' })}>
                  <option value="1">Give the welcome bonus too</option>
                  <option value="0">Skip it — code campaigns win</option>
                </select>
              </label>
            )}
            <label className="f">Duplicate account check — same IP
              <select value={form.dupIp ? '1' : '0'} onChange={(e) => setForm({ ...form, dupIp: e.target.value === '1' })}>
                <option value="1">Hold for review</option>
                <option value="0">Ignore the IP (mobile / shared wifi)</option>
              </select>
            </label>
            <label className="f">Duplicate account check — same device
              <select value={form.dupDevice ? '1' : '0'} onChange={(e) => setForm({ ...form, dupDevice: e.target.value === '1' })}>
                <option value="1">Hold for review</option>
                <option value="0">Ignore the device</option>
              </select>
            </label>
            <label className="f">Who can use it
              <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                <option value="NEW">New users only</option>
                <option value="ALL">Every user</option>
              </select>
            </label>
            <label className="f">Countries (blank = all)
              <input value={form.countries} onChange={(e) => setForm({ ...form, countries: e.target.value.toUpperCase() })} placeholder="BD, IN" />
            </label>
            <label className="f">First-deposit reward ($)
              <input value={form.firstDepositBonus} onChange={(e) => setForm({ ...form, firstDepositBonus: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" />
            </label>
            <label className="f">…when deposit ≥ ($)
              <input value={form.firstDepositMin} onChange={(e) => setForm({ ...form, firstDepositMin: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" />
            </label>
          </div>
          <label className="f" style={{ marginTop: 10 }}>Internal note
            <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 200) })} placeholder="TechGuru collab, Nov campaign…" />
          </label>
          <p className="dim" style={{ marginTop: 8 }}>
            Minimum deposit &gt; 0 means the bonus waits until the new user actually deposits that much.
            “Bonus transfer / withdrawal” are enforced server-side on every bonus call — the console cannot override them.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => void save()} disabled={busy || !form.code}>{editId ? 'Save changes' : 'Create campaign'}</button>
            <button onClick={() => setTab('DASH')}>Cancel</button>
          </div>
        </div>
      )}

      {tab === 'REVIEWS' && (
        <>
          <div className="h"><h2>Fraud reviews</h2><span className="sub">{reviewCounts?.pending ?? 0} pending · {reviewCounts?.approved ?? 0} approved · {reviewCounts?.rejected ?? 0} rejected</span></div>
          {reviews.length === 0 && <div className="card empty">Nothing waiting — every bonus was paid cleanly.</div>}
          <div className="list">
            {reviews.map((r) => (
              <div className="item" key={r.id}>
                <div className="t">
                  <span className="code">{r.campaignCode}</span>
                  <span className="money">{money(r.amount)}</span>
                  <span className="pill warn">{r.reason}</span>
                  <span className="dim">#{r.userId}{r.matchedUserId ? ` ↔ #${r.matchedUserId}` : ''}</span>
                  <span className="dim">{when(r.timestamp)}</span>
                </div>
                <div className="dim" style={{ marginTop: 4 }}>ip {r.ip || '—'} · same device/IP as an earlier claim</div>
                <div className="row" style={{ marginTop: 9 }}>
                  <button className="primary" onClick={() => void post('/api/admin/promo/reviews/decide', { id: r.id, action: 'approve' }, 'Bonus approved and paid.')} disabled={busy}>Approve &amp; pay</button>
                  <button className="danger" onClick={() => void post('/api/admin/promo/reviews/decide', { id: r.id, action: 'reject' }, 'Review rejected.')} disabled={busy}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'LEADERS' && (
        <>
          <div className="h"><h2>Leaderboard</h2><span className="sub">by first deposits, then joins</span></div>
          {leaders.length === 0 && <div className="card empty">No campaigns yet.</div>}
          <div className="list">
            {leaders.map((l, i) => (
              <div className="item" key={l.id}>
                <div className="t">
                  <span className="pill violet">#{i + 1}</span>
                  <span className="code">{l.code}</span>
                  <span className="dim">{l.name}</span>
                </div>
                <div className="grid g4" style={{ marginTop: 8 }}>
                  <div className="stat"><span>Joins</span><b>{l.joins}</b></div>
                  <div className="stat"><span>First deposits</span><b>{l.firstDeposits}</b></div>
                  <div className="stat"><span>Conversion</span><b>{l.conversionRate}%</b></div>
                  <div className="stat"><span>Bonus paid</span><b className="money">{money(l.bonusIssued)}</b></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'GRANTS' && (
        <>
          <div className="h"><h2>Paid bonuses</h2><span className="sub">newest campaign · revoke with a reason</span></div>
          {grants.length === 0 && <div className="card empty">No bonuses paid yet.</div>}
          <div className="list">
            {grants.map((g) => (
              <div className="item" key={g.id}>
                <div className="t">
                  <span className="dim">#{g.userId}</span>
                  <span className="money">{money(g.grantedAmount)}</span>
                  <span className={`pill ${g.status === 'ACTIVE' ? 'on' : g.status === 'REVOKED' ? 'bad' : 'off'}`}>{g.status}</span>
                  <span className="dim">left {money(g.remaining)}</span>
                  <span className="dim">{when(g.grantedAt)}</span>
                  {g.expiresAt > 0 && <span className="pill violet">expires {day(g.expiresAt)}</span>}
                </div>
                {g.status === 'ACTIVE' && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="danger" onClick={() => {
                      const reason = prompt(`Why revoke grant ${g.id} (#${g.userId})?`);
                      if (reason) void post('/api/admin/promo/revoke', { grantId: g.id, reason }, 'Bonus revoked and ledger reconciled.');
                    }}>Revoke</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="foot">
        <div className="in">
          {([['DASH', '▦', 'Campaigns'], ['CAMPAIGN', '＋', 'New'], ['REVIEWS', '⚑', 'Reviews'], ['LEADERS', '🏆', 'Leaders'], ['GRANTS', '⛁', 'Grants']] as const).map(([id, ic, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => (id === 'CAMPAIGN' ? startNew() : setTab(id as any))}>
              <span className="ic">{ic}</span>{label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
