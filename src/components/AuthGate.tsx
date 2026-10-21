import { FC, useState, useEffect } from 'react';
import { ArrowRight, Eye, EyeOff, Mail, Lock, Loader2, Gift, Users, KeyRound, Check, AlertTriangle } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User } from '../types';

interface Props {
  onLoginUser: (user: User) => void;
}

export const AuthGate: FC<Props> = ({ onLoginUser }) => {
  const [tab, setTab] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');

  // Login form state (strictly Email and Password)
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Signup form state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotStep, setForgotStep] = useState<'EMAIL'|'RESET'>( 'EMAIL');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotErr, setForgotErr] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const [referralCode, setReferralCode] = useState(() => {
    try {
      const h = window.location.hash || '';
      const m = h.match(/#\/join-ref\/([\w-]+)/) || h.match(/#\/join\/([\w-]+)/);
      if (m) return m[1];
      const q = new URLSearchParams(window.location.search);
      return q.get('ref') || q.get('referral') || localStorage.getItem('boostpay_pending_ref') || '';
    } catch { return ''; }
  });

  useEffect(()=>{
    if (referralCode) {
      try { localStorage.setItem('boostpay_pending_ref', referralCode); } catch {}
    }
  },[referralCode]);
  // auto-switch to signup if ref present
  useEffect(()=>{
    if (referralCode) setTab('SIGNUP');
  },[]);

  const cleanLocal = (v: string) => {
    let s = v.trim().toLowerCase().replace(/\s+/g,'');
    // auto-remove trailing gmail.com (with optional @/.) typed by mistake on phone to prevent double @gmail.com
    // handles: abir567gmail.com, abir567@gmail.com, abir567@gmail.com@gmail.com, abir567.gmail.com
    let prev = '';
    while (prev !== s) {
      prev = s;
      s = s.replace(/@gmail\.com$/i, '');
      s = s.replace(/\.gmail\.com$/i, '');
      s = s.replace(/gmail\.com$/i, '');
      // also handle without dot: gmailcom (phone typo)
      s = s.replace(/@gmailcom$/i, '');
      s = s.replace(/\.gmailcom$/i, '');
      s = s.replace(/gmailcom$/i, '');
    }
    s = s.split('@')[0].replace(/[@.]+$/g, '');
    return s;
  };
  const toGmail = (v: string) => {
    const s = cleanLocal(v);
    return s ? s + '@gmail.com' : '';
  };
  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const cleanEmail = toGmail(loginEmail);
    if (!cleanEmail || !cleanLocal(loginEmail)) {
      setLoginError('Please enter your Gmail username (example: abir567 → abir567@gmail.com)');
      return;
    }

    if (!loginPassword.trim()) {
      setLoginError('Please enter your account password.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await BoostPayStore.loginUser(cleanEmail, loginPassword);
      if (!res.success || !res.user) {
        setLoginError(res.error || 'Invalid email or password.');
      } else {
        onLoginUser(res.user);
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const completeSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError('');

    const cleanEmail = toGmail(signupEmail);
    if (!cleanEmail || !cleanLocal(signupEmail)) {
      setSignupError('Please enter your Gmail username (example: abir567 → abir567@gmail.com)');
      return;
    }
    // only @gmail.com allowed — suffix is fixed, so always ok

    if (!signupPassword) {
      setSignupError('Please set a security password.');
      return;
    }

    if (signupPassword.length < 4) {
      setSignupError('Password must be at least 4 characters long.');
      return;
    }

    if (signupPassword !== confirmPassword) {
      setSignupError('Passwords do not match.');
      return;
    }

    setIsSigningUp(true);
    try {
      const cleanRefer = referralCode.trim().replace(/^#/,'').replace(/^REF-?/i,'');
      const newUser = await BoostPayStore.registerUser(cleanEmail, signupPassword, cleanRefer || undefined);
      try { localStorage.removeItem('boostpay_pending_ref'); } catch {}
      // clear hash
      try { if (window.location.hash.includes('join-ref')||window.location.hash.includes('join')) history.replaceState(null,'',window.location.pathname+window.location.search); } catch {}
      onLoginUser(newUser);
    } catch (err: any) {
      setSignupError(err.message || 'Registration failed.');
    } finally {
      setIsSigningUp(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotErr(''); setForgotMsg('');
    const cleanForgot = toGmail(forgotEmail);
    if (!cleanForgot || !cleanLocal(forgotEmail)) { setForgotErr('Enter Gmail username (e.g. abir567)'); return; }
    setForgotLoading(true);
    const res = await BoostPayStore.forgotPassword(cleanForgot);
    setForgotLoading(false);
    if (res.success) {
      setForgotMsg('Code sent to your email. Please check inbox/spam folder.');
      setForgotStep('RESET');
    } else setForgotErr(res.error||'Failed');
  };
  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotErr(''); setForgotMsg('');
    if (!forgotCode.trim() || forgotNewPass.length < 4) { setForgotErr('Code and new password (min 4 chars) required'); return; }
    setForgotLoading(true);
    const cleanForgot = toGmail(forgotEmail);
    const res = await BoostPayStore.resetPassword(cleanForgot, forgotCode.trim(), forgotNewPass);
    setForgotLoading(false);
    if (res.success) {
      setForgotMsg('Password updated — please sign in with your new password ✅');
      setTimeout(()=> { setShowForgot(false); setForgotStep('EMAIL'); setForgotCode(''); setForgotNewPass(''); setForgotMsg(''); setForgotErr(''); setTab('LOGIN'); setLoginEmail(cleanForgot); setLoginError(''); }, 1500);
    } else setForgotErr(res.error||'Failed');
  };

  return (
    <div className="flex min-h-screen w-full flex-col justify-center px-4 py-8">
      {/* Auth Card */}
      <div className="max-w-md w-full mx-auto rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 shadow-2xl backdrop-blur-xl">
        {/* Tab Switcher */}
        <div className="flex rounded-2xl bg-zinc-950 p-1 mb-5 border border-zinc-800/80">
          <button
            type="button"
            onClick={() => { setTab('LOGIN'); setLoginError(''); }}
            className={`flex-1 rounded-xl py-2.5 text-xs font-semibold transition cursor-pointer ${
              tab === 'LOGIN'
                ? 'bg-amber-500 text-zinc-950 shadow-md font-bold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setTab('SIGNUP'); setSignupError(''); }}
            className={`flex-1 rounded-xl py-2.5 text-xs font-semibold transition cursor-pointer ${
              tab === 'SIGNUP'
                ? 'bg-amber-500 text-zinc-950 shadow-md font-bold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* 1. Sign In Form (Strictly Email & Password) */}
        {tab === 'LOGIN' && (
          <form onSubmit={handleUserLogin} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" /> Email
              </label>
              <div className="flex items-center rounded-2xl border border-zinc-800 bg-zinc-950 focus-within:border-amber-500 overflow-hidden">
                <input
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="abir567"
                  value={cleanLocal(loginEmail)}
                  onChange={(e) => setLoginEmail(cleanLocal(e.target.value))}
                  className="flex-1 bg-transparent px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
                <span className="pr-3.5 text-xs font-mono text-zinc-400 select-none">@gmail.com</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">Just type abir567 → auto abir567@gmail.com (fixed, cannot remove)</p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" /> Password
              </label>
              <div className="relative">
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your account password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <p className="rounded-xl bg-red-950/40 border border-red-500/30 p-2.5 text-xs text-red-400">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full h-12 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Wallet</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <div className="pt-1 flex justify-end">
              <button type="button" onClick={()=> { setShowForgot(true); setForgotStep('EMAIL'); setForgotErr(''); setForgotMsg(''); }} className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 cursor-pointer">Forgot password?</button>
            </div>
          </form>
        )}

        {/* 2. Create Account Form */}
        {tab === 'SIGNUP' && (
          <form onSubmit={completeSignup} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" /> Email Address
              </label>
              <div className="flex items-center rounded-2xl border border-zinc-800 bg-zinc-950 focus-within:border-amber-500 overflow-hidden">
                <input
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="abir567"
                  value={cleanLocal(signupEmail)}
                  onChange={(e) => setSignupEmail(cleanLocal(e.target.value))}
                  className="flex-1 bg-transparent px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
                <span className="pr-3.5 text-xs font-mono text-zinc-400 select-none">@gmail.com</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">Just type abir567 → auto abir567@gmail.com (fixed, cannot remove)</p>
              {/* sequential ID hint removed per user request */}
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" /> Set Security Password
              </label>
              <div className="relative">
                <input
                  type={showSignupPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="Create a strong password (min 4 chars)"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSignupPassword(!showSignupPassword)}
                  className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  {showSignupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5">
                Confirm Password
              </label>
              <input
                type={showSignupPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-amber-400" /> Referral Code <span className="text-[10px] text-zinc-500 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Enter referrer User ID (e.g. 1 or #1)"
                  value={referralCode}
                  onChange={(e)=> setReferralCode(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 pl-9 pr-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none font-mono"
                />
              </div>
              {referralCode && <p className="text-[10px] text-emerald-400/80 mt-1 font-mono">✓ You will be linked to User #{referralCode.replace(/^#/,'').replace(/^REF-?/i,'')} — they earn {1}–10% on your boosting rewards.</p>}
            </div>

            {signupError && (
              <p className="rounded-xl bg-red-950/40 border border-red-500/30 p-2.5 text-xs text-red-400">
                {signupError}
              </p>
            )}

            <button
              type="submit"
              disabled={isSigningUp}
              className="w-full h-12 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isSigningUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating serial account...</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Forgot Password Modal */}
      {showForgot && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={()=> setShowForgot(false)}>
          <div onClick={e=> e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400"/> {forgotStep==='EMAIL' ? 'Forgot Password' : 'Reset Password'}</h3>
              <button onClick={()=> setShowForgot(false)} className="rounded-xl p-1 text-zinc-500 hover:text-white cursor-pointer">✕</button>
            </div>
            {forgotMsg && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-300 flex items-center gap-2"><Check className="w-3.5 h-3.5"/>{forgotMsg}</div>}
            {forgotErr && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5"/>{forgotErr}</div>}
            {forgotStep==='EMAIL' ? (
              <form onSubmit={handleForgotRequest} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Your email</label>
                  <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 focus-within:border-amber-500 overflow-hidden">
                    <input type="text" value={cleanLocal(forgotEmail)} onChange={e=> setForgotEmail(cleanLocal(e.target.value))} placeholder="abir567" className="flex-1 bg-transparent px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none"/>
                    <span className="pr-3.5 text-xs font-mono text-zinc-400 select-none">@gmail.com</span>
                  </div>
                </div>
                <button type="submit" disabled={forgotLoading} className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer">{forgotLoading? <Loader2 className="w-4 h-4 animate-spin"/>: <Mail className="w-4 h-4"/>} {forgotLoading?'Sending...':'Send Reset Code'}</button>
                <p className="text-[10px] text-zinc-500 text-center">Code sent to your email inbox. Check spam folder if not found.</p>
              </form>
            ) : (
              <form onSubmit={handleForgotReset} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Verification code (6-digit)</label>
                  <input type="text" value={forgotCode} onChange={e=> setForgotCode(e.target.value)} placeholder="e.g. 123456" className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"/>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-400 mb-1">New password</label>
                  <input type="password" value={forgotNewPass} onChange={e=> setForgotNewPass(e.target.value)} placeholder="Min 4 characters" className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"/>
                </div>
                <button type="submit" disabled={forgotLoading} className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer">{forgotLoading? <Loader2 className="w-4 h-4 animate-spin"/>: <KeyRound className="w-4 h-4"/>} {forgotLoading?'Updating...':'Update Password'}</button>
                <button type="button" onClick={()=> { setForgotStep('EMAIL'); setForgotErr(''); setForgotMsg(''); }} className="w-full text-[11px] text-zinc-400 hover:text-white cursor-pointer">Back — resend code</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
