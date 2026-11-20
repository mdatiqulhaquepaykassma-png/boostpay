import { useEffect, useState } from 'react';
import { BoostPayStore } from '../services/store';

type Channels = { telegram: string; telegramGroup: string; whatsapp: string; imo: string };
const empty: Channels = { telegram: '', telegramGroup: '', whatsapp: '', imo: '' };
export function CommunityChannelsSettings() {
  const [channels, setChannels] = useState<Channels>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { const data = await BoostPayStore.adminApi('/api/admin/community'); setChannels(data.channels || empty); }
    catch (e: any) { setError(e.message || 'Could not load channel links.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const data = await BoostPayStore.adminApi('/api/admin/community', { method: 'POST', body: { channels } });
      setChannels(data.channels); setMessage('Community links saved.');
    } catch (e2: any) { setError(e2.message || 'Could not save channel links.'); }
    finally { setSaving(false); }
  };
  return <form onSubmit={save} className="space-y-3 rounded-2xl border border-sky-900/60 bg-zinc-900 p-4 sm:p-5">
    <h3 className="text-sm font-bold text-white">User community join popup</h3>
    <p className="text-xs leading-relaxed text-zinc-400">Users see configured links on login and when starting a boost until they select “I already joined”. This is self-confirmed, not verified. Users who already confirmed will not see it again, even if links change. Leave links blank to hide them; all blank disables the popup. Saving requires super admin and MFA unlock.</p>
    {([['telegram', 'Telegram channel link', 'https://t.me/yourchannel'], ['telegramGroup', 'Telegram group link', 'https://t.me/yourgroup'], ['whatsapp', 'WhatsApp channel link', 'https://whatsapp.com/channel/…'], ['imo', 'imo channel link', 'https://imo.im/…']] as const).map(([key, label, placeholder]) => <label key={key} className="block text-xs font-semibold text-zinc-300">{label}<input type="url" maxLength={1000} value={channels[key] || ''} onChange={e => setChannels(prev => ({ ...prev, [key]: e.target.value }))} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-xs text-white" /></label>)}
    {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
    {message ? <p role="status" className="text-xs text-emerald-300">{message}</p> : null}
    <div className="flex gap-2"><button type="submit" disabled={saving || loading} className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save channel links'}</button><button type="button" onClick={() => void load()} disabled={saving} className="rounded-xl border border-zinc-700 px-4 py-2.5 text-xs text-zinc-300">Reload</button></div>
  </form>;
}
