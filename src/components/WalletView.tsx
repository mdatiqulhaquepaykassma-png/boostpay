import React, { FC, useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { Zap, Pause, Play, Send, TrendingUp, AlertCircle, Sparkles, History } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User, BoostState, SystemConfig } from '../types';
import { RecentTransactionsSection } from './RecentTransactionsSection';
import { PaginatedTransactionsView } from './PaginatedTransactionsView';
import { SmoothNumericTicker } from './SmoothNumericTicker';
import { formatPrecisionAmount, formatRatePercent, formatCompoundingRateDual } from '../utils/format';

function formatDuration(ms: number): string {
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
}

// ==========================================
// 1. ISOLATED LIVE BALANCE CARD (MEMOIZED)
// ==========================================
interface BalanceCardProps {
  baseBalance: number;
  boostState: BoostState;
  dynamicTargetDurationMs: number;
  minuteRatePercent: number;
  onOpenSendMoney: () => void;
}

const IsolatedLiveBalanceCard: FC<BalanceCardProps> = memo(({
  baseBalance,
  boostState,
  dynamicTargetDurationMs,
  minuteRatePercent,
  onOpenSendMoney
}) => {
  const isRunning = boostState.isActive && !boostState.isPaused;
  const [liveAccrued, setLiveAccrued] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setLiveAccrued(0);
      return;
    }

    let rafId: number;
    let lastRender = 0;
    const ratePerMs = (minuteRatePercent / 100) / 60000;
    const startingBal = Number(boostState.startingBalance ?? baseBalance);
    const targetMs = boostState.targetDurationMs || dynamicTargetDurationMs;
    const initialElapsed = boostState.elapsedMs || 0;
    const mountTime = Date.now();

    const tick = () => {
      const now = Date.now();
      const currentElapsed = boostState.startedAt && boostState.startedAt > 0
        ? Math.min(now - boostState.startedAt, targetMs)
        : Math.min(initialElapsed + (now - mountTime), targetMs);
      
      if (now - lastRender >= 50 || currentElapsed >= targetMs) {
        lastRender = now;
        const accrued = ratePerMs > 0
          ? (currentElapsed * ratePerMs < 1e-5
              ? startingBal * currentElapsed * ratePerMs
              : startingBal * Math.expm1(currentElapsed * Math.log1p(ratePerMs)))
          : 0;

        setLiveAccrued(accrued);
      }

      if (currentElapsed < targetMs) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    isRunning,
    baseBalance,
    boostState.startingBalance,
    boostState.startedAt,
    boostState.elapsedMs,
    boostState.targetDurationMs,
    dynamicTargetDurationMs,
    minuteRatePercent
  ]);

  const currentTotal = baseBalance + liveAccrued;

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 shadow-xl relative overflow-hidden">
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
        <span className="font-medium tracking-wide">Main Balance</span>
        <span className="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
          Realtime 24/7 Server Sync
        </span>
      </div>

      {/* Smooth high-precision live balance ticker without pulses or card scaling */}
      <div className="my-2.5">
        <SmoothNumericTicker
          value={currentTotal}
          decimals={8}
          prefix="$"
          suffix="USD"
          size="xl"
          intColor="text-white"
          decColor="text-amber-400"
        />
      </div>

      {/* Transfer Button */}
      <div className="mt-4">
        <button
          onClick={onOpenSendMoney}
          disabled={isRunning}
          className={`w-full h-11 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
            isRunning
              ? 'border border-zinc-800 bg-zinc-950 text-zinc-500 cursor-not-allowed opacity-80'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700/80 active:scale-[0.98]'
          }`}
        >
          <Send className="w-3.5 h-3.5 text-amber-400" />
          {isRunning ? 'Transfers Locked During Boost' : 'Send Money (P2P)'}
        </button>
      </div>
    </div>
  );
});

IsolatedLiveBalanceCard.displayName = 'IsolatedLiveBalanceCard';

// ===============================================
// 2. ISOLATED COMPOUNDING CARD (MEMOIZED PROGRESS)
// ===============================================
interface CompoundingCardProps {
  userId: string;
  baseBalance: number;
  boostState: BoostState;
  dynamicTargetDurationMs: number;
  minuteRatePercent: number;
  onStartBoost: () => void;
  onPauseBoost: () => void;
  onResumeBoost: () => void;
  onBoostFinished: (freshUser: User) => void;
}

const IsolatedCompoundingCard: FC<CompoundingCardProps> = memo(({
  userId,
  baseBalance,
  boostState,
  dynamicTargetDurationMs,
  minuteRatePercent,
  onStartBoost,
  onPauseBoost,
  onResumeBoost,
  onBoostFinished
}) => {
  const isRunning = boostState.isActive && !boostState.isPaused;
  const isPaused = boostState.isActive && boostState.isPaused;

  const [elapsedMs, setElapsedMs] = useState(boostState.elapsedMs || 0);
  const [liveYield, setLiveYield] = useState(boostState.accumulatedYield || 0);

  // Synchronize when boostState properties change externally
  useEffect(() => {
    setElapsedMs(boostState.elapsedMs || 0);
    setLiveYield(boostState.accumulatedYield || 0);
  }, [boostState.elapsedMs, boostState.accumulatedYield, boostState.isActive, boostState.isPaused]);

  // Self-contained high-frequency RAF ticker for live yield and progress bar
  useEffect(() => {
    if (!isRunning) return;

    let rafId: number;
    let lastRender = 0;
    const ratePerMs = (minuteRatePercent / 100) / 60000;
    const targetMs = boostState.targetDurationMs || dynamicTargetDurationMs;
    const startingBal = Number(boostState.startingBalance ?? baseBalance);
    const initialElapsed = boostState.elapsedMs || 0;
    const mountTime = Date.now();

    const tick = () => {
      const now = Date.now();
      const nextElapsed = boostState.startedAt && boostState.startedAt > 0
        ? Math.min(now - boostState.startedAt, targetMs)
        : Math.min(initialElapsed + (now - mountTime), targetMs);

      if (now - lastRender >= 50 || nextElapsed >= targetMs) {
        lastRender = now;
        setElapsedMs(nextElapsed);

        const accrued = ratePerMs > 0
          ? (nextElapsed * ratePerMs < 1e-5
              ? startingBal * nextElapsed * ratePerMs
              : startingBal * Math.expm1(nextElapsed * Math.log1p(ratePerMs)))
          : 0;
        setLiveYield(accrued);
      }

      if (nextElapsed >= targetMs) {
        // Boost complete! Fetch authoritative fresh user once
        BoostPayStore.syncUserFromServer(userId).then((fresh) => {
          if (fresh) onBoostFinished(fresh);
        });
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    isRunning,
    userId,
    baseBalance,
    boostState.startingBalance,
    boostState.startedAt,
    boostState.elapsedMs,
    boostState.targetDurationMs,
    dynamicTargetDurationMs,
    minuteRatePercent,
    onBoostFinished
  ]);

  const targetDuration = boostState.targetDurationMs || dynamicTargetDurationMs || 1;
  const progressPercent = Math.min(100, Math.max(0, (elapsedMs / targetDuration) * 100));

  // Compute equivalent hourly rate for dual display
  const hourlyEquiv = ((Math.pow(1 + minuteRatePercent / 100, 60) - 1) * 100);

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-5 shadow-xl relative">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-xl ${isRunning ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400'}`}>
            <Zap className="w-4 h-4 fill-current" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white">Dynamic Compounding</h3>
            <p className="text-[11px] text-zinc-400">
              Rate: <span className="font-mono text-amber-400 font-semibold">{formatRatePercent(minuteRatePercent)}%/min</span> <span className="text-zinc-500 font-mono text-[10px]">(~{hourlyEquiv.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%/hr)</span> · Duration: <span className="font-mono text-zinc-300">{formatDuration(targetDuration)}</span>
            </p>
          </div>
        </div>
        {isRunning && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono text-amber-400 font-bold border border-amber-500/30">
            ACTIVE (24/7)
          </span>
        )}
        {isPaused && (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400 font-bold border border-zinc-700">
            PAUSED
          </span>
        )}
      </div>

      {/* Accruing Reward Section with Smooth Monospace Digit Transitions */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3.5 mb-3.5">
        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
          <span>Accruing Reward</span>
          <span className="font-mono text-zinc-500">Auto-credits on finish</span>
        </div>

        <div className="my-1">
          <SmoothNumericTicker
            value={liveYield}
            decimals={8}
            prefix="+$"
            suffix="USD"
            size="lg"
            intColor="text-amber-400"
            decColor="text-amber-400"
            prefixColor="text-amber-400"
          />
        </div>

        {/* Isolated Smooth Progress Bar */}
        <div className="mt-2.5">
          <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-1 select-none">
            <span>{formatDuration(elapsedMs)}</span>
            <span className="text-zinc-300 font-semibold">{progressPercent.toFixed(1)}%</span>
            <span>{formatDuration(targetDuration)}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-[width] duration-150 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Action Controls */}
      <div>
        {!boostState.isActive ? (
          <button
            onClick={onStartBoost}
            className="w-full h-11 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
          >
            <Zap className="w-4 h-4 fill-current" /> Start Compounding
          </button>
        ) : isPaused ? (
          <button
            onClick={onResumeBoost}
            className="w-full h-11 rounded-2xl bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
          >
            <Play className="w-4 h-4 fill-current" /> Resume Compounding
          </button>
        ) : (
          <button
            onClick={onPauseBoost}
            className="w-full h-11 rounded-2xl border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-200 hover:bg-zinc-750 active:scale-[0.98] transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Pause className="w-4 h-4" /> Pause (Unlocks Transfers)
          </button>
        )}
      </div>
    </div>
  );
});

IsolatedCompoundingCard.displayName = 'IsolatedCompoundingCard';

// ==========================================
// 3. ISOLATED PROFIT METRICS CARD (MEMOIZED)
// ==========================================
interface ProfitMetricsProps {
  userId: string;
  lifetimeProfit: number;
}

const IsolatedProfitMetrics: FC<ProfitMetricsProps> = memo(({ userId, lifetimeProfit }) => {
  const { todayProfit, sevenDayProfit } = useMemo(() => {
    const allTxs = BoostPayStore.getTransactions().filter(
      (t) => t.userId === userId && (t.type === 'REWARD' || t.type === 'ADMIN_CREDIT')
    );
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return {
      todayProfit: allTxs
        .filter((t) => t.timestamp >= oneDayAgo)
        .reduce((sum, t) => sum + t.amount, 0),
      sevenDayProfit: allTxs
        .filter((t) => t.timestamp >= sevenDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0)
    };
  }, [userId]);

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl">
      <div className="flex items-center gap-1.5 mb-3">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <h4 className="font-semibold text-xs text-white">Profit Metrics</h4>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center font-mono">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
          <span className="text-[10px] text-zinc-500 block mb-0.5">Today</span>
          <span className="text-xs font-bold text-emerald-400">
            +${formatPrecisionAmount(todayProfit, 8)}
          </span>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
          <span className="text-[10px] text-zinc-500 block mb-0.5">7 Days</span>
          <span className="text-xs font-bold text-emerald-400">
            +${formatPrecisionAmount(sevenDayProfit, 8)}
          </span>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5">
          <span className="text-[10px] text-zinc-500 block mb-0.5">Lifetime</span>
          <span className="text-xs font-bold text-amber-400">
            +${formatPrecisionAmount(lifetimeProfit, 8)}
          </span>
        </div>
      </div>
    </div>
  );
});

IsolatedProfitMetrics.displayName = 'IsolatedProfitMetrics';

// ==========================================
// 4. MAIN WALLET VIEW CONTAINER
// ==========================================
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
  const [walletTab, setWalletTab] = useState<'OVERVIEW' | 'TRANSACTIONS'>('OVERVIEW');
  const [zeroBalanceWarning, setZeroBalanceWarning] = useState(false);
  const [completionBanner, setCompletionBanner] = useState<{ amount: number } | null>(null);

  const prevBalanceRef = useRef(user.balance);

  // Detect completed boost reward credits
  useEffect(() => {
    if (user.balance > prevBalanceRef.current && !user.boostState.isActive) {
      const diff = user.balance - prevBalanceRef.current;
      setCompletionBanner({ amount: diff });
    }
    prevBalanceRef.current = user.balance;
  }, [user.balance, user.boostState.isActive]);

  const allUsers = useMemo(() => BoostPayStore.getUsers(), []);
  const dynamicTargetDurationMs = useMemo(
    () => user.boostState.targetDurationMs || BoostPayStore.calculateDynamicDuration(user.balance, allUsers),
    [user.boostState.targetDurationMs, user.balance, allUsers]
  );

  const handleStartBoost = useCallback(async () => {
    if (user.balance <= 0) {
      setZeroBalanceWarning(true);
      setTimeout(() => setZeroBalanceWarning(false), 3500);
      return;
    }

    const updatedUser = await BoostPayStore.startServerBoost(user.id);
    if (updatedUser) {
      onUpdateUser(updatedUser);
    }
  }, [user.balance, user.id, onUpdateUser]);

  const handlePauseBoost = useCallback(async () => {
    const updatedUser = await BoostPayStore.pauseServerBoost(user.id);
    if (updatedUser) {
      onUpdateUser(updatedUser);
    }
  }, [user.id, onUpdateUser]);

  const handleResumeBoost = useCallback(async () => {
    const updatedUser = await BoostPayStore.resumeServerBoost(user.id);
    if (updatedUser) {
      onUpdateUser(updatedUser);
    }
  }, [user.id, onUpdateUser]);

  const handleBoostFinished = useCallback((freshUser: User) => {
    onUpdateUser(freshUser);
  }, [onUpdateUser]);

  return (
    <div className="w-full px-4 py-4 space-y-4">
      {/* Auto-credit completion banner */}
      {completionBanner && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/50 p-3.5 flex items-center justify-between shadow-lg">
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

      {/* 1. MEMOIZED ISOLATED MAIN BALANCE CARD (Updates only its numbers, no app re-render, no pulse, no card scaling) */}
      <IsolatedLiveBalanceCard
        baseBalance={user.balance}
        boostState={user.boostState}
        dynamicTargetDurationMs={dynamicTargetDurationMs}
        minuteRatePercent={config.minuteRatePercent !== undefined ? config.minuteRatePercent : (config.hourlyRatePercent ? config.hourlyRatePercent / 60 : 0.001605)}
        onOpenSendMoney={onOpenSendMoney}
      />

      {/* 2. SUB-TAB SWITCHER: OVERVIEW (COMPOUNDING) vs TRANSACTIONS */}
      <div className="flex rounded-2xl bg-zinc-900 border border-zinc-800 p-1">
        <button
          onClick={() => setWalletTab('OVERVIEW')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition cursor-pointer min-h-[44px] ${
            walletTab === 'OVERVIEW'
              ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Compounding</span>
        </button>
        <button
          onClick={() => setWalletTab('TRANSACTIONS')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition cursor-pointer min-h-[44px] ${
            walletTab === 'TRANSACTIONS'
              ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Transactions</span>
        </button>
      </div>

      {walletTab === 'OVERVIEW' ? (
        <>
          {/* 3. MEMOIZED ISOLATED DYNAMIC COMPOUNDING CARD (Holds progress bar and accruing reward ticker) */}
          <IsolatedCompoundingCard
            userId={user.id}
            baseBalance={user.balance}
            boostState={user.boostState}
            dynamicTargetDurationMs={dynamicTargetDurationMs}
            minuteRatePercent={config.minuteRatePercent !== undefined ? config.minuteRatePercent : (config.hourlyRatePercent ? config.hourlyRatePercent / 60 : 0.001605)}
            onStartBoost={handleStartBoost}
            onPauseBoost={handlePauseBoost}
            onResumeBoost={handleResumeBoost}
            onBoostFinished={handleBoostFinished}
          />

          {/* 4. MEMOIZED PROFIT METRICS SECTION */}
          <IsolatedProfitMetrics
            userId={user.id}
            lifetimeProfit={user.lifetimeProfit}
          />

          {/* 5. MEMOIZED RECENT TRANSACTIONS SECTION */}
          <RecentTransactionsSection
            transactions={BoostPayStore.getTransactions()}
            userId={user.id}
            onViewAllTransactions={() => setWalletTab('TRANSACTIONS')}
          />
        </>
      ) : (
        /* TRANSACTIONS TAB: SCROLLABLE, PAGINATED P2P TRANSFERS AND YIELD EVENTS */
        <PaginatedTransactionsView
          transactions={BoostPayStore.getTransactions()}
          userId={user.id}
        />
      )}
    </div>
  );
};
