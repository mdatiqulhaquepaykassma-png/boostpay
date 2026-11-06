import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Timer, TrendingUp, Zap } from 'lucide-react';
import { BoostPayStore } from '../services/store';

/**
 * BoostPlanStrip — one thin row on the dashboard that answers, without opening
 * anything:
 *   · how long the current cycle still runs, and what it will pay at the end
 *   · how many cycles today: done / still possible
 *   · today's money: already earned, still to come, and the day's total
 *
 * Deliberately tiny (≈52 px). Everything is computed by the server
 * (`GET /api/user/boost-plan`) so the phone never has to know the compounding
 * rate and can never disagree with the ledger. A local 1 s ticker only moves the
 * countdown text between refreshes.
 */

type Plan = {
  serverTime: number;
  minutesLeftToday: number;
  balance: number;
  cycle: {
    running: boolean; paused: boolean;
    durationMs: number; elapsedMs: number; remainingMs: number;
    projectedIncome: number; accruedIncome: number; remainingIncome: number;
    startBal: number; endAt: number; endsAfterMidnight: boolean;
  };
  nextCycle: { durationMs: number; estimatedIncome: number };
  today: {
    cyclesDone: number; cyclesRemaining: number; cyclesPossible: number;
    cyclesPerDay?: number; missed?: number; missedIncome?: number; slotsSoFar?: number;
    earned: number; remainingIncome: number; projectedTotal: number;
  };
  lifetime?: {
    estimated: boolean; cycles: number;
    income: number; referralIncome: number; totalIncome: number;
    avgCycleMs: number; avgIncomePerCycle: number;
    slots: number; missed: number; missedIncome: number; sinceMs: number;
    days?: number; since?: number; truncated?: boolean;
    series?: Array<{
      day: string; ts: number; balance: number; cycleMs: number;
      slots: number; cycles: number; earned: number; referral: number;
      missed: number; missedIncome: number;
    }>;
  };
};

const money = (n: number | undefined): string => {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return '$' + v.toFixed(4);
  if (v < 1) return '$' + v.toFixed(3);
  if (v < 100) return '$' + v.toFixed(2);
  return '$' + Math.round(v).toLocaleString();
};

const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
};

const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

type Props = {
  /** Bumped by the shell whenever the user record changes (boost start/pause/finish). */
  refreshKey?: string | number;
  onOpenBoosting?: () => void;
};

export const BoostPlanStrip: FC<Props> = ({ refreshKey, onOpenBoosting }) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const [skew, setSkew] = useState(0);           // serverTime - phoneTime
  const fetchedAt = useRef(0);
  const [nowTick, setNowTick] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const token = BoostPayStore.getAuthToken();
      const tz = -new Date().getTimezoneOffset(); // minutes east of UTC (Dhaka = 360)
      const r = await fetch(`/api/user/boost-plan?tz=${tz}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined
      });
      if (!r.ok) return;
      const data: Plan = await r.json();
      fetchedAt.current = Date.now();
      setSkew(Number(data.serverTime) - Date.now());
      setPlan(data);
    } catch { /* the strip simply keeps the last numbers */ }
  }, []);

  // initial + whenever the boost state changes + every 30 s
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const id = window.setInterval(() => { void load(); }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  // 1 s local ticker, only for the countdown / progress between fetches
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const life = plan?.lifetime;

  const view = useMemo(() => {
    if (!plan) return null;
    const running = plan.cycle.running;
    const paused = plan.cycle.paused;
    const drift = nowTick - fetchedAt.current;      // ms since the fetch
    const remaining = running ? Math.max(0, plan.cycle.remainingMs - drift) : plan.cycle.remainingMs;
    const pct = running && plan.cycle.durationMs > 0
      ? Math.min(100, Math.max(0, ((plan.cycle.elapsedMs + drift) / plan.cycle.durationMs) * 100))
      : paused ? Math.min(100, Math.max(0, (plan.cycle.elapsedMs / plan.cycle.durationMs) * 100)) : 0;
    // what the current cycle will pay in total (accrued + still to come)
    const cycleTotal = plan.cycle.projectedIncome;
    return { running, paused, remaining, pct, cycleTotal };
  }, [plan, nowTick]);

  if (!plan || !view) return null;

  const { running, paused, remaining, pct, cycleTotal } = view;
  const t = plan.today;

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 text-left cursor-pointer active:bg-zinc-800/40 transition"
        title="Cycle, cycles today and today's income — tap for the breakdown"
      >
        <div className="flex items-center gap-2">
          {/* 1 · this cycle */}
          <div className="flex items-center gap-[6px] min-w-0">
            <Timer className={`w-3.5 h-3.5 shrink-0 ${running ? 'text-amber-400' : paused ? 'text-zinc-400' : 'text-zinc-500'}`} />
            <div className="leading-tight">
              <div className={`font-mono text-[11px] font-bold ${running ? 'text-amber-300' : 'text-zinc-400'}`}>
                {running ? clock(remaining) : paused ? 'paused' : 'idle'}
              </div>
              <div className="font-mono text-[9px] text-zinc-500">≈{money(cycleTotal)}</div>
            </div>
          </div>

          <div className="h-6 w-px bg-zinc-800 shrink-0" />

          {/* 2 · cycles today */}
          <div className="flex items-center gap-[6px] min-w-0">
            <Zap className={`w-3.5 h-3.5 shrink-0 ${t.cyclesRemaining > 0 ? 'text-amber-400' : 'text-zinc-500'}`} />
            <div className="leading-tight">
              <div className="font-mono text-[11px] font-bold text-zinc-200">
                {t.cyclesDone}<span className="text-zinc-500">/{t.cyclesPossible}</span>
              </div>
              <div className="text-[9px] text-zinc-500">{paused ? 'paused' : `${t.cyclesRemaining} left`}</div>
            </div>
          </div>

          <div className="h-6 w-px bg-zinc-800 shrink-0" />

          {/* 3 · today's money */}
          <div className="flex items-center gap-[6px] min-w-0 flex-1">
            <TrendingUp className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <div className="leading-tight min-w-0">
              <div className="font-mono text-[11px] font-bold text-emerald-300 truncate">
                {money(t.earned)}<span className="text-zinc-500">/{money(t.projectedTotal)}</span>
              </div>
              <div className="text-[9px] text-zinc-500 truncate">
                {paused
                  ? `paused · ${money(plan.cycle.remainingIncome)} held`
                  : plan.cycle.endsAfterMidnight
                    ? `after 12am ${money(plan.cycle.remainingIncome)}`
                    : `today · ${money(t.remainingIncome)} to go`}
              </div>
            </div>
          </div>

          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>

        {/* second thin line: missed cycles + what it cost — today and lifetime */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[9px] leading-none">
          <span className="whitespace-nowrap rounded-full bg-zinc-800/70 px-1.5 py-[3px] text-zinc-400">
            today <span className="font-bold text-zinc-200">{t.cyclesDone}/{t.cyclesPerDay ?? t.cyclesPossible}</span>
            {Number(t.missed) > 0 && <span className="font-bold text-rose-400"> · {t.missed} missed</span>}
          </span>
          {Number(t.missedIncome) > 0 && (
            <span className="whitespace-nowrap rounded-full bg-rose-500/10 px-1.5 py-[3px] font-bold text-rose-300">
              ≈{money(t.missedIncome)} profit miss
            </span>
          )}
          {life && (
            <span className="whitespace-nowrap rounded-full bg-zinc-800/70 px-1.5 py-[3px] text-zinc-400">
              life <span className="font-bold text-emerald-300">{money(life.income)}</span> in
              {Number(life.missedIncome) > 0 && <span className="font-bold text-rose-400"> · ≈{money(life.missedIncome)} profit miss</span>}
            </span>
          )}
        </div>

        {/* thin progress line — only while something is running */}
        {(running || paused) && (
          <div className="mt-2 h-[3px] w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${running ? 'bg-gradient-to-r from-amber-500 to-amber-300' : 'bg-zinc-600'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-800/80 px-3 py-2 space-y-1 bg-zinc-950/50">
          <Row label="Cycle" value={`${duration(plan.cycle.durationMs)} → ${money(plan.cycle.projectedIncome)}`} />
          <Row
            label={running ? 'This cycle left' : paused ? 'Paused at' : 'Next cycle'}
            value={running
              ? `${clock(remaining)} → +${money(plan.cycle.remainingIncome)}`
              : paused
                ? `${duration(plan.cycle.elapsedMs)} done · ${money(plan.cycle.accruedIncome)} held`
                : `${duration(plan.nextCycle.durationMs)} → +${money(plan.nextCycle.estimatedIncome)}`}
          />
          <Row
            label="Cycles today"
            value={t.cyclesRemaining
              ? `${t.cyclesDone} done · ${t.cyclesRemaining} more × ~${duration(plan.nextCycle.durationMs)}`
              : `${t.cyclesDone} done · none left today`}
          />
          {plan.cycle.endsAfterMidnight && (
            <Row label="This cycle ends" value="after midnight (counted tomorrow)" />
          )}
          <Row
            label="Income today"
            value={`${money(t.earned)} earned · ${money(t.remainingIncome)} left · ${money(t.projectedTotal)} total`}
            strong
          />
          <Row
            label="Profit missed today"
            value={`${t.missed ?? 0} ${(t.missed ?? 0) === 1 ? 'cycle' : 'cycles'} → ≈${money(t.missedIncome ?? 0)}`}
          />
          {life && (
            <>
              <Row
                label={`Lifetime income · ${life.days ?? 0}d`}
                value={`${money(life.income)} boost${Number(life.referralIncome) > 0 ? ` + ${money(life.referralIncome)} referral` : ''} · ${life.cycles} cycles`}
                strong
              />
              <Row
                label="Profit missed lifetime"
                value={`${life.missed} ${life.missed === 1 ? 'cycle' : 'cycles'} → ≈${money(life.missedIncome)}`}
              />
              {Array.isArray(life.series) && life.series.length > 0 && (
                <div className="mt-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/60">
                  <div className="flex items-center justify-between px-2 py-1.5 font-mono text-[8px] uppercase tracking-wider text-zinc-500">
                    <span>day by day · since {life.series[life.series.length - 1]?.day}{life.truncated ? ' (last 1y)' : ''}</span>
                    <span className="text-zinc-600">sum = lifetime</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 pb-1 font-mono text-[8px] uppercase tracking-wider text-zinc-600">
                    <span className="w-[46px] shrink-0">day</span>
                    <span className="w-[52px] shrink-0">bal</span>
                    <span className="w-[54px] shrink-0">profit</span>
                    <span className="ml-auto shrink-0">missed</span>
                    <span className="w-[26px] shrink-0 text-right">c/s</span>
                  </div>
                  <div className="max-h-[150px] overflow-y-auto overscroll-contain px-2 pb-1.5">
                    {life.series.map((d) => (
                      <div key={d.ts} className="flex items-center gap-1.5 border-t border-zinc-900/80 py-[5px] font-mono text-[9px] leading-none first:border-0">
                        <span className="w-[46px] shrink-0 text-zinc-400">{d.day.slice(5)}</span>
                        <span className="w-[52px] shrink-0 text-zinc-500">${d.balance.toFixed(2)}</span>
                        <span className={`w-[54px] shrink-0 font-bold ${d.earned > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
                          +{money(d.earned)}
                        </span>
                        <span className={`ml-auto shrink-0 font-bold ${d.missedIncome > 0 ? 'text-rose-300' : 'text-zinc-600'}`}>
                          {d.missed > 0 ? `≈${money(d.missedIncome)} miss` : 'no miss'}
                        </span>
                        <span className="w-[26px] shrink-0 text-right text-zinc-500">{d.cycles}/{d.slots}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {onOpenBoosting && (
            <button
              type="button"
              onClick={onOpenBoosting}
              className="mt-1 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 py-1.5 text-[10px] font-bold text-amber-300 active:scale-[0.99] transition"
            >
              {running ? 'Open boosting card' : 'Start the next cycle'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const Row: FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-[9px] uppercase tracking-wider text-zinc-500 shrink-0">{label}</span>
    <span className={`font-mono text-[10px] text-right ${strong ? 'font-bold text-emerald-300' : 'text-zinc-300'}`}>{value}</span>
  </div>
);

export default BoostPlanStrip;
