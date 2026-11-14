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
      <header className="flex w-full items-start justify-between gap-2">
        <PatientIdentity patient={patient} size="md" detail={intakeSummary(ageYears, reason)} />
        {source ? <ProvenanceTag kind={source}>{sourceLabel}</ProvenanceTag> : null}
      </header>
      <StatusBadge state={state} minutes={minutes} />
      <dl className="grid w-full grid-cols-1 gap-2">
        <div>
          <dt className="text-[13px] leading-[16px] text-ink-muted">Pulse, bpm</dt>
          <dd>
            <TrendValue trend={pulse} notMeasuredYet={!source} />
          </dd>
        </div>
        <div>
          <dt className="text-[13px] leading-[16px] text-ink-muted">Breathing, per min</dt>
          <dd>
            <TrendValue trend={breathing} notMeasuredYet={!source} />
          </dd>
        </div>
      </dl>
      {score != null ? <ScoreChip score={score} measured={measured} /> : null}
    </article>
  );
}
