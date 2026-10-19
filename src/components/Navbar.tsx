import React from 'react';
import { LogOut } from 'lucide-react';

/** Clean app header: BoostPay logo + sign-out only — account actions live in
 *  the Wallet page strip and the bottom navigation. */
export const Navbar: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {
  return (
    <header className="relative sticky top-0 z-30 flex items-center justify-center h-14 px-4 bg-[#09090b]/95 backdrop-blur-md border-b border-zinc-800/80">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20 overflow-hidden">
          <img src="/icon.svg" alt="BoostPay" className="w-7 h-7 object-contain" />
        </div>
        <div>
          <div className="text-[15px] font-extrabold text-white tracking-tight leading-none">BoostPay</div>
          <div className="text-[8px] text-amber-400 font-bold tracking-[0.14em]">SECURE WALLET</div>
        </div>
      </div>
      {onLogout && (
        <button
          onClick={onLogout}
          className="absolute right-3 w-9 h-9 rounded-full border border-zinc-800 bg-zinc-900/80 flex items-center justify-center text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition cursor-pointer active:scale-95"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      )}
    </header>
  );
};
