import { cx } from '@/lib/cx';
import { minutesAgo } from '@/lib/format';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { TicketNumber } from './TicketNumber';
import { TrendValue } from './TrendValue';
import type { WorklistRow } from './types';

export const tableHeadCell = 'bg-surface-sunken px-3 py-2 text-left type-label whitespace-nowrap text-ink-muted';
export const tableCell = 'border-t border-line p-3 align-middle';
export const tableFrame = 'w-full overflow-x-auto rounded-lg border border-line bg-surface-raised';

export interface WorklistTableProps {
  /** Already in rank order. The table does not sort. */
  rows: WorklistRow[];
  selected?: number;
  onSelect?: (ticket: number) => void;
}

/** The ranked waiting-room worklist: who to walk to first. */
export function WorklistTable({ rows, selected, onSelect }: WorklistTableProps) {
  return (
    <div className={tableFrame}>
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr>
            <th scope="col" className={cx(tableHeadCell, 'text-right')}>
              Rank
            </th>
            <th scope="col" className={tableHeadCell}>
              Ticket
            </th>
            <th scope="col" className={tableHeadCell}>
              State
            </th>
            <th scope="col" className={tableHeadCell}>
              Pulse, bpm
            </th>
            <th scope="col" className={tableHeadCell}>
              Breathing, per min
            </th>
            <th scope="col" className={tableHeadCell}>
              Partial score
            </th>
            <th scope="col" className={tableHeadCell}>
              Last observed
            </th>
            <th scope="col" className={tableHeadCell}>
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selected === row.ticket;
            return (
              <tr
                key={row.ticket}
                tabIndex={0}
                aria-selected={isSelected}
                onClick={() => onSelect?.(row.ticket)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSelect?.(row.ticket);
                }}
                className={cx(
                  'group cursor-pointer focus-visible:-outline-offset-2',
                  isSelected ? '[&>td]:bg-signal-soft' : 'hover:[&>td]:bg-surface',
                )}
              >
                <td className={cx(tableCell, 'w-[40px] text-right font-mono text-ink-muted tabular-nums')}>{index + 1}</td>
                <td className={tableCell}>
                  <TicketNumber number={row.ticket} size="sm" />
                </td>
                <td className={tableCell}>
                  <StatusBadge state={row.state} minutes={row.minutes} />
                </td>
                <td className={tableCell}>
                  <TrendValue trend={row.pulse} notMeasuredYet={!row.source} />
                </td>
                <td className={tableCell}>
                  <TrendValue trend={row.breathing} notMeasuredYet={!row.source} />
                </td>
                <td className={tableCell}>
                  {row.score != null ? (
                    <ScoreChip score={row.score} caption={false} />
                  ) : (
                    <span className="text-[13px] whitespace-nowrap text-ink-muted">Not scored</span>
                  )}
                </td>
                <td className={cx(tableCell, 'whitespace-nowrap tabular-nums')}>
                  {row.minutes != null ? minutesAgo(row.minutes) : <span className="text-[13px] text-ink-muted">Not yet observed</span>}
                  {row.sittingInProgress ? <span className="block text-[13px] text-ink-muted">Sitting in progress</span> : null}
                </td>
                <td className={tableCell}>
                  {row.source ? (
                    <ProvenanceTag kind={row.source}>{row.sourceLabel}</ProvenanceTag>
                  ) : (
                    <span className="text-[13px] whitespace-nowrap text-ink-muted">No finished sitting</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
