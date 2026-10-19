import { FC, useState, useEffect } from 'react';
import { X, ShieldCheck, KeyRound, Lock, Eye, EyeOff, Inbox as InboxIcon, LogOut, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User } from '../types';
import { InboxView } from './InboxView';
import { SecurityModal } from './SecurityModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUserUpdated: (u: User) => void;
  onLogout?: () => void;
  inboxUnread?: number;
}

export const SettingsModal: FC<Props> = ({ isOpen, onClose, currentUser, onUserUpdated, onLogout, inboxUnread }) => {
  const [tab, setTab] = useState<'SECURITY' | 'INBOX' | 'PASSWORD'>('SECURITY');
  const [showSecurity, setShowSecurity] = useState(false);

  // password change state
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setMsg(null);
      setCurPass(''); setNewPass(''); setConfirm('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (newPass.length < 4) { setMsg({ type: 'err', text: 'New password must be at least 4 characters.' }); return; }
    if (newPass !== confirm) { setMsg({ type: 'err', text: 'Passwords do not match.' }); return; }
    setSaving(true);
    const res = await BoostPayStore.changeMyPassword(curPass, newPass);
    setSaving(false);
    if (res.success) {
      setMsg({ type: 'ok', text: 'Password updated successfully ✅' });
      setCurPass(''); setNewPass(''); setConfirm('');
      // update local user password for offline
      onUserUpdated({ ...currentUser, password: newPass } as any);
    } else {
      setMsg({ type: 'err', text: res.error || 'Failed to change password.' });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[92vh] overflow-hidden rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/30">
              <ShieldCheck className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Settings</h2>
              <p className="text-[10px] text-zinc-400">Security · Inbox · Password</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        <div className="shrink-0 flex gap-1 p-2 bg-zinc-950/60 border-b border-zinc-800">
          <button onClick={() => setTab('SECURITY')} className={`flex-1 rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${tab === 'SECURITY' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>Security</button>
          <button onClick={() => setTab('INBOX')} className={`flex-1 rounded-xl py-2 text-xs font-semibold transition cursor-pointer relative ${tab === 'INBOX' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
            Inbox {inboxUnread ? <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] text-white">{inboxUnread}</span> : null}
          </button>
          <button onClick={() => setTab('PASSWORD')} className={`flex-1 rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${tab === 'PASSWORD' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>Password</button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'SECURITY' && (
            <div className="p-5 space-y-4">
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Security Center</h3>
                  <button onClick={() => setShowSecurity(true)} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-amber-400 hover:border-amber-500/40 cursor-pointer">Open full</button>
                </div>
                <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">Manage anti-phishing code & signed-in devices. Your code appears in every genuine BoostPay alert.</p>
                <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-400">
                  Current code: <span className="text-amber-400">{currentUser.antiPhishingCode ? '•••• set' : '— not set —'}</span> · ID #{currentUser.id}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <h3 className="text-xs font-bold text-white flex items-center gap-2"><InboxIcon className="w-4 h-4 text-sky-400" /> Inbox quick access</h3>
                <p className="text-[11px] text-zinc-400 mt-1">You have {inboxUnread || 0} unread alerts. Open Inbox tab above to read & clear.</p>
                <button onClick={() => setTab('INBOX')} className="mt-2 w-full rounded-xl bg-zinc-800 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 cursor-pointer">Go to Inbox →</button>
              </section>

              {onLogout && (
                <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 py-3 text-xs font-bold text-red-400 hover:bg-red-500/20 cursor-pointer">
                  <LogOut className="w-4 h-4" /> Sign out of this device
                </button>
              )}
            </div>
          )}

          {tab === 'INBOX' && (
            <div className="min-h-[400px]">
              <InboxView userId={currentUser.id} />
            </div>
          )}

          {tab === 'PASSWORD' && (
            <div className="p-5 space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <h3 className="text-xs font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /> Change Password</h3>
                <p className="text-[11px] text-zinc-400 mt-1">Update your login password. You will stay signed in after change.</p>
                {msg && (
                  <div className={`mt-3 flex items-start gap-2 rounded-xl border p-2.5 text-xs ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
                    {msg.type === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />} <span>{msg.text}</span>
                  </div>
                )}
                <form onSubmit={handlePasswordChange} className="mt-3 space-y-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Current password</label>
                    <div className="relative">
                      <input type={showCur ? 'text' : 'password'} value={curPass} onChange={(e) => setCurPass(e.target.value)} placeholder="Enter current password" className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none pr-10" />
                      <button type="button" onClick={() => setShowCur(!showCur)} className="absolute right-3 top-2.5 text-zinc-500 hover:text-white cursor-pointer">{showCur ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-400 mb-1">New password</label>
                    <div className="relative">
                      <input type={showNew ? 'text' : 'password'} value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Min 4 characters" className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none pr-10" />
                      <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-2.5 text-zinc-500 hover:text-white cursor-pointer">{showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Confirm new password</label>
                    <input type={showNew ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none" />
                  </div>
                  <button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 py-3 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} {saving ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {showSecurity && (
        <SecurityModal isOpen={showSecurity} onClose={() => setShowSecurity(false)} currentUser={currentUser} onUserUpdated={onUserUpdated} />
      )}
    </div>
  );
};
