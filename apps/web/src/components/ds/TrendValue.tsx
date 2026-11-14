import { rate, rateChange } from '@/lib/format';

import type { Trend } from './types';

export interface TrendValueProps {
  trend?: Trend;
  /** Printed after the latest value: "bpm", "/min". */
  unit: string;
  notMeasuredYet?: boolean;
}

/** The latest value with its unit, the check-in baseline it is measured against, and the difference. */
export function TrendValue({ trend, unit, notMeasuredYet }: TrendValueProps) {
  if (!trend || trend.now == null) {
    // "No reading" means a sitting ran and gave nothing. Before the first sitting, say that instead.
    return <span className="text-[13px] whitespace-nowrap text-ink-muted">{notMeasuredYet ? 'Not measured yet' : 'No reading'}</span>;
  }
  const change = trend.base != null ? rateChange(trend.base, trend.now) : null;
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <span className="inline-flex items-baseline gap-1">
        <span className="type-readout-md">{rate(trend.now)}</span>
        <span className="text-[13px] text-ink-muted">{unit}</span>
      </span>
      {trend.base != null ? (
        <span className="text-[13px] text-ink-muted tabular-nums">
          from {rate(trend.base)}
          {change ? ` (${change})` : ''}
        </span>
      ) : null}
    </span>
  );
}
