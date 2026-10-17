import { FC, useState } from 'react';
import { Copy, Check, LogOut, Sparkles, ShieldCheck } from 'lucide-react';
import { User } from '../types';
import { copyToClipboard } from '../services/store';
import { InstallButton } from './InstallButton';

interface Props {
  user: User | null;
  isAdmin?: boolean;
  onLogout: () => void;
}

export const Navbar: FC<Props> = ({ user, isAdmin = false, onLogout }) => {
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    if (!user) return;
    const ok = await copyToClipboard(user.id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-md px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 font-black shadow-md shadow-amber-500/20">
            <Sparkles className="w-4 h-4 fill-current" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-white block leading-none">
              BoostPay
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              Fintech Wallet
            </span>
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* In-app Install Button */}
          <InstallButton variant="compact" />

          {/* User ID copy button */}
          {user && (
            <button
              onClick={copyId}
              className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-mono font-medium text-zinc-300 hover:border-zinc-700 active:scale-95 transition cursor-pointer"
              title="Tap to copy User ID"
            >
              <span className="text-zinc-500">ID:</span>
              <span className="text-amber-400 font-bold">{user.id}</span>
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-500" />
              )}
            </button>
          )}

          {/* Discreet Admin Portal Button */}
          <a
            href="/admin"
            className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-400 hover:text-amber-400 hover:border-zinc-700 active:scale-95 transition"
            title="Open Admin Portal"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
          </a>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-red-400 hover:border-zinc-700 active:scale-95 transition cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
