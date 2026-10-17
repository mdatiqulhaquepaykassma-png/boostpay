import React, { FC, useState, useEffect, useRef, useMemo, memo } from 'react';
import { Zap, Pause, Play, Send, TrendingUp, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User, SystemConfig } from '../types';
import { RecentTransactionsSection } from './RecentTransactionsSection';
import { formatPrecisionAmount, formatStrict8Decimals, formatRatePercent } from '../utils/format';

interface BalanceTickerProps {
  intPart: string;
  decPart: string;
  isHighlighted?: boolean;
}

const BalanceTicker = React.memo(({ intPart, decPart, isHighlighted }: BalanceTickerProps) => (
  <div className={`flex items-baseline my-2 font-mono flex-wrap transition-all duration-700 rounded-2xl px-2.5 py-1 -mx-2.5 ${isHighlighted ? 'bg-emerald-500/15 border border-emerald-500/30 shadow-lg shadow-emerald-500/10 scale-[1.02] brightness-110 animate-pulse' : 'border border-transparent'}`}>
    <span className="text-2xl font-bold text-amber-400 mr-1">$</span>
    <span className={`text-4xl font-extrabold tracking-tight transition-colors duration-500 ${isHighlighted ? 'text-emerald-300' : 'text-white'}`}>
      {Number(intPart).toLocaleString()}
    </span>
    <span className={`text-2xl font-bold transition-colors duration-500 ${isHighlighted ? 'text-emerald-400' : 'text-amber-400'}`}>
      .{decPart}
    </span>
    <span className="text-xs font-mono text-zinc-500 ml-1.5 self-end pb-1">USD</span>
  </div>
));

interface Props {
  user: User;
  onUpdateUser: (user: User) => void;
  onOpenSendMoney: () => void;
  config: SystemConfig;
}

export const WalletView: FC<Props> = ({
  user,
  onUpdateUser,
  onOpenSendMoney,
  config
}) => {
  const [zeroBalanceWarning, setZeroBalanceWarning] = useState(false);
  const [completionBanner, setCompletionBanner] = useState<{ amount: number } | null>(null);

  // Live session yield ticker state
  const [liveYield, setLiveYield] = useState(user.boostState.accumulatedYield || 0);
  const [elapsedMs, setElapsedMs] = useState(user.boostState.elapsedMs || 0);
  const [isHighlighted, setIsHighlighted] = useState(false);

  const prevBalanceRef = useRef(user.balance);
  const prevYieldRef = useRef(liveYield);

  // Synchronize with user prop changes
  useEffect(() => {
    setLiveYield(user.boostState.accumulatedYield || 0);
    setElapsedMs(user.boostState.elapsedMs || 0);

    // If balance increased due to reward credit while app was in background or reloaded
    if (user.balance > prevBalanceRef.current && !user.boostState.isActive) {
      const diff = user.balance - prevBalanceRef.current;
      setCompletionBanner({ amount: diff });
    }
    prevBalanceRef.current = user.balance;
  }, [user.boostState.elapsedMs, user.boostState.accumulatedYield, user.balance, user.boostState.isActive]);

  // Trigger subtle green highlight when background yield accumulates or balance increases
  useEffect(() => {
    if (liveYield - prevYieldRef.current > 0.0005 || user.balance > prevBalanceRef.current) {
      setIsHighlighted(true);
      const timer = setTimeout(() => setIsHighlighted(false), 900);
      return () => clearTimeout(timer);
    }
    prevYieldRef.current = liveYield;
  }, [liveYield, user.balance]);

  const allUsers = useMemo(() => BoostPayStore.getUsers(), []);
  const dynamicTargetDurationMs = useMemo(() => 
    user.boostState.targetDurationMs || BoostPayStore.calculateDynamicDuration(user.balance, allUsers)
  , [user.boostState.targetDurationMs, user.balance, allUsers]);

  // Smooth continuous server synchronization
  useEffect(() => {
    const syncWithServer = async () => {
      const freshUser = await BoostPayStore.syncUserFromServer(user.id);
      if (freshUser) {
        const b1 = user.boostState;
        const b2 = freshUser.boostState;
        const boostStateChanged =
          b1.isActive !== b2.isActive ||
          b1.isPaused !== b2.isPaused ||
          b1.startingBalance !== b2.startingBalance ||
          b1.targetDurationMs !== b2.targetDurationMs ||
          Math.abs((b1.elapsedMs || 0) - (b2.elapsedMs || 0)) > 2000;

        if (
          freshUser.balance !== user.balance ||
          freshUser.lifetimeProfit !== user.lifetimeProfit ||
          boostStateChanged
        ) {
          onUpdateUser(freshUser);
        }
      }
    };

    const intervalTime = (user.boostState.isActive && !user.boostState.isPaused) ? 5000 : 10000;
    const interval = setInterval(syncWithServer, intervalTime);

    return () => clearInterval(interval);
  }, [user.id, user.boostState.isActive, user.boostState.isPaused, user.balance, user.lifetimeProfit, user.boostState.startingBalance, user.boostState.targetDurationMs, onUpdateUser]);

  // Client-side smooth interpolation ticker
  useEffect(() => {
    const isRunning = user.boostState.isActive && !user.boostState.isPaused;
    if (!isRunning) return;

    let rafId: number;
    const ratePerMs = (config.hourlyRatePercent / 100) / 3600000;
    let lastTick = Date.now();

    const animate = () => {
      const now = Date.now();
      const delta = now - lastTick;
      
      setElapsedMs((prev: number) => {
        const next = Math.min(prev + delta, user.boostState.targetDurationMs || dynamicTargetDurationMs);
        
        // Finalize boost completion
        if (next >= (user.boostState.targetDurationMs || dynamicTargetDurationMs)) {
            BoostPayStore.syncUserFromServer(user.id).then((fresh) => {
                if (fresh) onUpdateUser(fresh);
            });
            return next;
        }

        const startingBal = Number(user.boostState.startingBalance ?? user.balance);
        const accrued = ratePerMs > 0
          ? (next * ratePerMs < 1e-5
              ? startingBal * next * ratePerMs
              : startingBal * Math.expm1(next * Math.log1p(ratePerMs)))
          : 0;
        setLiveYield(accrued);
        return next;
      });

      lastTick = now;
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafId);
  }, [user.boostState.isActive, user.boostState.isPaused, user.balance, user.boostState.startingBalance, user.boostState.targetDurationMs, dynamicTargetDurationMs, config.hourlyRatePercent, user.id, onUpdateUser]);

  const handleStartBoost = async () => {
    if (user.balance <= 0) {
      setZeroBalanceWarning(true);
      setTimeout(() => setZeroBalanceWarning(false), 3500);
      return;
    }

    const updatedUser = await BoostPayStore.startServerBoost(user.id);
    if (updatedUser) {
      onUpdateUser(updatedUser);
      setElapsedMs(0);
      setLiveYield(0);
    }
  };

  const handlePauseBoost = async () => {
    const updatedUser = await BoostPayStore.pauseServerBoost(user.id);
    if (updatedUser) {
      onUpdateUser(updatedUser);
    }
  };

  const handleResumeBoost = async () => {
    const updatedUser = await BoostPayStore.resumeServerBoost(user.id);
    if (updatedUser) {
      onUpdateUser(updatedUser);
    }
  };

  const formatDuration = (ms: number): string => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const isBoostRunning = user.boostState.isActive && !user.boostState.isPaused;
  const isBoostPaused = user.boostState.isActive && user.boostState.isPaused;
  const progressPercent = Math.min(100, Math.max(0, (elapsedMs / (dynamicTargetDurationMs || 1)) * 100));

  // High precision 8-decimal formatting for main balance
  const { intPart, decPart } = useMemo(() => {
    const balanceStr = formatStrict8Decimals(liveYield + user.balance);
    const [int, dec] = balanceStr.split('.');
    return { intPart: int, decPart: dec };
  }, [liveYield, user.balance]);

  // Profit calculations
  const { todayProfit, sevenDayProfit } = useMemo(() => {
    const allTxs = BoostPayStore.getTransactions().filter(t => t.userId === user.id && (t.type === 'REWARD' || t.type === 'ADMIN_CREDIT'));
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return {
      todayProfit: allTxs
        .filter(t => t.timestamp >= oneDayAgo)
        .reduce((sum, t) => sum + t.amount, 0),
      sevenDayProfit: allTxs
        .filter(t => t.timestamp >= sevenDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0)
    };
  }, [user.id]);

  return (
    <div className="w-full px-4 py-4 space-y-4">
      {/* Auto-credit completion banner */}
      {completionBanner && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/50 p-3.5 flex items-center justify-between shadow-lg animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="text-xs text-zinc-200">
              <span className="font-bold text-emerald-400 block">Boosting Completed!</span>
              +${formatPrecisionAmount(completionBanner.amount, 8)} USD added to main balance.
            </div>
          </div>
          <button
            onClick={() => setCompletionBanner(null)}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Zero balance warning dialog */}
      {zeroBalanceWarning && (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/40 p-3.5 flex items-center gap-2.5 shadow-lg">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <div className="text-xs text-red-200">
            Account balance is $0.00. Receive a transfer or credit to begin boosting.
          </div>
        </div>
      )}

      {/* Main Balance Card with High Precision Large Decimals */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
          <span className="font-medium tracking-wide">Main Balance</span>
          <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Realtime 24/7 Server Sync
          </span>
        </div>

        {/* Large Decimals Display */}
        <BalanceTicker intPart={intPart} decPart={decPart} isHighlighted={isHighlighted} />

        {/* Transfer Button */}
        <div className="mt-4">
          <button
            onClick={onOpenSendMoney}
            className={`w-full h-11 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
              isBoostRunning
                ? 'border border-zinc-800 bg-zinc-950 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700/80 active:scale-[0.98]'
            }`}
          >
            <Send className="w-3.5 h-3.5 text-amber-400" />
            {isBoostRunning ? 'Transfers Locked During Boost' : 'Send Money (P2P)'}
          </button>
        </div>
      </div>

      {/* Dynamic Compounding Yield Card */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 shadow-xl relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl ${isBoostRunning ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-zinc-800 text-zinc-400'}`}>
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Dynamic Compounding</h3>
              <p className="text-[11px] text-zinc-400">
                Rate: <span className="font-mono text-amber-400">{formatRatePercent(config.hourlyRatePercent)}%/hr</span> · Duration: <span className="font-mono text-zinc-300">{formatDuration(dynamicTargetDurationMs)}</span>
              </p>
            </div>
          </div>
          {isBoostRunning && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono text-amber-400 font-bold">
              ACTIVE (24/7)
            </span>
          )}
          {isBoostPaused && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400 font-bold">
              PAUSED
            </span>
          )}
        </div>

        {/* Session Yield */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3.5 mb-3.5">
          <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
            <span>Accruing Reward</span>
            <span className="font-mono text-zinc-500">Auto-credits on finish</span>
          </div>

          <div className="flex items-baseline font-mono text-amber-400">
            <span className="text-lg font-bold mr-0.5">+$</span>
            <span className="text-2xl font-black tracking-tight">{formatStrict8Decimals(liveYield)}</span>
            <span className="text-xs text-zinc-500 ml-1">USD</span>
          </div>

          {/* Progress bar */}
          <div className="mt-2.5">
            <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-1">
              <span>{formatDuration(elapsedMs)}</span>
              <span>{progressPercent.toFixed(1)}%</span>
              <span>{formatDuration(dynamicTargetDurationMs)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div>
          {!user.boostState.isActive ? (
            <button
              onClick={handleStartBoost}
              className="w-full h-11 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
            >
              <Zap className="w-4 h-4 fill-current" /> Start Compounding
            </button>
          ) : isBoostPaused ? (
            <button
              onClick={handleResumeBoost}
              className="w-full h-11 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
            >
              <Play className="w-4 h-4 fill-current" /> Resume Compounding
            </button>
          ) : (
            <button
              onClick={handlePauseBoost}
              className="w-full h-11 rounded-2xl border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-200 hover:bg-zinc-750 active:scale-[0.98] transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Pause className="w-4 h-4" /> Pause (Unlocks Transfers)
            </button>
          )}
        </div>
      </div>

      {/* Profit Metrics */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl">
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h4 className="font-semibold text-xs text-white">Profit Metrics</h4>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center font-mono">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
            <span className="text-[10px] text-zinc-500 block mb-0.5">Today</span>
            <span className="text-xs font-bold text-emerald-400">+${formatPrecisionAmount(todayProfit, 8)}</span>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
            <span className="text-[10px] text-zinc-500 block mb-0.5">7 Days</span>
            <span className="text-xs font-bold text-emerald-400">+${formatPrecisionAmount(sevenDayProfit, 8)}</span>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
            <span className="text-[10px] text-zinc-500 block mb-0.5">Lifetime</span>
            <span className="text-xs font-bold text-amber-400">+${formatPrecisionAmount(user.lifetimeProfit, 8)}</span>
          </div>
        </div>
      </div>

      {/* Transactions Section */}
      <RecentTransactionsSection
        transactions={BoostPayStore.getTransactions()}
        userId={user.id}
      />
    </div>
  );
};
