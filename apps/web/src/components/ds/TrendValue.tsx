import { LOWER_CONFIDENCE } from '@triagecam/contracts';

import { cx } from '@/lib/cx';
import { clockTime, rate, rateChange } from '@/lib/format';

import { ProvenanceTag } from './ProvenanceTag';
import type { Trend } from './types';

export interface TrendValueProps {
  trend?: Trend;
  /** Printed after the latest value: "bpm", "/min". */
  unit: string;
  notMeasuredYet?: boolean;
  /** Puts the baseline under the value, for tables that have no width to spare. */
  stacked?: boolean;
  /** Lets the baseline drop under the value, and break between words, when the box is narrower than the line. */
  wraps?: boolean;
}

/**
 * The latest value with its unit, the baseline it is measured against, and the difference. The
 * baseline is the check-in's unless it says otherwise ("10:42 re-check"). A lower-confidence
 * pulse is printed muted with its tag and is compared with nothing.
 */
export function TrendValue({ trend, unit, notMeasuredYet, stacked, wraps }: TrendValueProps) {
  if (trend && trend.now == null && trend.lowConfidence != null) {
    return (
      <span className={cx('inline-flex whitespace-nowrap', stacked ? 'flex-col items-start gap-1' : 'flex-wrap items-center gap-2')}>
        <span className="inline-flex items-baseline gap-1 text-ink-muted">
          <span className="type-readout-md">{rate(trend.lowConfidence)}</span>
          <span className="text-[13px]">{unit}</span>
        </span>
        <ProvenanceTag kind="experimental">{LOWER_CONFIDENCE}</ProvenanceTag>
      </span>
    );
  }
  if (!trend || trend.now == null) {
    // "No reading" means a sitting ran and gave nothing. Before the first sitting, say that instead.
    return <span className="text-[13px] whitespace-nowrap text-ink-muted">{notMeasuredYet ? 'Not measured yet' : 'No reading'}</span>;
  }
  const change = trend.base != null ? rateChange(trend.base, trend.now) : null;
  const reCheck = trend.baseAt ? `${clockTime(trend.baseAt)} re-check` : null;
  return (
    <span className={cx('inline-flex', wraps ? 'max-w-full flex-wrap' : 'whitespace-nowrap', stacked ? 'flex-col' : 'items-baseline gap-x-2')}>
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <span className="type-readout-md">{rate(trend.now)}</span>
        <span className="text-[13px] text-ink-muted">{unit}</span>
      </span>
      {trend.base != null ? (
        <span className="text-[13px] text-ink-muted tabular-nums">
          from {rate(trend.base)}
          {reCheck && !stacked ? ` at the ${reCheck}` : ''}
          {change ? ` (${change})` : ''}
          {reCheck && stacked ? <span className="block">{reCheck}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
