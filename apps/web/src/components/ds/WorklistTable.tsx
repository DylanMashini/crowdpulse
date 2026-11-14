import { cx } from '@/lib/cx';
import { minutesAgo } from '@/lib/format';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { PatientIdentity, intakeSummary } from './PatientIdentity';
import { TableFrame, tableCell, tableHeadCell } from './TableFrame';
import { TrendValue } from './TrendValue';
import type { WorklistRow } from './types';

export interface WorklistTableProps {
  /** Already in rank order. The table does not sort. */
  rows: WorklistRow[];
  /** Visit number of the selected patient. */
  selected?: number;
  onSelect?: (patientNumber: number) => void;
}

const faint = 'type-caption whitespace-nowrap text-ink-faint';

/**
 * The ranked waiting-room worklist: who to walk to first. One row carries the colour: an urgent
 * row is tinted with a red edge, a watch row has an amber edge, and a stable row drops its name
 * to regular weight.
 */
export function WorklistTable({ rows, selected, onSelect }: WorklistTableProps) {
  return (
    <TableFrame label="Waiting-room worklist">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className={cx(tableHeadCell, 'text-right')}>
              Rank
            </th>
            <th scope="col" className={tableHeadCell}>
              Patient
            </th>
            <th scope="col" className={tableHeadCell}>
              State
            </th>
            <th scope="col" className={tableHeadCell}>
              Partial score
            </th>
            <th scope="col" className={cx(tableHeadCell, 'text-right')}>
              Pulse, bpm
            </th>
            <th scope="col" className={cx(tableHeadCell, 'text-right')}>
              Breathing, /min
            </th>
            <th scope="col" className={cx(tableHeadCell, 'text-right')}>
              Last observed
            </th>
            <th scope="col" className={tableHeadCell}>
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selected === row.patient.number;
            const urgent = row.severity === 'urgent';
            const watch = row.severity === 'watch';
            return (
              <tr
                key={row.patient.number}
                tabIndex={0}
                aria-selected={isSelected}
                onClick={() => onSelect?.(row.patient.number)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSelect?.(row.patient.number);
                }}
                className={cx(
                  'cursor-pointer transition-colors duration-state focus-visible:-outline-offset-2',
                  urgent ? 'bg-urgent-soft hover:bg-urgent-soft-hover' : isSelected ? 'bg-surface-2' : 'hover:bg-surface-2',
                  urgent && '[&>td:first-child]:shadow-[inset_2px_0_0_var(--urgent)]',
                  watch && '[&>td:first-child]:shadow-[inset_2px_0_0_var(--watch)]',
                )}
              >
                <td className={cx(tableCell, 'w-[52px] text-right text-ink-faint tabular-nums')}>{index + 1}</td>
                <td className={cx(tableCell, 'w-full max-w-0 min-w-[240px]')}>
                  <PatientIdentity
                    patient={row.patient}
                    size="sm"
                    detail={intakeSummary(row.ageYears, row.reason)}
                    quiet={row.state === 'observed' && !row.severity}
                    bright={urgent}
                  />
                </td>
                <td className={tableCell}>
                  <StatusBadge state={row.state} severity={row.severity} minutes={row.minutes} lowConfidence={row.pulse?.lowConfidence != null} brief />
                </td>
                <td className={tableCell}>{row.score != null ? <ScoreChip score={row.score} caption={false} /> : <span className={faint}>Not scored</span>}</td>
                <td className={cx(tableCell, 'text-right')}>
                  <TrendValue trend={row.pulse} unit="bpm" notMeasuredYet={!row.source} layout="cell" severity={row.severity} bright={urgent} />
                </td>
                <td className={cx(tableCell, 'text-right')}>
                  <TrendValue trend={row.breathing} unit="/min" notMeasuredYet={!row.source} layout="cell" severity={row.severity} bright={urgent} />
                </td>
                <td className={cx(tableCell, 'text-right whitespace-nowrap tabular-nums')}>
                  {row.sittingInProgress ? (
                    <span className="mr-3 inline-flex items-center gap-[6px] type-caption text-signal">
                      <span aria-hidden className="size-[6px] rounded-pill bg-signal glow-live" />
                      Sitting in progress
                    </span>
                  ) : null}
                  {row.minutes != null ? minutesAgo(row.minutes) : <span className={faint}>Not yet observed</span>}
                </td>
                <td className={tableCell}>
                  {row.source ? (
                    <ProvenanceTag kind={row.source} plain>
                      {row.sourceLabel}
                    </ProvenanceTag>
                  ) : (
                    <span className={faint}>No sitting yet</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
