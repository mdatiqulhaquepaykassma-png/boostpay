import React, { FC, memo } from 'react';

interface DigitSlotProps {
  char: string;
  charWidthClass?: string;
}

const DigitSlot: FC<DigitSlotProps> = memo(({ char, charWidthClass = 'w-[0.58em]' }) => {
  if (char === '.' || char === ',') {
    return (
      <span className="inline-block select-none font-mono tabular-nums text-zinc-400 w-[0.28em] text-center">
        {char}
      </span>
    );
  }

  return (
    <span className={`inline-block select-none font-mono tabular-nums text-center ${charWidthClass}`}>
      {char}
    </span>
  );
});

DigitSlot.displayName = 'DigitSlot';

interface Props {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  size?: 'xl' | 'lg' | 'md' | 'sm';
  intColor?: string;
  decColor?: string;
  prefixColor?: string;
  className?: string;
}

export const SmoothNumericTicker: FC<Props> = memo(({
  value,
  decimals = 8,
  prefix = '$',
  suffix = 'USD',
  size = 'xl',
  intColor = 'text-white',
  decColor = 'text-amber-400',
  prefixColor = 'text-amber-400',
  className = ''
}) => {
  const safeVal = isNaN(value) || value < 0 ? 0 : value;
  const fixedStr = safeVal.toFixed(decimals);
  const [intPartRaw, decPartRaw] = fixedStr.split('.');

  const intFormatted = Number(intPartRaw).toLocaleString('en-US');
  const intChars = intFormatted.split('');
  const decChars = (decPartRaw || '').padEnd(decimals, '0').split('');

  if (size === 'xl') {
    return (
      <div className={`flex items-baseline font-mono select-none flex-wrap ${className}`}>
        {prefix && (
          <span className={`text-2xl font-bold mr-1 ${prefixColor}`}>
            {prefix}
          </span>
        )}
        <span className={`text-4xl font-extrabold tracking-tight flex items-baseline ${intColor}`}>
          {intChars.map((ch, i) => (
            <DigitSlot key={`int-${i}`} char={ch} charWidthClass="w-[0.58em]" />
          ))}
        </span>
        <span className={`text-2xl font-bold flex items-baseline ml-0.5 ${decColor}`}>
          <span className="inline-block select-none font-mono text-zinc-500 w-[0.28em] text-center">.</span>
          {decChars.map((ch, i) => (
            <DigitSlot key={`dec-${i}`} char={ch} charWidthClass="w-[0.58em]" />
          ))}
        </span>
        {suffix && (
          <span className="text-xs font-mono text-zinc-500 ml-1.5 self-end pb-1 font-semibold">
            {suffix}
          </span>
        )}
      </div>
    );
  }

  if (size === 'lg') {
    return (
      <div className={`flex items-baseline font-mono select-none flex-wrap ${className}`}>
        {prefix && (
          <span className={`text-lg font-bold mr-0.5 ${prefixColor}`}>
            {prefix}
          </span>
        )}
        <span className={`text-2xl font-black tracking-tight flex items-baseline ${intColor}`}>
          {intChars.map((ch, i) => (
            <DigitSlot key={`int-${i}`} char={ch} charWidthClass="w-[0.58em]" />
          ))}
        </span>
        <span className={`text-2xl font-black tracking-tight flex items-baseline ml-0.5 ${decColor}`}>
          <span className="inline-block select-none font-mono text-zinc-500 w-[0.28em] text-center">.</span>
          {decChars.map((ch, i) => (
            <DigitSlot key={`dec-${i}`} char={ch} charWidthClass="w-[0.58em]" />
          ))}
        </span>
        {suffix && (
          <span className="text-xs font-mono text-zinc-500 ml-1 self-end pb-0.5">
            {suffix}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-baseline font-mono select-none flex-wrap ${className}`}>
      {prefix && (
        <span className={`text-xs font-bold mr-0.5 ${prefixColor}`}>
          {prefix}
        </span>
      )}
      <span className={`text-sm font-bold flex items-baseline ${intColor}`}>
        {intChars.map((ch, i) => (
          <DigitSlot key={`int-${i}`} char={ch} charWidthClass="w-[0.58em]" />
        ))}
      </span>
      <span className={`text-sm font-bold flex items-baseline ml-0.5 ${decColor}`}>
        <span className="inline-block select-none font-mono text-zinc-500 w-[0.28em] text-center">.</span>
        {decChars.map((ch, i) => (
          <DigitSlot key={`dec-${i}`} char={ch} charWidthClass="w-[0.58em]" />
        ))}
      </span>
      {suffix && (
        <span className="text-[10px] font-mono text-zinc-500 ml-1 self-end pb-0.5">
          {suffix}
        </span>
      )}
    </div>
  );
});

SmoothNumericTicker.displayName = 'SmoothNumericTicker';
