'use client';

import { patientLabel, type WorklistItem } from '@triagecam/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';

import { useLive } from '@/components/app/live';
import { PatientTile, WorklistTable } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, StaleNotice } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { waitingCounts } from '@/lib/format';
import { rowSeverity, toWorklistRow } from '@/lib/mapping';

type View = 'list' | 'wall';

function Count({ value, className }: { value: number; className?: string }) {
  return <span className={`font-medium tabular-nums ${className ?? 'text-ink'}`}>{value}</span>;
}

/** What the room holds, in one sentence, so the counts do not have to be read off the rows. */
function summarise(items: WorklistItem[]): ReactNode {
  // A lower-confidence pulse is a reading, tagged: counted as that, not as "without a reading".
  const { flags, overdue, noReading, lowConfidence } = waitingCounts(items);
  // The flag count takes the colour of the worst flag in the room, as its rows do.
  const flagTone = items.some((item) => item.state === 'flag' && rowSeverity(item) === 'urgent') ? 'text-urgent' : 'text-watch';
  const parts: ReactNode[] = [];
  if (flags) {
    parts.push(
      <span key="flag" className={flagTone}>
        <Count value={flags} className={flagTone} /> {flags === 1 ? 'trend flag' : 'trend flags'}
      </span>,
    );
  }
  if (overdue) {
    parts.push(
      <span key="overdue">
        <Count value={overdue} /> overdue
      </span>,
    );
  }
  if (noReading) {
    parts.push(
      <span key="no-reading">
        <Count value={noReading} /> without a reading
      </span>,
    );
  }
  if (lowConfidence) {
    parts.push(
      <span key="lower-confidence">
        <Count value={lowConfidence} /> lower confidence
      </span>,
    );
  }
  return (
    <>
      <Count value={items.length} /> {items.length === 1 ? 'patient' : 'patients'} waiting
      {parts.map((part, index) => (
        <span key={index}>
          {index === 0 ? ': ' : ', '}
          {part}
        </span>
      ))}
    </>
  );
}

/** The nurse view: every waiting patient in the order to walk to them. */
export function WaitingRoomScreen() {
  const router = useRouter();
  const { worklist } = useLive();
  const [view, setView] = useState<View>('list');

  const loaded = worklist.data?.worklist;
  const rows = useMemo(() => loaded?.items.map(toWorklistRow) ?? [], [loaded]);

  return (
    <>
      <PageHeader title="Waiting room" description={loaded && loaded.items.length > 0 ? summarise(loaded.items) : undefined}>
        <LiveStatus updatedAt={worklist.updatedAt} />
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Worklist' },
            { value: 'wall', label: 'Wall view' },
          ]}
        />
      </PageHeader>

      {worklist.loading ? <StateMessage kind="loading" title="Loading the waiting room" /> : null}

      {worklist.error ? (
        loaded ? (
          <StaleNotice>The worklist could not be refreshed: {worklist.error.message} The rows below may be out of date.</StaleNotice>
        ) : (
          <StateMessage kind="error" title="The waiting room could not be loaded" onRetry={worklist.reload}>
            {worklist.error.message}
          </StateMessage>
        )
      ) : null}

      {loaded && loaded.items.length === 0 ? (
        <StateMessage kind="empty" title="Nobody is waiting">
          A patient appears here as soon as their check-in starts on a camera phone. Discharged patients are under Patients.
        </StateMessage>
      ) : null}

      {loaded && loaded.items.length > 0 && view === 'list' ? (
        <WorklistTable rows={rows} onSelect={(number) => router.push(`/patients/${number}`)} />
      ) : null}

      {loaded && loaded.items.length > 0 && view === 'wall' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(264px,1fr))] gap-3 p-5">
          {rows.map((row) => (
            <li key={row.patient.number}>
              <Link href={`/patients/${row.patient.number}`} aria-label={`Open ${patientLabel(row.patient)}`} className="group block h-full rounded-lg">
                <PatientTile {...row} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {loaded && loaded.items.length > 0 ? (
        <p className="px-5 py-3 type-caption text-ink-faint">A patient is overdue after {loaded.recheckIntervalMin} min without an observation</p>
      ) : null}
    </>
  );
}
