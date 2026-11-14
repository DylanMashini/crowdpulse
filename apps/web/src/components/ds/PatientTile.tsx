import { cx } from '@/lib/cx';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { PatientIdentity, intakeSummary } from './PatientIdentity';
import { TrendValue } from './TrendValue';
import type { WorklistRow } from './types';

export interface PatientTileProps extends WorklistRow {
  /** How many of the seven NEWS2 parameters the score rests on. */
  measured?: number;
}

/** One waiting patient for the wall view: who they are, then how they are doing. */
export function PatientTile({ patient, reason, ageYears, state, severity, minutes, pulse, breathing, score, source, sourceLabel, measured }: PatientTileProps) {
  const urgent = severity === 'urgent';
  return (
    <article
      className={cx(
        'flex h-full w-full flex-col gap-4 rounded-lg border p-4 transition-colors',
        // Only an urgent tile is tinted. No reading keeps its dashed outline; the chip says the rest.
        urgent
          ? 'border-urgent-line bg-urgent-soft group-hover:bg-urgent-soft-hover'
          : cx('bg-surface-2 group-hover:bg-surface-3', state === 'no-reading' ? 'border-dashed border-line-strong' : 'border-line'),
      )}
    >
      <header className="flex w-full min-w-0 flex-col gap-2">
        <PatientIdentity patient={patient} size="md" detail={intakeSummary(ageYears, null)} bright={urgent} />
        {reason?.trim() ? <p className="line-clamp-2 type-dense break-words text-ink-muted">{reason}</p> : null}
      </header>
      <dl className="grid w-full grid-cols-2 gap-4">
        <div>
          <dt className="type-caption text-ink-muted">Pulse</dt>
          <dd className="mt-1">
            <TrendValue trend={pulse} unit="bpm" notMeasuredYet={!source} severity={severity} />
          </dd>
        </div>
        <div>
          <dt className="type-caption text-ink-muted">Breathing</dt>
          <dd className="mt-1">
            <TrendValue trend={breathing} unit="/min" notMeasuredYet={!source} severity={severity} />
          </dd>
        </div>
      </dl>
      <footer className="mt-auto flex w-full flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <StatusBadge state={state} severity={severity} minutes={minutes} lowConfidence={pulse?.lowConfidence != null} />
          {source ? (
            <ProvenanceTag kind={source} plain>
              {sourceLabel}
            </ProvenanceTag>
          ) : null}
        </div>
        {score != null ? <ScoreChip score={score} measured={measured} /> : null}
      </footer>
    </article>
  );
}
