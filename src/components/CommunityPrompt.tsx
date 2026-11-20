import { useCallback, useEffect, useRef, useState } from 'react';
import { BoostPayStore } from '../services/store';
import { normalizeCommunityChannels, type CommunityChannels } from '../../community-channels';

/** Reminder only: never gates or replays a boost transaction. */
export function CommunityPrompt() {
  const [channels, setChannels] = useState<CommunityChannels | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const acknowledged = useRef(false);
  const active = useRef(true);
  const requestSeq = useRef(0);
  const check = useCallback(async () => {
    if (acknowledged.current) return;
    const seq = ++requestSeq.current;
    try {
      const r = await fetch('/api/user/community', { headers: BoostPayStore.authHeaders(), cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (!active.current || seq !== requestSeq.current || acknowledged.current) return;
      if (data.acknowledged) { acknowledged.current = true; setChannels(null); return; }
      const valid = normalizeCommunityChannels(data.channels).channels;
      if (valid && Object.values(valid).some(Boolean)) { setChannels(valid); setError(''); }
    } catch { /* optional reminder must not block wallet or boost */ }
  }, []);
  useEffect(() => {
    active.current = true;
    void check();
    const boost = () => { void check(); };
    window.addEventListener('boostpay:start-boost-click', boost);
    return () => { active.current = false; requestSeq.current++; window.removeEventListener('boostpay:start-boost-click', boost); };
  }, [check]);
  const confirm = async () => {
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/user/community/acknowledge', { method: 'POST', headers: BoostPayStore.authHeaders() });
      if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.error || 'Could not save your choice.'); }
      acknowledged.current = true; requestSeq.current++; setChannels(null);
    } catch (e: any) { if (active.current) setError(e.message || 'Could not save your choice. Try again.'); }
    finally { if (active.current) setSaving(false); }
  };
  if (!channels) return null;
  const native = !!(window as any).Capacitor?.isNativePlatform?.();
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="community-title">
    <div className="w-full max-w-sm rounded-3xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
      <h2 id="community-title" className="text-lg font-black text-white">Join our community</h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">Join the BoostPay channels for updates. Tap a button below to open the channel.</p>
      <div className="mt-4 space-y-2">
        {([['telegram', 'Join Telegram', 'bg-sky-600'], ['whatsapp', 'Join WhatsApp', 'bg-emerald-600'], ['imo', 'Join imo', 'bg-blue-600']] as const).map(([key, label, color]) => channels[key] ? <a key={key} href={channels[key]} target={native ? '_self' : '_blank'} rel="noopener noreferrer" className={`flex min-h-11 items-center justify-center rounded-xl px-4 text-xs font-bold text-white ${color}`}>{label}</a> : null)}
      </div>
      <p className="mt-3 text-[10px] text-zinc-500">Your confirmation is based on your choice; channel membership is not automatically verified.</p>
      {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
      <button type="button" disabled={saving} onClick={() => void confirm()} className="mt-4 min-h-11 w-full rounded-xl bg-amber-500 px-4 text-xs font-black text-zinc-950 disabled:opacity-50">{saving ? 'Saving…' : 'I already joined'}</button>
      <button type="button" disabled={saving} onClick={() => setChannels(null)} className="mt-2 min-h-10 w-full text-xs font-semibold text-zinc-400">Maybe later</button>
    </div>
  </div>;
}
