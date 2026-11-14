import { cx } from '@/lib/cx';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { PatientIdentity, intakeSummary } from './PatientIdentity';
import { TrendValue } from './TrendValue';
import type { TileState, WorklistRow } from './types';

// The state is carried by the outline: 2px in the state's colour, or dashed for no reading.
// The padding gives back the extra pixel so every tile's content sits on the same lines.
const FRAMES: Record<TileState, string> = {
  observed: 'border border-line p-4',
  flag: 'border-2 border-flag p-[15px]',
  overdue: 'border-2 border-ink p-[15px]',
  'no-reading': 'border border-dashed border-line-strong p-4',
};

export interface PatientTileProps extends WorklistRow {
  /** How many of the seven NEWS2 parameters the score rests on. */
  measured?: number;
}

/** One waiting patient for the wall view: who they are, then how they are doing. */
export function PatientTile({ patient, reason, ageYears, state, minutes, pulse, breathing, score, source, sourceLabel, measured }: PatientTileProps) {
  return (
    <article className={cx('flex h-full w-full flex-col items-start gap-3 rounded-lg bg-surface-raised', FRAMES[state])}>
      {/* The name has the tile's full width; the reason for the visit gets two lines of its own. */}
      <header className="flex w-full min-w-0 flex-col gap-2">
        <PatientIdentity patient={patient} size="md" detail={intakeSummary(ageYears, null)} />
        {reason?.trim() ? <p className="line-clamp-2 text-[15px] leading-[20px] break-words">{reason}</p> : null}
      </header>
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <StatusBadge state={state} minutes={minutes} />
        {source ? <ProvenanceTag kind={source}>{sourceLabel}</ProvenanceTag> : null}
      </div>
      <dl className="grid w-full grid-cols-1 gap-2">
        <div>
          <dt className="text-[13px] leading-[16px] text-ink-muted">Pulse</dt>
          <dd>
            <TrendValue trend={pulse} unit="bpm" notMeasuredYet={!source} />
          </dd>
        </div>
        <div>
          <dt className="text-[13px] leading-[16px] text-ink-muted">Breathing</dt>
          <dd>
            <TrendValue trend={breathing} unit="/min" notMeasuredYet={!source} />
          </dd>
        </div>
      </dl>
      {score != null ? <ScoreChip score={score} measured={measured} /> : null}
    </article>
  );
}
