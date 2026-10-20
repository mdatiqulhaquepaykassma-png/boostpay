import { FC, memo } from 'react';

export const WalletSkeleton: FC = memo(() => {
  return (
    <div className="w-full px-4 py-4 space-y-4 animate-in fade-in duration-200">
      {/* 1. Main Balance Card Skeleton */}
      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/90 p-5 shadow-xl shimmer-mask">
        <div className="flex items-center justify-between mb-3">
          <div className="h-3.5 w-24 bg-zinc-800 rounded-md" />
          <div className="h-3 w-36 bg-zinc-800/80 rounded-md" />
        </div>

        {/* Large balance numbers skeleton */}
        <div className="my-3 flex items-baseline gap-2">
          <div className="h-10 w-48 bg-zinc-800 rounded-xl" />
          <div className="h-5 w-12 bg-zinc-800/70 rounded-md" />
        </div>

        {/* Send Button Skeleton */}
        <div className="mt-4">
          <div className="h-11 w-full bg-zinc-800/90 rounded-2xl" />
        </div>
      </div>

      {/* 2. Sub-tab switcher Skeleton */}
      <div className="flex rounded-2xl bg-zinc-900 border border-zinc-800 p-1 shimmer-mask">
        <div className="flex-1 h-9 bg-zinc-800 rounded-xl" />
        <div className="flex-1 h-9 bg-zinc-850/50 rounded-xl ml-1" />
      </div>

      {/* 3. Boosting Card Skeleton */}
      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/90 p-5 shadow-xl shimmer-mask space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-zinc-800" />
            <div className="space-y-1.5">
              <div className="h-4 w-36 bg-zinc-800 rounded-md" />
              <div className="h-3 w-48 bg-zinc-800/70 rounded-md" />
            </div>
          </div>
          <div className="h-5 w-20 bg-zinc-800/80 rounded-full" />
        </div>

        {/* Reward ticker container skeleton */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-3">
          <div className="flex justify-between">
            <div className="h-3 w-28 bg-zinc-800 rounded-md" />
            <div className="h-3 w-24 bg-zinc-800/60 rounded-md" />
          </div>
          <div className="h-8 w-40 bg-zinc-800 rounded-xl" />
          {/* Progress bar skeleton */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <div className="h-2.5 w-12 bg-zinc-800/70 rounded-md" />
              <div className="h-2.5 w-10 bg-zinc-800/70 rounded-md" />
              <div className="h-2.5 w-12 bg-zinc-800/70 rounded-md" />
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full" />
          </div>
        </div>

        {/* Action Button Skeleton */}
        <div className="h-11 w-full bg-zinc-800 rounded-2xl" />
      </div>

      {/* 4. Profit Metrics Skeleton */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-xl shimmer-mask">
        <div className="h-4 w-28 bg-zinc-800 rounded-md mb-3" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-14 rounded-2xl bg-zinc-950 border border-zinc-800/80 p-2.5" />
          <div className="h-14 rounded-2xl bg-zinc-950 border border-zinc-800/80 p-2.5" />
          <div className="h-14 rounded-2xl bg-zinc-950 border border-zinc-800/80 p-2.5" />
        </div>
      </div>

      {/* 5. Recent Transactions Skeleton */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl shimmer-mask space-y-3">
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 w-36 bg-zinc-800 rounded-md" />
          <div className="h-3 w-20 bg-zinc-800/60 rounded-md" />
        </div>
        <div className="space-y-2">
          <div className="h-14 rounded-xl bg-zinc-950/60 border border-zinc-800/70" />
          <div className="h-14 rounded-xl bg-zinc-950/60 border border-zinc-800/70" />
        </div>
      </div>
    </div>
  );
});

WalletSkeleton.displayName = 'WalletSkeleton';
