/**
 * Admin → Wallet Agents  (Job 14)
 *
 * The wallet-agent panel lives on its own domain (walletagent.boostpay.online)
 * with its own login, but the ACCOUNTS are created here. An account is bound to
 * exactly ONE country + ONE payment method, so the agent only ever sees the
 * deposit and withdrawal queue of that method.
 *
 * Everything on this screen is server-enforced:
 *   POST   /api/admin/wallet-agents            create (country + method required)
 *   PATCH  /api/admin/wallet-agents/:id        enable/disable, reset password, rebind
 *   DELETE /api/admin/wallet-agents/:id        remove (sessions die immediately)
 *   GET    /api/admin/wallet-agents/options    the country → method tree
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BoostPayStore } from '../services/store';

type Agent = {
  id: string; name: string; email: string; country: string;
  methodId: string; methodName: string; active: boolean;
  createdAt: number; lastLoginAt: number; reviewedCount: number;
};
type CountryOpt = {
  code: string; label: string; flag: string;
  methods: { id: string; name: string; logo: string; category: string; enabled: boolean }[];
};

/** The console session lives in `boostpay_admin_session_v4`; the store helper also
 *  adds the MFA headers. Never read the user-app token here (Job-13 trap). */
function authHeaders(): Record<string, string> {
  // adminAuthHeaders() already sets Content-Type. Adding a second, lowercase
  // 'content-type' made the browser send the header twice, and the console's
  // proxy forwarded "application/json, application/json" — which express does
  // not parse, so every POST arrived with an empty body.
  try { return { ...BoostPayStore.adminAuthHeaders() }; }
  catch { return { 'Content-Type': 'application/json' }; }
}

const when = (ts: number) => (ts ? new Date(ts).toLocaleString() : 'never');

export const WalletAgentAdmin: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('');
  const [methodId, setMethodId] = useState('');
  const [open, setOpen] = useState('');
  // inline editor — one row at a time, so a stray keystroke can never hit the
  // wrong account
  const [draft, setDraft] = useState<{ name: string; email: string; password: string; country: string; methodId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ra, rc] = await Promise.all([
        fetch('/api/admin/wallet-agents', { headers: authHeaders() }),
        fetch('/api/admin/wallet-agents/options', { headers: authHeaders() }),
      ]);
      const ja = await ra.json().catch(() => ({}));
      const jc = await rc.json().catch(() => ({}));
      if (!ra.ok) { setNote(ja.error || `Could not load wallet agents (HTTP ${ra.status}).`); return; }
      setAgents(ja.agents || []);
      if (rc.ok) setCountries(jc.countries || []);
    } catch { setNote('Network error.'); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const methods = useMemo(
    () => (countries.find((c) => c.code === country)?.methods || []).filter((m) => m.enabled),
    [countries, country],
  );

  useEffect(() => { if (methodId && !methods.some((m) => m.id === methodId)) setMethodId(''); }, [methods, methodId]);

  const create = async () => {
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/admin/wallet-agents', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name, email, password, country, methodId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setNote(j.error || `HTTP ${r.status}`); }
      else {
        setNote(`Created ${j.agent.email} — ${j.agent.methodName} / ${j.agent.country}. Give the agent this e-mail + password; they sign in at walletagent.boostpay.online right away (no extra approval step).`);
        setName(''); setEmail(''); setPassword(''); setMethodId('');
        await load();
      }
    } catch { setNote('Network error.'); }
    setBusy(false);
  };

  const patch = async (id: string, body: any, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/wallet-agents/${id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      setNote(r.ok ? okMsg : (j.error || `HTTP ${r.status}`));
      if (r.ok) await load();
    } catch { setNote('Network error.'); }
    setBusy(false);
  };

  const startEdit = (a: Agent) => {
    setOpen(a.id);
    setDraft({ name: a.name, email: a.email, password: '', country: a.country, methodId: a.methodId });
  };

  const saveEdit = async (a: Agent) => {
    if (!draft) return;
    const body: any = { name: draft.name, email: draft.email, country: draft.country, methodId: draft.methodId };
    if (draft.password) body.password = draft.password;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/wallet-agents/${a.id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setNote(j.error || `HTTP ${r.status}`); }
      else {
        setNote(`Saved ${j.agent?.email || a.email}: ${(j.changes || []).join(', ') || 'no change'}.`);
        setDraft(null);
        await load();
      }
    } catch { setNote('Network error.'); }
    setBusy(false);
  };

  const remove = async (a: Agent) => {
    if (!window.confirm(`Delete ${a.email}? Their session ends immediately. Their past decisions stay in the audit log.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/wallet-agents/${a.id}`, { method: 'DELETE', headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      setNote(r.ok ? `Deleted ${a.email}.` : (j.error || `HTTP ${r.status}`));
      if (r.ok) await load();
    } catch { setNote('Network error.'); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h3 className="text-sm font-black text-white">Wallet agents</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
          A wallet agent signs in at <span className="font-mono text-zinc-300">walletagent.boostpay.online</span> and handles
          the deposit &amp; withdrawal queue of <b className="text-zinc-300">one payment method in one country</b>.
          Pick both here — the agent cannot see anything else, and it cannot change its own scope.
        </p>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          The panel has its own email + password login (no Cloudflare Access in front of it) — create the account,
          hand over the credentials and the agent can sign in right away.
        </p>
        {note ? <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] text-zinc-200">{note}</div> : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-amber-400">Create an account</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-zinc-400">Agent name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahim (bKash BD)"
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200" />
          </label>
          <label className="text-[11px] text-zinc-400">Login email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="agent@boostpay.online"
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200" />
          </label>
          <label className="text-[11px] text-zinc-400">Password (min 8)
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder="give this to the agent"
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200" />
          </label>
          <label className="text-[11px] text-zinc-400">Country
            <select value={country} onChange={(e) => { setCountry(e.target.value); setMethodId(''); }}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200">
              <option value="">Select a country…</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.label} ({c.methods.length} method{c.methods.length === 1 ? '' : 's'})</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-zinc-400">Payment method (only this one)
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} disabled={!country}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-200 disabled:opacity-50">
              <option value="">{country ? 'Select the method…' : 'Pick a country first'}</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>{m.logo} {m.name}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={() => void create()} disabled={busy || !name || !email || !password || !country || !methodId}
              className="w-full rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-black text-zinc-950 disabled:opacity-40">
              {busy ? 'Working…' : 'Create wallet agent'}
            </button>
          </div>
        </div>
        {country && methods.length === 0 ? (
          <div className="mt-2 text-[11px] text-amber-300">
            No enabled payment method is configured for this country yet. Add the country to a method on the Payments screen first.
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-wider text-amber-400">Accounts ({agents.length})</div>
          <button onClick={() => void load()} disabled={busy} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-300">Refresh</button>
        </div>

        {loading ? <div className="py-6 text-center text-[11px] text-zinc-500">Loading…</div> : null}
        {!loading && agents.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-zinc-500">
            No wallet agent yet. Create the first one above.
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {agents.map((a) => {
            const isOpen = open === a.id;
            return (
              <div key={a.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40">
                <button onClick={() => setOpen(isOpen ? '' : a.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-zinc-100">{a.name}</div>
                    <div className="truncate font-mono text-[10px] text-zinc-500">{a.email}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] font-bold text-zinc-300">{a.country} · {a.methodName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${a.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {a.active ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </div>
                </button>

                {isOpen ? (
                  <div className="border-t border-zinc-800 px-3 py-3 text-[11px] text-zinc-400">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div><span className="text-zinc-600">ID</span><div className="font-mono text-zinc-300">{a.id}</div></div>
                      <div><span className="text-zinc-600">Created</span><div className="text-zinc-300">{when(a.createdAt)}</div></div>
                      <div><span className="text-zinc-600">Last sign-in</span><div className="text-zinc-300">{when(a.lastLoginAt)}</div></div>
                      <div><span className="text-zinc-600">Decisions</span><div className="text-zinc-300">{a.reviewedCount}</div></div>
                      <div><span className="text-zinc-600">Bound method</span><div className="font-mono text-zinc-300">{a.methodId}</div></div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => startEdit(a)} disabled={busy}
                        className="rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-black text-zinc-950">Edit details</button>
                      <button onClick={() => void patch(a.id, { active: !a.active }, a.active ? `${a.email} disabled — signed out everywhere.` : `${a.email} enabled again.`)}
                        disabled={busy}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-200">
                        {a.active ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => void remove(a)} disabled={busy}
                        className="rounded-lg border border-rose-900 px-2.5 py-1 text-[10px] font-bold text-rose-300">Delete</button>
                    </div>

                    {draft && open === a.id ? (
                      <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-500/[0.06] p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-wider text-amber-300">Edit {a.id}</div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label className="text-[10px] text-zinc-400">Name
                            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100" />
                          </label>
                          <label className="text-[10px] text-zinc-400">Login email
                            <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100" />
                          </label>
                          <label className="text-[10px] text-zinc-400">New password (blank = unchanged)
                            <input value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                              placeholder="min 8 characters" autoComplete="new-password"
                              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100" />
                          </label>
                          <label className="text-[10px] text-zinc-400">Country
                            <select value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100">
                              {countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.label}</option>)}
                            </select>
                          </label>
                          <label className="text-[10px] text-zinc-400">Payment method
                            <select value={draft.methodId} onChange={(e) => setDraft({ ...draft, methodId: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100">
                              {(countries.find((c) => c.code === draft.country)?.methods || []).map((m) => (
                                <option key={m.id} value={m.id}>{m.logo} {m.name}</option>
                              ))}
                            </select>
                          </label>
                          <div className="flex items-end gap-2">
                            <button onClick={() => void saveEdit(a)} disabled={busy || !draft.name || !draft.email}
                              className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-black text-zinc-950 disabled:opacity-40">Save</button>
                            <button onClick={() => setDraft(null)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-bold text-zinc-300">Cancel</button>
                          </div>
                        </div>
                        <div className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                          Changing the e-mail or the password signs the agent out everywhere. Moving the scope never moves money —
                          pending requests stay with the method they were made for.
                        </div>
                      </div>
                    ) : null}

                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
