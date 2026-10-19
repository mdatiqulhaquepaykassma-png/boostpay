import { FC, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  X,
  ShieldCheck,
  Smartphone,
  Monitor,
  Globe,
  LogOut,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  Check
} from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { SessionDevice, User } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUserUpdated: (user: User) => void;
}

function describeDevice(ua: string): { icon: ReactNode; label: string } {
  const s = (ua || '').toLowerCase();
  if (s.includes('android')) return { icon: <Smartphone className="w-4 h-4" />, label: 'Android device' };
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ios')) return { icon: <Smartphone className="w-4 h-4" />, label: 'iOS device' };
  if (s.includes('windows') || s.includes('mac') || s.includes('linux') || s.includes('chrome')) return { icon: <Monitor className="w-4 h-4" />, label: 'Desktop browser' };
  return { icon: <Globe className="w-4 h-4" />, label: 'Unknown device' };
}

export const SecurityModal: FC<Props> = ({ isOpen, onClose, currentUser, onUserUpdated }) => {
  const [sessions, setSessions] = useState<SessionDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [phishCode, setPhishCode] = useState(currentUser.antiPhishingCode || '');
  const [phishInput, setPhishInput] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [savingCode, setSavingCode] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    const list = await BoostPayStore.getSessions();
    setSessions(list);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setPhishCode(currentUser.antiPhishingCode || '');
      setPhishInput('');
      setMsg(null);
      loadSessions();
    }
  }, [isOpen, currentUser.antiPhishingCode, loadSessions]);

  if (!isOpen) return null;

  const savePhishCode = async () => {
    setSavingCode(true);
    setMsg(null);
    try {
      const saved = await BoostPayStore.setAntiPhishingCode(phishInput.trim());
      setPhishCode(saved);
      setPhishInput('');
      onUserUpdated({ ...currentUser, antiPhishingCode: saved });
      setMsg({ type: 'ok', text: saved ? 'Anti-phishing code saved. Every genuine BoostPay alert will now show it.' : 'Anti-phishing code removed.' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message || 'Failed to save code.' });
    } finally {
      setSavingCode(false);
    }
  };

  const revokeOne = async (id: string) => {
    setBusy(id);
    await BoostPayStore.revokeSession(id);
    await loadSessions();
    setBusy(null);
    setMsg({ type: 'ok', text: 'Device signed out.' });
  };

  const revokeAll = async () => {
    if (!confirm('Sign out of BoostPay on ALL devices (including this one)?')) return;
    setBusy('others');
    await BoostPayStore.revokeAllSessions();
    // Full sign-out everywhere: clear the local session and return to the login screen
    BoostPayStore.setCurrentUser(null);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/30">
              <ShieldCheck className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Security Center</h2>
              <p className="text-[10px] text-zinc-400">Anti-phishing code & session devices</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {msg && (
            <div className={`flex items-start gap-2 rounded-2xl border p-3 text-xs ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
              {msg.type === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{msg.text}</span>
            </div>
          )}

          {/* Anti-phishing code */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <KeyRound className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white">Anti-Phishing Code</h3>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
              Every genuine BoostPay alert (yield rewards, transfers, security notices, broadcasts) will show this
              code. If a message arrives <span className="text-amber-400 font-semibold">without your code</span>, it is
              a phishing attempt — never tap links or share credentials.
            </p>

            <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 mb-3">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Current code</span>
              <span className="flex-1 text-sm font-mono text-amber-400">
                {phishCode ? (showCode ? phishCode : '•'.repeat(Math.min(phishCode.length, 10))) : '— not set —'}
              </span>
              {phishCode && (
                <button onClick={() => setShowCode(!showCode)} className="text-zinc-500 hover:text-white transition cursor-pointer">
                  {showCode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={phishInput}
                onChange={(e) => setPhishInput(e.target.value)}
                placeholder="Set new code (4-32 chars)"
                maxLength={32}
                className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none font-mono"
              />
              <button
                onClick={savePhishCode}
                disabled={savingCode || (phishInput.trim().length > 0 && phishInput.trim().length < 4)}
                className="rounded-2xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {savingCode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save
              </button>
            </div>
          </section>

          {/* Session devices */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold text-white">Signed-in Devices</h3>
              </div>
              <button
                onClick={revokeAll}
                disabled={busy === 'others'}
                className="flex items-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-red-400 hover:bg-red-500/20 active:scale-95 transition cursor-pointer disabled:opacity-50"
              >
                {busy === 'others' ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                Sign out all devices
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
              </div>
            ) : sessions.filter(x => !x.revoked).length === 0 ? (
              <p className="py-6 text-center text-[11px] text-zinc-500">No session data available.</p>
            ) : (
              <div className="space-y-2">
                {sessions.filter(x => !x.revoked).map((sess) => {
                  const dev = describeDevice(sess.userAgent);
                  return (
                    <div
                      key={sess.id}
                      className={`flex items-center gap-3 rounded-2xl border p-3 ${sess.current ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/80'}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${sess.current ? 'bg-amber-500/15 text-amber-400' : 'bg-zinc-800 text-zinc-400'}`}>
                        {dev.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate">{dev.label}</span>
                          {sess.current && (
                            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">THIS DEVICE</span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono truncate" title={sess.userAgent}>
                          IP {sess.ip} · last seen {new Date(sess.lastSeenAt).toLocaleString()}
                        </p>
                      </div>
                      {!sess.current && (
                        <button
                          onClick={() => revokeOne(sess.id)}
                          disabled={busy === sess.id}
                          className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:border-red-500/40 hover:text-red-400 active:scale-95 transition cursor-pointer disabled:opacity-50"
                          title="Sign this device out"
                        >
                          {busy === sess.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[10px] text-zinc-500 leading-relaxed">
              &quot;Sign out all devices&quot; ends every session at once. The single-device button keeps this device signed in.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
