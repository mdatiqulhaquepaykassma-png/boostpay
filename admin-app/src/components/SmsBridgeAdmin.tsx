import { useCallback, useEffect, useState } from 'react';
import { Smartphone, Copy, RefreshCw, Trash2, Plus, ShieldCheck, AlertTriangle, BatteryCharging, CheckCheck, Ban } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * SMS Bridge — bKash / Nagad "money received" SMS → automatic deposit credit.
 *
 * The relay app (`sms-relay/`) runs on the phone that holds the RECEIVING SIM.
 * It forwards every SMS here; the server credits a user only when the TrxID in
 * the SMS equals the TrxID that user already submitted with a pending deposit
 * and the amount matches. Everything else lands in the inbox below.
 */

// NOTE: adminAuthHeaders() already sets Content-Type. Adding it again sends the
// header twice ("application/json, application/json"), express then refuses to
// parse the body and every POST arrives empty — that is what once broke the
// wallet-agent create form. Never duplicate it here.
const authHeaders = () => ({ ...BoostPayStore.adminAuthHeaders() });

type Device = {
  id: string; label: string; methodId: string; methodName: string; msisdn: string; country: string;
  active: boolean; autoCredit: boolean; tolerance: number; tokenHint: string;
  createdAt: number; lastSeenAt: number; lastSmsAt: number;
  ingestCount: number; creditCount: number; appVersion: string; batteryOk: boolean;
};
type MethodOpt = { id: string; name: string; logo: string; category: string; enabled: boolean };
type InboxRow = {
  id: string; deviceId: string; deviceLabel: string; methodName: string; at: number; sender: string;
  provider: string; direction: string; amount: number; trxId: string; status: string; note: string;
  requestId: string; userId: string; raw: string;
};
type Stats = { devices: number; activeDevices: number; credited24h: number; unmatched24h: number; creditedTotal: number };

const STATUS_STYLE: Record<string, string> = {
  CREDITED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  MATCHED: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  UNMATCHED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  AMOUNT_MISMATCH: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  DUPLICATE: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
  IGNORED: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};

const ago = (t: number) => {
  if (!t) return 'never';
  const d = Date.now() - t;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  return `${Math.floor(d / 86_400_000)} d ago`;
};

export const SmsBridgeAdmin = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [methods, setMethods] = useState<MethodOpt[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [newToken, setNewToken] = useState<{ token: string; device: Device } | null>(null);
  const [form, setForm] = useState({ label: '', methodId: '', msisdn: '', autoCredit: true, tolerance: 0 });
  const [probe, setProbe] = useState('');
  const [parsed, setParsed] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/sms-devices', { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load the SMS bridge.');
      setDevices(j.devices || []);
      setMethods(j.methods || []);
      setInbox(j.inbox || []);
      setStats(j.stats || null);
      setErr('');
    } catch (e: any) { setErr(e?.message || 'Could not load the SMS bridge.'); }
  }, []);

  useEffect(() => { void load(); const iv = window.setInterval(load, 20000); return () => window.clearInterval(iv); }, [load]);

  const create = async () => {
    setBusy(true); setNote(''); setErr('');
    try {
      const r = await fetch('/api/admin/sms-devices', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ ...form, msisdn: form.msisdn.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not create the device.');
      setNewToken({ token: j.token, device: j.device });
      setForm({ label: '', methodId: '', msisdn: '', autoCredit: true, tolerance: 0 });
      await load();
    } catch (e: any) { setErr(e?.message || 'Could not create the device.'); }
    setBusy(false);
  };

  const patch = async (id: string, body: any, okText: string) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/sms-devices/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Update failed.');
      if (j.token) setNewToken({ token: j.token, device: j.device });
      setNote(okText);
      await load();
    } catch (e: any) { setErr(e?.message || 'Update failed.'); }
    setBusy(false);
  };

  const remove = async (d: Device) => {
    if (!window.confirm(`Delete ${d.label}? The phone stops crediting immediately.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/sms-devices/${d.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!r.ok) throw new Error((await r.json()).error || 'Delete failed.');
      setNote(`${d.label} deleted.`);
      await load();
    } catch (e: any) { setErr(e?.message || 'Delete failed.'); }
    setBusy(false);
  };

  const testParse = async () => {
    setParsed(null);
    const r = await fetch('/api/admin/sms-devices/parse', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: probe }) });
    setParsed(await r.json());
  };

  const copy = (t: string) => { void navigator.clipboard?.writeText(t); setNote('Copied.'); };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h3 className="flex items-center gap-2 text-sm font-black text-white"><Smartphone className="w-4 h-4 text-amber-400" /> SMS bridge — automatic bKash / Nagad credit</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Install the <b className="text-zinc-300">BoostPay SMS Relay</b> app on the phone that holds the receiving bKash/Nagad SIM.
          It reads the "money received" SMS and sends it here. A user is credited only if the <b className="text-zinc-300">TrxID in the SMS
          equals the TrxID that user submitted</b> with a pending deposit and the amount matches — one TrxID can never credit twice.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Phones', stats?.devices ?? 0],
            ['Online', stats?.activeDevices ?? 0],
            ['Credited 24h', stats?.credited24h ?? 0],
            ['Unmatched 24h', stats?.unmatched24h ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
              <div className="text-sm font-black text-white">{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] leading-relaxed text-zinc-500">
          <a href="/download/boostpay-sms-relay.apk" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-black text-amber-300">⬇ Download relay APK</a>
          <span>install on the phone with the SIM · source <span className="font-mono text-zinc-400">sms-relay/</span></span>
        </p>
      </div>

      {note ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">{note}</div> : null}
      {err ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{err}</div> : null}

      {newToken ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-wider text-emerald-300">Device token — shown once</div>
            <button onClick={() => setNewToken(null)} className="text-[10px] font-bold text-zinc-400">close</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">{newToken.token}</code>
            <button onClick={() => copy(newToken.token)} className="rounded-xl border border-zinc-700 px-3 py-2 text-[10px] font-bold text-zinc-200"><Copy className="inline w-3 h-3" /> Copy</button>
          </div>
          <ol className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-zinc-400">
            <li>1. Install the relay APK on the phone with the {newToken.device.methodName} SIM.</li>
            <li>2. Open it, paste the server address and this token, tap <b className="text-zinc-200">Save &amp; start</b>.</li>
            <li>3. Allow the SMS permission and switch off battery optimisation for the app — then it forwards every received SMS.</li>
          </ol>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-amber-400">Add a phone</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" placeholder="Phone name (e.g. bKash 01711-111111 — Dhaka shop)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <select className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" value={form.methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })}>
            <option value="">Select the payment method…</option>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.logo} {m.name}{m.enabled ? '' : ' (disabled)'}</option>)}
          </select>
          <input className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12px] text-white outline-none" placeholder="Receiving number 01XXXXXXXXX" value={form.msisdn} onChange={(e) => setForm({ ...form, msisdn: e.target.value })} />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-zinc-400">
              <input type="checkbox" checked={form.autoCredit} onChange={(e) => setForm({ ...form, autoCredit: e.target.checked })} />
              Credit automatically
            </label>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              Tolerance
              <input type="number" min={0} max={100} className="w-16 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white outline-none" value={form.tolerance} onChange={(e) => setForm({ ...form, tolerance: Number(e.target.value) })} />
              <span>BDT</span>
            </label>
          </div>
        </div>
        <button onClick={() => void create()} disabled={busy || !form.label || !form.methodId}
          className="mt-3 flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-[11px] font-black text-zinc-950 disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> Create &amp; show token
        </button>
      </div>

      <div className="space-y-2">
        {devices.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 text-center text-[11px] text-zinc-600">No phone paired yet.</div>
        ) : devices.map((d) => (
          <div key={d.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12px] font-bold text-white">{d.label}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${d.active ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-red-500/30 bg-red-500/15 text-red-300'}`}>{d.active ? 'ON' : 'PAUSED'}</span>
                  {d.autoCredit ? null : <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[9px] font-black text-amber-300">MANUAL APPROVAL</span>}
                </div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">{d.methodName} · {d.msisdn || 'no number'} · token …{d.tokenHint}</div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  last seen {ago(d.lastSeenAt)} · last SMS {ago(d.lastSmsAt)} · {d.ingestCount} received · <b className="text-emerald-300">{d.creditCount} credited</b>
                  {d.tolerance > 0 ? ` · tolerance ±${d.tolerance} BDT` : ' · exact amount only'}
                </div>
                {d.batteryOk === false ? (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-300"><BatteryCharging className="w-3 h-3" /> phone may be battery-optimising — SMS could be delayed</div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => void patch(d.id, { active: !d.active }, d.active ? 'Paused.' : 'Resumed.')} disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[10px] font-bold text-zinc-200 disabled:opacity-50">
                {d.active ? <Ban className="w-3 h-3" /> : <CheckCheck className="w-3 h-3" />} {d.active ? 'Pause' : 'Resume'}
              </button>
              <button onClick={() => void patch(d.id, { autoCredit: !d.autoCredit }, d.autoCredit ? 'Auto-credit off — SMS still verifies.' : 'Auto-credit on.')} disabled={busy}
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[10px] font-bold text-zinc-200 disabled:opacity-50">
                {d.autoCredit ? 'Require approval' : 'Auto-credit ON'}
              </button>
              <button onClick={() => void patch(d.id, { rotateToken: true }, 'New token — re-pair the phone.')} disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[10px] font-bold text-zinc-200 disabled:opacity-50">
                <RefreshCw className="w-3 h-3" /> New token
              </button>
              <button onClick={() => void remove(d)} disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold text-red-300 disabled:opacity-50">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="text-[11px] font-black uppercase tracking-wider text-zinc-400">Test the reader (nothing is credited)</div>
        <textarea value={probe} onChange={(e) => setProbe(e.target.value)} rows={3}
          placeholder="Paste a bKash/Nagad SMS here…"
          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-[11px] text-white outline-none" />
        <button onClick={() => void testParse()} disabled={!probe.trim()} className="mt-2 rounded-xl border border-zinc-700 px-3 py-1.5 text-[10px] font-bold text-zinc-200 disabled:opacity-40">Parse</button>
        {parsed ? (
          <pre className="mt-2 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-[10px] text-zinc-300">{JSON.stringify(parsed.parsed || parsed, null, 2)}</pre>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-wider text-zinc-400">Recent SMS</div>
          <button onClick={() => void load()} className="flex items-center gap-1 text-[10px] font-bold text-zinc-400"><RefreshCw className="w-3 h-3" /> Refresh</button>
        </div>
        {inbox.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-zinc-600">Nothing received yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-zinc-800/70">
            {inbox.slice(0, 40).map((r) => (
              <div key={r.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${STATUS_STYLE[r.status] || STATUS_STYLE.IGNORED}`}>{r.status}</span>
                      <span className="text-[10px] font-bold text-zinc-300">{r.amount} BDT</span>
                      <span className="font-mono text-[9px] text-zinc-500">{r.trxId || '—'}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[9.5px] text-zinc-500">{r.deviceLabel} · {r.sender || r.provider} · {r.note || '—'}</div>
                  </div>
                  <div className="shrink-0 text-right text-[9px] text-zinc-600">{ago(r.at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-[10px] leading-relaxed text-zinc-500">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-zinc-400"><ShieldCheck className="w-3 h-3" /> Safety rules</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Only a “money received” SMS with an amount and a TrxID is considered; OTPs, promos and “you sent” messages are ignored.</li>
          <li>The TrxID must match a deposit the user already submitted, for the same method — a random SMS cannot credit anyone.</li>
          <li>The amount must equal the claim (or sit inside the tolerance you set). A mismatch stays pending for a human.</li>
          <li>One TrxID credits once, ever. Replays are logged as DUPLICATE.</li>
          <li>Pausing a phone stops it instantly; deleting it revokes the token.</li>
        </ul>
        <div className="mt-2 flex items-center gap-1 text-amber-300/80"><AlertTriangle className="w-3 h-3" /> Keep the phone charged and online — with no SMS the credit simply waits.</div>
      </div>
    </div>
  );
};
