import { FC, useState, useEffect } from 'react';
import { X, ShieldCheck, KeyRound, Lock, Eye, EyeOff, Inbox as InboxIcon, LogOut, Check, AlertTriangle, Loader2, Mail, Bell, Volume2, Globe, User as UserIcon, Trash2 } from 'lucide-react';
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
  const [tab, setTab] = useState<'GENERAL' | 'SECURITY' | 'INBOX' | 'VERIFY' | 'PASSWORD'>('GENERAL');
  const [showSecurity, setShowSecurity] = useState(false);

  // password change state
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // verify email state
  const [emailVerified, setEmailVerified] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyMsg, setVerifyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // general prefs (local)
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem('boostpay_pref_notif') !== '0'; } catch { return true; }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('boostpay_pref_sound') !== '0'; } catch { return true; }
  });
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('boostpay_pref_lang') || 'en'; } catch { return 'en'; }
  });

  useEffect(() => {
    if (!isOpen) {
      setMsg(null);
      setCurPass(''); setNewPass(''); setConfirm('');
      setVerifyMsg(null); setVerifyCode('');
    } else {
      // load verify status
      BoostPayStore.getVerifyEmailStatus().then(r=> setEmailVerified(r.emailVerified));
      // load prefs already done via init
    }
  }, [isOpen]);

  const toggleNotif = (v: boolean) => { setNotifEnabled(v); try { localStorage.setItem('boostpay_pref_notif', v ? '1' : '0'); } catch {} };
  const toggleSound = (v: boolean) => { setSoundEnabled(v); try { localStorage.setItem('boostpay_pref_sound', v ? '1' : '0'); } catch {} };
  const changeLang = (v: string) => { setLang(v); try { localStorage.setItem('boostpay_pref_lang', v); } catch {} };

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
      onUserUpdated({ ...currentUser, password: newPass } as any);
    } else {
      setMsg({ type: 'err', text: res.error || 'Failed to change password.' });
    }
  };

  const handleRequestVerify = async () => {
    setVerifyLoading(true); setVerifyMsg(null);
    const res = await BoostPayStore.requestVerifyEmail();
    setVerifyLoading(false);
    if (res.success) {
      setVerifyMsg({ type: 'ok', text: 'Code sent to inbox' + (res.debugCode ? ` (demo: ${res.debugCode})` : '') });
    } else setVerifyMsg({ type: 'err', text: res.error || 'Failed' });
  };
  const handleConfirmVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode.trim()) { setVerifyMsg({ type: 'err', text: 'Enter 6-digit code' }); return; }
    setVerifyLoading(true); setVerifyMsg(null);
    const res = await BoostPayStore.confirmVerifyEmail(verifyCode.trim());
    setVerifyLoading(false);
    if (res.success) {
      setVerifyMsg({ type: 'ok', text: 'Email verified ✅' });
      setEmailVerified(true);
    } else setVerifyMsg({ type: 'err', text: res.error || 'Failed' });
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
              <p className="text-[10px] text-zinc-400">Manage your account & preferences</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        <div className="shrink-0 flex gap-1 p-2 bg-zinc-950/60 border-b border-zinc-800 overflow-x-auto">
          <button onClick={() => setTab('GENERAL')} className={`flex-1 min-w-[60px] rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${tab === 'GENERAL' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>General</button>
          <button onClick={() => setTab('SECURITY')} className={`flex-1 min-w-[60px] rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${tab === 'SECURITY' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>Security</button>
          <button onClick={() => setTab('VERIFY')} className={`flex-1 min-w-[60px] rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${tab === 'VERIFY' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>Verify</button>
          <button onClick={() => setTab('INBOX')} className={`flex-1 min-w-[60px] rounded-xl py-2 text-xs font-semibold transition cursor-pointer relative ${tab === 'INBOX' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
            Inbox {inboxUnread ? <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] text-white">{inboxUnread}</span> : null}
          </button>
          <button onClick={() => setTab('PASSWORD')} className={`flex-1 min-w-[60px] rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${tab === 'PASSWORD' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>Password</button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'GENERAL' && (
            <div className="p-5 space-y-4">
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <h3 className="text-xs font-bold text-white flex items-center gap-2"><UserIcon className="w-4 h-4 text-amber-400"/> Account Info</h3>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-zinc-500">User ID</span><span className="font-mono font-bold text-amber-400">#{currentUser.id}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Email</span><span className="text-white truncate max-w-[160px]">{currentUser.email || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Balance</span><span className="font-mono text-emerald-400">${Number(currentUser.balance||0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Verified</span><span className={`font-mono text-xs ${emailVerified ? 'text-emerald-400' : 'text-zinc-400'}`}>{emailVerified ? '✓ Verified' : 'Not verified (optional)'}</span></div>
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
                <h3 className="text-xs font-bold text-white flex items-center gap-2"><Bell className="w-4 h-4 text-sky-400"/> Preferences</h3>
                <label className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300 flex items-center gap-2"><Bell className="w-3.5 h-3.5 text-zinc-400"/> Push notifications</span>
                  <input type="checkbox" checked={notifEnabled} onChange={e=> toggleNotif(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300 flex items-center gap-2"><Volume2 className="w-3.5 h-3.5 text-zinc-400"/> Sound effects</span>
                  <input type="checkbox" checked={soundEnabled} onChange={e=> toggleSound(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300 flex items-center gap-2"><Globe className="w-3.5 h-3.5 text-zinc-400"/> Language</span>
                  <select value={lang} onChange={e=> changeLang(e.target.value)} className="rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white">
                    <option value="en">English</option>
                    <option value="bn">বাংলা</option>
                    <option value="es">Español</option>
                  </select>
                </label>
                <p className="text-[10px] text-zinc-500">These settings are stored locally on this device.</p>
              </section>

              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <h3 className="text-xs font-bold text-white flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-400"/> Danger Zone</h3>
                <p className="text-[11px] text-zinc-400 mt-1">Clear local chat cache & offline data. Server data stays safe.</p>
                <button onClick={()=> { try{ localStorage.removeItem('boostpay_messages'); localStorage.removeItem('boostpay_conversations'); location.reload(); }catch{} }} className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2 text-xs text-zinc-300 hover:text-white cursor-pointer">Clear local cache</button>
              </section>

              {onLogout && (
                <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 py-3 text-xs font-bold text-red-400 hover:bg-red-500/20 cursor-pointer">
                  <LogOut className="w-4 h-4" /> Sign out of this device
                </button>
              )}
            </div>
          )}

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

              {onLogout && (
                <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 py-3 text-xs font-bold text-red-400 hover:bg-red-500/20 cursor-pointer">
                  <LogOut className="w-4 h-4" /> Sign out of this device
                </button>
              )}
            </div>
          )}

          {tab === 'VERIFY' && (
            <div className="p-5 space-y-4">
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <h3 className="text-xs font-bold text-white flex items-center gap-2"><Mail className="w-4 h-4 text-sky-400"/> Verify Email (optional)</h3>
                <p className="text-[11px] text-zinc-400 mt-1">Verification is optional. Verified badges increase trust. Code is sent to your inbox.</p>
                <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs flex justify-between">
                  <span className="text-zinc-400">Status</span><span className={`font-mono font-bold ${emailVerified ? 'text-emerald-400' : 'text-amber-400'}`}>{emailVerified ? '✓ Verified' : 'Not verified'}</span>
                </div>
                {verifyMsg && (
                  <div className={`mt-2 rounded-xl border p-2 text-xs flex items-center gap-2 ${verifyMsg.type==='ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
                    {verifyMsg.type==='ok' ? <Check className="w-3.5 h-3.5"/> : <AlertTriangle className="w-3.5 h-3.5"/>} {verifyMsg.text}
                  </div>
                )}
                {!emailVerified ? (
                  <div className="mt-3 space-y-2">
                    <button onClick={handleRequestVerify} disabled={verifyLoading} className="w-full rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-white hover:bg-sky-400 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer">
                      {verifyLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Mail className="w-4 h-4"/>} Send verification code
                    </button>
                    <form onSubmit={handleConfirmVerify} className="flex gap-2">
                      <input value={verifyCode} onChange={e=> setVerifyCode(e.target.value)} placeholder="Enter 6-digit code" className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none" />
                      <button type="submit" disabled={verifyLoading} className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer">Verify</button>
                    </form>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300 flex items-center gap-2"><Check className="w-4 h-4"/> Your email is verified. You can now enjoy full security features.</div>
                )}
              </section>
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
