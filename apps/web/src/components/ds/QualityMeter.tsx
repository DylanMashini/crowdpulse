import { cx } from '@/lib/cx';

export interface QualityMeterProps {
  /** 0 to 1. */
  value: number;
  label?: string;
  /** 0 to 1. Below it the bar is hatched and says so. */
  threshold?: number;
}

export function QualityMeter({ value, label = 'Coverage', threshold }: QualityMeterProps) {
  const share = Math.max(0, Math.min(1, value));
  const pct = Math.round(share * 100);
  const low = threshold != null && share < threshold;
  return (
    <div className="flex min-w-[160px] flex-col gap-[6px]">
      <div className="flex justify-between gap-3 text-[13px] leading-[16px]">
        <span className="text-ink-muted">{label}</span>
        <span className={cx('font-medium tabular-nums', low && 'text-flag')}>
          {pct}%{low ? ', below threshold' : ''}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
        className="relative h-[6px] rounded-sm bg-surface-sunken shadow-[inset_0_0_0_1px_var(--line)]"
      >
        <div
          className={cx(
            'h-full rounded-sm',
            low ? 'bg-[repeating-linear-gradient(135deg,var(--flag)_0_4px,var(--flag-soft)_4px_7px)]' : 'bg-signal',
          )}
          style={{ width: `${pct}%` }}
        />
        {threshold != null ? (
          <div className="absolute top-[-3px] h-[12px] w-[2px] bg-ink" style={{ left: `${Math.round(threshold * 100)}%` }} />
        ) : null}
      </div>
    </div>
  );
}
