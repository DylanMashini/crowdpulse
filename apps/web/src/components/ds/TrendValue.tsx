import { cx } from '@/lib/cx';
import { rate, rateChange } from '@/lib/format';

import type { Severity, Trend } from './types';

export interface TrendValueProps {
  trend?: Trend;
  /** "bpm", "/min". Printed after the value on a tile; a table carries it in the column head. */
  unit: string;
  notMeasuredYet?: boolean;
  /**
   * `cell` is for a table: the value, then the change and the check-in baseline in a slot of its
   * own ("+26 from 82"), so the digits of a column line up whether or not a row has changed.
   * `tile` stacks the same words under the value.
   */
  layout?: 'cell' | 'tile';
  /** Colours the change on a flagged row. */
  severity?: Severity | null;
  /** The value in the brightest ink, for an urgent row. */
  bright?: boolean;
}

const DELTA: Record<Severity, string> = { watch: 'text-watch', urgent: 'text-urgent' };

/** The latest value against the check-in baseline it is measured from. */
export function TrendValue({ trend, unit, notMeasuredYet, layout = 'tile', severity, bright }: TrendValueProps) {
  if (!trend || trend.now == null) {
    // "No reading" means a sitting ran and gave nothing. Before the first sitting, say that instead.
    return <span className="type-caption whitespace-nowrap text-ink-faint">{notMeasuredYet ? 'Not measured yet' : 'No reading'}</span>;
  }
  const change = trend.base != null ? rateChange(trend.base, trend.now) : null;

  if (layout === 'cell') {
    return (
      <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
        <span className={cx('type-readout-sm', bright ? 'text-ink-bright' : 'text-ink')}>{rate(trend.now)}</span>
        <span className="inline-block min-w-[84px] text-left type-caption text-ink-faint tabular-nums">
          {trend.base == null ? null : (
            <>
              {change ? <span className={severity ? DELTA[severity] : 'text-ink-muted'}>{change} </span> : null}from {rate(trend.base)}
            </>
          )}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col whitespace-nowrap">
      <span className="inline-flex items-baseline gap-1">
        <span className="type-readout-md text-ink">{rate(trend.now)}</span>
        <span className="type-caption text-ink-muted">{unit}</span>
      </span>
      {trend.base != null ? (
        <span className="type-caption text-ink-faint tabular-nums">
          {change ? <span className={severity ? DELTA[severity] : undefined}>{change} </span> : null}from {rate(trend.base)}
        </span>
      ) : null}
    </span>
  );
}
