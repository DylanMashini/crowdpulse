import { cx } from '@/lib/cx';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import type { Provenance, ScoreValue, TileState } from './types';

export interface TimelineItem {
  /** Clock time in 24-hour form. */
  time: string;
  title: string;
  /** Present, even when both values are null, for an entry that is a sitting. */
  vitals?: { pulse: number | null; breathing: number | null };
  score?: ScoreValue | null;
  state?: TileState;
  source?: Provenance;
  sourceLabel?: string;
  note?: string;
}

const MARKS: Record<TileState, string> = {
  observed: 'rounded-full bg-surface-raised shadow-[0_0_0_2px_var(--line-strong)]',
  flag: 'rounded-[2px] bg-flag shadow-[0_0_0_2px_var(--flag)]',
  overdue: 'rounded-full bg-ink shadow-[0_0_0_2px_var(--ink)]',
  'no-reading': 'rounded-full bg-surface-raised outline-2 outline-dashed outline-line-strong',
};

/** Every observation and flag event for one ticket since check-in, oldest first. */
export function TicketTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="w-full max-w-[560px]">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <li key={index} className={cx('relative grid grid-cols-[52px_16px_1fr] gap-3', !last && 'pb-4')}>
            {last ? null : <span aria-hidden className="absolute top-[12px] bottom-[-6px] left-[71px] w-[2px] bg-line" />}
            <span className="text-right font-mono text-[13px] leading-[22px] text-ink-muted">{item.time}</span>
            <span aria-hidden className={cx('relative z-[1] mx-[3px] mt-[6px] size-[10px]', MARKS[item.state ?? 'observed'])} />
            <div>
              <div className="flex min-h-[26px] flex-wrap items-center gap-2 font-semibold">
                <span>{item.title}</span>
                {item.state && item.state !== 'observed' ? <StatusBadge state={item.state} /> : null}
                {item.source && item.source !== 'live' ? <ProvenanceTag kind={item.source}>{item.sourceLabel}</ProvenanceTag> : null}
              </div>
              {item.vitals ? (
                <div className="mt-[2px] flex flex-wrap items-center gap-4 text-[13px] text-ink-muted">
                  <TimelineValue value={item.vitals.pulse} unit="bpm" missing="No pulse reading" />
                  <TimelineValue value={item.vitals.breathing} unit="breaths per min" missing="No breathing reading" />
                  {item.score != null ? <ScoreChip score={item.score} caption={false} /> : null}
                </div>
              ) : null}
              {item.note ? <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">{item.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TimelineValue({ value, unit, missing }: { value: number | null; unit: string; missing: string }) {
  if (value == null) return <span>{missing}</span>;
  return (
    <span>
      <b className="font-mono text-[17px] font-semibold text-ink tabular-nums">{value}</b> {unit}
    </span>
  );
}
