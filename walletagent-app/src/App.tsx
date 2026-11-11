import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Wallet Agent panel — its own app, its own login, its own domain
 * (walletagent.boostpay.online).
 *
 * An account is created by an admin and is bound to ONE country + ONE payment
 * method. This panel therefore has exactly one job: keep that method's money
 * queue moving — verify deposits (credit the user) and pay withdrawals (or send
 * them back). Everything is served by the shared API, so the ledger rules are the
 * same ones the super-admin console uses; the scope is enforced on the server.
 *
 * Screens
 *   Queue     — pending deposits / withdrawals for the bound method, with the
 *               pay-to account (deposits) or the destination (withdrawals) shown
 *               so the agent can verify the money before acting
 *   History   — everything already approved / rejected, with the reason
 *   Account   — the binding, the method limits, sign out
 */

type Agent = {
  id: string; name: string; email: string; country: string;
  methodId: string; methodName: string; active: boolean;
  createdAt: number; lastLoginAt: number; reviewedCount: number;
};

type Method = {
  id: string; name: string; logo: string; category: string;
  minDeposit: number; maxDeposit: number; minWithdraw: number; maxWithdraw: number;
  depositFeePercent: number; withdrawFeePercent: number;
  processingTime: string; maintenance: boolean;
  depositEnabled: boolean; withdrawEnabled: boolean;
  countries: string[];
  accountName: string; accountNumber: string; instructions: string;
} | null;

type Request = {
  id: string; type: 'DEPOSIT' | 'WITHDRAW'; userId: string;
  methodId: string; methodName: string;
  amountUsd: number; feeUsd: number; netUsd: number;
  entryAmount: number; entryCurrency: string;
  reference: string; note: string;
  destination: Record<string, string> | null;
  status: string; createdAt: number; reviewedAt: number;
  reviewedBy: string; reason: string; payoutRef: string;
};

type Stats = {
  pendingDeposit: number; pendingWithdraw: number;
  todayApprovedDeposit: number; todayApprovedWithdraw: number;
  depositApprovedTotal: number; withdrawPaidTotal: number; reviewedCount: number;
};

const TOKEN_KEY = 'bp_walletagent_token_v1';
const AGENT_KEY = 'bp_walletagent_profile_v1';

const authHeaders = (): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
});

const usd = (n: number) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (v < 1) return '$' + v.toFixed(4);
  return '$' + v.toFixed(2);
};
const when = (ts: number) => {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return new Date(ts).toLocaleString();
};
const STATUS_TONE: Record<string, string> = {
  PENDING: 'warn', APPROVED: 'good', COMPLETED: 'good', REJECTED: 'bad',
};

export function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [agent, setAgent] = useState<Agent | null>(() => {
    try { return JSON.parse(localStorage.getItem(AGENT_KEY) || 'null'); } catch { return null; }
  });
  const [method, setMethod] = useState<Method>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const [tab, setTab] = useState<'QUEUE' | 'HISTORY' | 'ACCOUNT'>('QUEUE');
  const [type, setType] = useState<'deposit' | 'withdraw'>('deposit');
  const [status, setStatus] = useState<'PENDING' | ''>('PENDING');
  const [rows, setRows] = useState<Request[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [openRow, setOpenRow] = useState<string>('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const [payoutRef, setPayoutRef] = useState<Record<string, string>>({});
  const timer = useRef<number | null>(null);

  const signOut = useCallback((message?: string) => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AGENT_KEY);
    setToken(''); setAgent(null); setMethod(null); setRows([]); setStats(null);
    if (message) setLoginErr(message);
  }, []);

  /** Any 401 from the API means this session is gone (disabled account, admin
   *  password reset, 7-day idle) — drop straight back to the login screen. */
  const call = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } });
    if (r.status === 401 || r.status === 403) {
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) signOut(j.error || 'Your session ended. Please sign in again.');
      return { ok: false, status: r.status, json: j as any };
    }
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: json as any };
  }, [signOut]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setLoginErr('');
    try {
      const r = await fetch('/api/walletagent/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setLoginErr(j.error || 'Could not sign in.'); return; }
      localStorage.setItem(TOKEN_KEY, j.token);
      localStorage.setItem(AGENT_KEY, JSON.stringify(j.agent));
      setToken(j.token); setAgent(j.agent); setPassword('');
    } catch {
      setLoginErr('Network problem — please try again.');
    } finally { setBusy(false); }
  };

  const loadMe = useCallback(async () => {
    const r = await call('/api/walletagent/me');
    if (r.ok) { setAgent(r.json.agent); setMethod(r.json.method); localStorage.setItem(AGENT_KEY, JSON.stringify(r.json.agent)); }
    else if (r.status !== 401) setErr(r.json.error || 'Could not load your account.');
  }, [call]);

  const loadStats = useCallback(async () => {
    const r = await call('/api/walletagent/stats');
    if (r.ok) setStats(r.json);
  }, [call]);

  const loadRows = useCallback(async () => {
    setLoading(true); setErr('');
    const q = `/api/walletagent/requests?type=${type}&status=${status}&limit=100`;
    const r = await call(q);
    if (r.ok) { setRows(r.json.requests || []); setPendingCount(Number(r.json.pending) || 0); }
    else if (r.status !== 401) setErr(r.json.error || 'Could not load the queue.');
    setLoading(false);
  }, [call, type, status]);

  useEffect(() => { if (token) loadMe(); }, [token, loadMe]);
  useEffect(() => { if (!token) return; loadRows(); loadStats(); }, [token, type, status, loadRows, loadStats]);

  // the queue must not go stale while the panel sits open
  useEffect(() => {
    if (!token) return;
    timer.current = window.setInterval(() => { loadRows(); loadStats(); }, 15000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [token, loadRows, loadStats]);

  const review = async (row: Request, action: 'APPROVE' | 'REJECT') => {
    setBusy(true); setErr('');
    const body: any = { id: row.id, action };
    if (action === 'REJECT') body.reason = reason[row.id] || '';
    if (action === 'APPROVE' && row.type === 'WITHDRAW') body.payoutRef = payoutRef[row.id] || '';
    const r = await call(`/api/walletagent/requests/${row.type.toLowerCase()}/review`, {
      method: 'POST', body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.json.error || 'Could not save the decision.'); return; }
    setToast(action === 'APPROVE'
      ? (row.type === 'DEPOSIT' ? `${row.id} approved and credited.` : `${row.id} marked as paid.`)
      : `${row.id} rejected — the user's money is back on their balance.`);
    setOpenRow('');
    window.setTimeout(() => setToast(''), 4500);
    loadRows(); loadStats();
  };

  const totals = useMemo(() => stats || { pendingDeposit: 0, pendingWithdraw: 0 } as any, [stats]);

  if (!token) {
    return (
      <div className="app login-wrap">
        <form className="card login" onSubmit={login}>
          <div className="brand">
            <span className="logo">₿</span>
            <div>BoostPay<small>Wallet Agent</small></div>
          </div>
          <p className="dim login-note">
            Sign in with the account your administrator created for you. You handle one
            payment method in one country.
          </p>
          <label className="f">Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                   autoComplete="username" placeholder="agent@boostpay.online" required />
          </label>
          <label className="f">Password
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                   autoComplete="current-password" placeholder="••••••••" required />
          </label>
          {loginErr ? <div className="msg bad">{loginErr}</div> : null}
          <button className="primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="top">
        <div className="brand">
          <span className="logo">₿</span>
          <div>Wallet Agent<small>{agent?.country || '—'} · {agent?.methodName || '—'}</small></div>
        </div>
        <div className="row">
          {pendingCount > 0 && tab === 'QUEUE' ? <span className="pill warn">{pendingCount} open</span> : null}
          <button className="ghost" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>

      <div className="grid g4">
        <div className="stat"><span>Pending deposits</span><b>{totals.pendingDeposit ?? 0}</b></div>
        <div className="stat"><span>Pending withdrawals</span><b>{totals.pendingWithdraw ?? 0}</b></div>
        <div className="stat"><span>Approved today</span><b>{(stats?.todayApprovedDeposit || 0) + (stats?.todayApprovedWithdraw || 0)}</b></div>
        <div className="stat"><span>Volume approved</span><b>{usd((stats?.depositApprovedTotal || 0) + (stats?.withdrawPaidTotal || 0))}</b></div>
      </div>

      <div className="tabs">
        <button className={tab === 'QUEUE' ? 'on' : ''} onClick={() => setTab('QUEUE')}>Queue</button>
        <button className={tab === 'HISTORY' ? 'on' : ''} onClick={() => { setTab('HISTORY'); setStatus(''); }}>History</button>
        <button className={tab === 'ACCOUNT' ? 'on' : ''} onClick={() => setTab('ACCOUNT')}>Account</button>
      </div>

      {err ? <div className="msg bad">{err}</div> : null}
      {toast ? <div className="msg good">{toast}</div> : null}

      {tab !== 'ACCOUNT' ? (
        <div className="card">
          <div className="h">
            <div className="row">
              <div className="seg">
                <button className={type === 'deposit' ? 'on' : ''} onClick={() => setType('deposit')}>
                  Deposits{totals.pendingDeposit ? <i className="badge">{totals.pendingDeposit}</i> : null}
                </button>
                <button className={type === 'withdraw' ? 'on' : ''} onClick={() => setType('withdraw')}>
                  Withdrawals{totals.pendingWithdraw ? <i className="badge">{totals.pendingWithdraw}</i> : null}
                </button>
              </div>
              {tab === 'HISTORY' ? (
                <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="mini">
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="COMPLETED">Paid</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              ) : null}
            </div>
            <span className="sub">{loading ? 'loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}</span>
          </div>

          {rows.length === 0 && !loading ? (
            <div className="empty">
              <b>Nothing here right now.</b>
              <span>
                {tab === 'QUEUE'
                  ? `New ${type === 'deposit' ? 'deposit' : 'withdrawal'} requests for ${agent?.methodName || 'your method'} appear here automatically (refreshes every 15 s).`
                  : 'No request matches this filter yet.'}
              </span>
            </div>
          ) : null}

          <div className="list">
            {rows.map((r) => {
              const open = openRow === r.id;
              return (
                <div className={`item ${open ? 'open' : ''}`} key={r.id}>
                  <button className="item-head" onClick={() => setOpenRow(open ? '' : r.id)}>
                    <div className="item-main">
                      <b className="mono">{r.id}</b>
                      <span className="dim">{when(r.createdAt)} · user {r.userId}</span>
                    </div>
                    <div className="item-side">
                      <b>{usd(r.type === 'WITHDRAW' ? r.netUsd : r.amountUsd)}</b>
                      <span className={`pill ${STATUS_TONE[r.status] || ''}`}>{r.status}</span>
                    </div>
                  </button>

                  {open ? (
                    <div className="item-body">
                      <div className="kv">
                        <div><span>Amount</span><b>{usd(r.amountUsd)}</b></div>
                        <div><span>Entered</span><b>{r.entryAmount ? `${r.entryAmount} ${r.entryCurrency}` : '—'}</b></div>
                        <div><span>Fee</span><b>{usd(r.feeUsd)}</b></div>
                        <div><span>User receives</span><b>{usd(r.netUsd)}</b></div>
                      </div>

                      {r.type === 'DEPOSIT' ? (
                        <div className="block">
                          <div className="block-h">User says they sent it with this reference</div>
                          <div className="mono ref">{r.reference || '—'}</div>
                          {r.note ? <div className="dim small">Note: {r.note}</div> : null}
                          {method && (method.accountNumber || method.accountName) ? (
                            <div className="dim small">
                              Check against your account: <b className="mono">{method.accountNumber || '—'}</b>
                              {method.accountName ? ` · ${method.accountName}` : ''}
                            </div>
                          ) : (
                            <div className="msg warn">No pay-to account is saved for this method — ask the admin to fill it in.</div>
                          )}
                        </div>
                      ) : (
                        <div className="block">
                          <div className="block-h">Send the money to</div>
                          {r.destination
                            ? Object.entries(r.destination).map(([k, v]) => (
                                <div className="dest" key={k}><span>{k}</span><b className="mono">{v}</b></div>
                              ))
                            : <div className="dim small">No destination on the request.</div>}
                        </div>
                      )}

                      {r.status === 'PENDING' ? (
                        <div className="actions">
                          <input className="grow" placeholder={r.type === 'WITHDRAW' ? 'Payout reference (optional)' : 'Note (optional)'}
                                 value={r.type === 'WITHDRAW' ? (payoutRef[r.id] || '') : (reason[r.id] || '')}
                                 onChange={(e) => (r.type === 'WITHDRAW'
                                   ? setPayoutRef({ ...payoutRef, [r.id]: e.target.value })
                                   : setReason({ ...reason, [r.id]: e.target.value }))} />
                          <button className="primary" disabled={busy} onClick={() => review(r, 'APPROVE')}>
                            {r.type === 'DEPOSIT' ? 'Approve & credit' : 'Mark as paid'}
                          </button>
                          <button className="danger" disabled={busy} onClick={() => {
                            if (r.type === 'WITHDRAW' && !(reason[r.id] || '').trim()) {
                              setReason({ ...reason, [r.id]: ' ' });
                            }
                            review(r, 'REJECT');
                          }}>Reject</button>
                        </div>
                      ) : (
                        <div className="dim small">
                          {r.reviewedBy ? `Handled by ${r.reviewedBy} · ${when(r.reviewedAt)}` : 'Already handled'}
                          {r.reason ? ` · ${r.reason}` : ''}
                          {r.payoutRef ? ` · payout ref ${r.payoutRef}` : ''}
                        </div>
                      )}

                      {r.status === 'PENDING' && r.type === 'WITHDRAW' ? (
                        <input placeholder="Reason if you reject this withdrawal (the user sees it)" value={reason[r.id] || ''}
                               onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="h"><h2>Your scope</h2></div>
            <div className="kv">
              <div><span>Name</span><b>{agent?.name || '—'}</b></div>
              <div><span>Email</span><b className="mono">{agent?.email || '—'}</b></div>
              <div><span>Country</span><b>{agent?.country || '—'}</b></div>
              <div><span>Payment method</span><b>{agent?.methodName || '—'}</b></div>
              <div><span>Reviewed so far</span><b>{agent?.reviewedCount ?? 0}</b></div>
              <div><span>Last sign-in</span><b>{agent?.lastLoginAt ? when(agent.lastLoginAt) : 'now'}</b></div>
            </div>
            <p className="dim small">
              You can only see and act on deposits and withdrawals of {agent?.methodName || 'your method'}.
              Another method is invisible here — that is enforced by the server, not by this screen.
            </p>
          </div>

          {method ? (
            <div className="card">
              <div className="h"><h2>Method limits</h2><span className="sub">{method.category}</span></div>
              <div className="kv">
                <div><span>Deposit</span><b>{usd(method.minDeposit)} – {usd(method.maxDeposit)}</b></div>
                <div><span>Withdraw</span><b>{usd(method.minWithdraw)} – {usd(method.maxWithdraw)}</b></div>
                <div><span>Deposit fee</span><b>{method.depositFeePercent}%</b></div>
                <div><span>Withdraw fee</span><b>{method.withdrawFeePercent}%</b></div>
                <div><span>Processing</span><b>{method.processingTime}</b></div>
                <div><span>Status</span><b>{method.maintenance ? 'Maintenance' : 'Live'}</b></div>
              </div>
              {method.accountNumber ? (
                <div className="dim small">Pay-to account: <b className="mono">{method.accountNumber}</b>{method.accountName ? ` · ${method.accountName}` : ''}</div>
              ) : (
                <div className="msg warn">The admin has not saved a pay-to account for this method yet.</div>
              )}
              {method.instructions ? <div className="dim small">{method.instructions}</div> : null}
            </div>
          ) : null}

          <div className="card">
            <div className="h"><h2>Session</h2></div>
            <p className="dim small">
              One device per account: signing in somewhere else ends this session. If your
              administrator disables the account, this panel signs out immediately.
            </p>
            <button className="danger" onClick={async () => {
              try { await call('/api/walletagent/logout', { method: 'POST' }); } catch { /* ignore */ }
              signOut();
            }}>Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}
