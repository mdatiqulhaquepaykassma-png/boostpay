import React from 'react';

/** Clean app header: the BoostPay logo only. */
export const Navbar: React.FC = () => {
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
    </header>
  );
};
