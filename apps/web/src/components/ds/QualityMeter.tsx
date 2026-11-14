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
    <div className="flex min-w-0 flex-col gap-[6px]">
      <div className="flex justify-between gap-3 type-caption">
        <span className="text-ink-faint">{label}</span>
        <span className={cx('tabular-nums', low ? 'text-watch' : 'text-ink-muted')}>
          {pct}%{low ? ', below threshold' : ''}
        </span>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} className="relative h-[2px] rounded-pill bg-surface-4">
        <div
          className={cx('h-full rounded-pill', low ? 'bg-[repeating-linear-gradient(90deg,var(--watch)_0_4px,transparent_4px_7px)]' : 'bg-signal')}
          style={{ width: `${pct}%` }}
        />
        {threshold != null ? <div className="absolute top-[-3px] h-[8px] w-px bg-ink-muted" style={{ left: `${Math.round(threshold * 100)}%` }} /> : null}
      </div>
    </div>
  );
}
