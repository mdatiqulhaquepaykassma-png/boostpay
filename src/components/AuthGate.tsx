import { FC, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Mail, Lock, Loader2 } from 'lucide-react';
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

  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const cleanEmail = loginEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setLoginError('Please enter a valid email address.');
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

    const cleanEmail = signupEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setSignupError('Please enter a valid email address.');
      return;
    }

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
      const newUser = await BoostPayStore.registerUser(cleanEmail, signupPassword);
      onLoginUser(newUser);
    } catch (err: any) {
      setSignupError(err.message || 'Registration failed.');
    } finally {
      setIsSigningUp(false);
    }
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
                <Mail className="w-3.5 h-3.5 text-amber-400" /> Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                placeholder="e.g. user@gmail.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
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
          </form>
        )}

        {/* 2. Create Account Form */}
        {tab === 'SIGNUP' && (
          <form onSubmit={completeSignup} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" /> Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                placeholder="e.g. user@gmail.com"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Your sequential User ID will be auto-generated starting from #1 upon signup.
              </p>
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
    </div>
  );
};
