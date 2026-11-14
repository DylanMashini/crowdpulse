import type { Trend } from './types';

/** The latest value, the check-in baseline it is measured against, and the difference. */
export function TrendValue({ trend, notMeasuredYet }: { trend?: Trend; notMeasuredYet?: boolean }) {
  if (!trend || trend.now == null) {
    // "No reading" means a sitting ran and gave nothing. Before the first sitting, say that instead.
    return <span className="text-[13px] whitespace-nowrap text-ink-muted">{notMeasuredYet ? 'Not measured yet' : 'No reading'}</span>;
  }
  const delta = trend.base != null ? trend.now - trend.base : 0;
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <span className="type-readout-md">{trend.now}</span>
      {trend.base != null ? (
        <span className="text-[13px] text-ink-muted tabular-nums">
          from {trend.base}
          {delta ? ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})` : ''}
        </span>
      ) : null}
    </span>
  );
}
