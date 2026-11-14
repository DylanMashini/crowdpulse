import { cx } from '@/lib/cx';
import { rate } from '@/lib/format';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import type { Provenance, ScoreValue, Severity, TileState } from './types';

export interface TimelineItem {
  /** Clock time in 24-hour form. */
  time: string;
  title: string;
  /** Present, even when both values are null, for an entry that is a sitting. Rounded when shown. */
  vitals?: { pulse: number | null; breathing: number | null };
  score?: ScoreValue | null;
  state?: TileState;
  /** For a flag entry: which severity colour it opened in. */
  severity?: Severity | null;
  source?: Provenance;
  sourceLabel?: string;
  note?: string;
}

// The mark differs in form for each state, as the chips do. The urgent mark is one of the two
// places a glow is allowed.
function mark(state: TileState, severity?: Severity | null): string {
  if (state === 'flag') return severity === 'urgent' ? 'bg-urgent glow-urgent' : 'bg-watch';
  if (state === 'overdue') return 'bg-ink';
  if (state === 'no-reading') return 'bg-surface-1 outline-1 outline-dashed outline-line-hover';
  return 'bg-surface-1 shadow-[inset_0_0_0_1.5px_var(--ink-faint)]';
}

/** Every observation and flag event for one patient since check-in, oldest first. */
export function PatientTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="w-full max-w-[560px]">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <li key={index} className={cx('relative grid grid-cols-[40px_8px_minmax(0,1fr)] gap-x-3', !last && 'pb-5')}>
            {last ? null : <span aria-hidden className="absolute top-[18px] bottom-[2px] left-[55.5px] w-px bg-line-strong" />}
            <span className="pt-px text-right type-readout-sm text-[12px] text-ink-faint">{item.time}</span>
            <span aria-hidden className={cx('relative z-[1] mt-[7px] size-[8px] rounded-pill', mark(item.state ?? 'observed', item.severity))} />
            <div className="min-w-0">
              <div className="flex min-h-[22px] flex-wrap items-center gap-x-2 gap-y-1">
                <span className="type-label text-ink">{item.title}</span>
                {item.state && item.state !== 'observed' ? <StatusBadge state={item.state} severity={item.severity} /> : null}
                {item.source && item.source !== 'live' ? <ProvenanceTag kind={item.source}>{item.sourceLabel}</ProvenanceTag> : null}
              </div>
              {item.vitals ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-ink-muted">
                  <TimelineValue value={item.vitals.pulse} unit="bpm" missing="No pulse reading" />
                  <TimelineValue value={item.vitals.breathing} unit="breaths per min" missing="No breathing reading" />
                  {item.score != null ? <ScoreChip score={item.score} caption={false} /> : null}
                </div>
              ) : null}
              {item.note ? <p className="mt-px type-dense text-ink-muted">{item.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TimelineValue({ value, unit, missing }: { value: number | null; unit: string; missing: string }) {
  if (value == null) return <span className="text-ink-faint">{missing}</span>;
  return (
    <span>
      <span className="type-readout-sm text-ink">{rate(value)}</span> {unit}
    </span>
  );
}
