import { cx } from '@/lib/cx';

export const SITTING_SECONDS = 60;

// Segments are sized by duration: settle to 5 s, heart rate to 20 s, breathing and beats to 60 s.
const PHASES = [
  { until: 5, label: 'Settle' },
  { until: 20, label: 'Heart rate' },
  { until: SITTING_SECONDS, label: 'Breathing and beats' },
];

export interface SittingTimerProps {
  /** Seconds since the sitting started. */
  elapsed: number;
  /** Shown beside "Done" once the time is up. */
  doneLabel?: string;
  className?: string;
}

/** Progress through the 60-second sitting. Counts down in whole seconds and names the phase. */
export function SittingTimer({ elapsed, doneLabel = 'Baseline saved', className }: SittingTimerProps) {
  const seconds = Math.max(0, Math.min(SITTING_SECONDS, Math.floor(elapsed)));
  const done = seconds >= SITTING_SECONDS;
  const phase = PHASES.find((candidate) => seconds < candidate.until) ?? PHASES[PHASES.length - 1];
  const phaseLabel = done ? doneLabel : (phase?.label ?? '');
  const left = done ? 'Done' : `${SITTING_SECONDS - seconds} s left`;

  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        {done ? (
          <span className="type-heading text-ink">Done</span>
        ) : (
          <span className="flex items-baseline gap-[6px]">
            <span className="type-readout-md text-ink tabular-nums">{SITTING_SECONDS - seconds}</span>
            <span className="type-dense text-ink-muted">s left</span>
          </span>
        )}
        <span className="type-dense text-ink-muted">{phaseLabel}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${left}, ${phaseLabel}`}
        aria-valuemin={0}
        aria-valuemax={SITTING_SECONDS}
        aria-valuenow={seconds}
        className="flex h-[2px] gap-[2px]"
      >
        {PHASES.map((candidate, index) => {
          const from = index === 0 ? 0 : (PHASES[index - 1]?.until ?? 0);
          const share = Math.max(0, Math.min(1, (seconds - from) / (candidate.until - from)));
          return (
            <div key={candidate.label} className="h-full overflow-hidden rounded-pill bg-line-strong" style={{ flexGrow: candidate.until - from, flexBasis: 0 }}>
              <div className="h-full bg-signal" style={{ width: `${share * 100}%` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
