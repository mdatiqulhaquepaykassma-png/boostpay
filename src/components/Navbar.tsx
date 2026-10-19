import React, { FC, useState, memo } from 'react';
import { Copy, Check, LogOut, ShieldCheck, QrCode } from 'lucide-react';
import { User } from '../types';
import { copyToClipboard } from '../services/store';
import { InstallButton } from './InstallButton';

interface Props {
  user: User | null;
  isAdmin?: boolean;
  onLogout: () => void;
  onOpenSecurity?: () => void;
  onOpenQR?: () => void;
}

export const Navbar: FC<Props> = memo(({ user, isAdmin = false, onLogout, onOpenSecurity, onOpenQR }) => {
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
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-b from-zinc-800 to-zinc-950 border border-zinc-800 shadow-lg">
            <svg viewBox="0 0 512 512" className="h-5 w-5">
              <path d="M292 64L140 288h124l-44 160 152-224H248l44-160z" fill="#f59e0b" stroke="#d97706" strokeWidth="10" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-bold text-[15px] tracking-tight text-white leading-none">
            BoostPay
          </span>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* In-app Install Button */}
          <InstallButton variant="compact" />

          {/* QR Pay */}
          {user && onOpenQR && (
            <button
              onClick={onOpenQR}
              className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 active:scale-95 transition cursor-pointer"
              title="QR Pay — show or scan"
            >
              <QrCode className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Security Center */}
          {user && onOpenSecurity && (
            <button
              onClick={onOpenSecurity}
              className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 active:scale-95 transition cursor-pointer"
              title="Security Center — anti-phishing code & devices"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
            </button>
          )}

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
});

Navbar.displayName = 'Navbar';
