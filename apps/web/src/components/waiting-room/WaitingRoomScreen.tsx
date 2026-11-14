'use client';

import { patientLabel } from '@triagecam/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useLive } from '@/components/app/live';
import { PatientTile, WorklistTable } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { waitingSummary } from '@/lib/format';
import { toWorklistRow } from '@/lib/mapping';

type View = 'list' | 'wall';

/** The nurse view: every waiting patient in the order to walk to them. */
export function WaitingRoomScreen() {
  const router = useRouter();
  const { worklist } = useLive();
  const [view, setView] = useState<View>('list');

  const loaded = worklist.data?.worklist;
  const rows = useMemo(() => loaded?.items.map(toWorklistRow) ?? [], [loaded]);

  return (
    <>
      <PageHeader title="Waiting room" description={loaded && loaded.items.length > 0 ? waitingSummary(loaded.items, loaded.recheckIntervalMin) : undefined}>
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
          <p role="alert" className="mb-4 rounded-md border border-flag bg-flag-soft px-3 py-2 font-medium">
            The worklist could not be refreshed: {worklist.error.message} The rows below may be out of date.
          </p>
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
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4">
          {rows.map((row) => (
            <li key={row.patient.number}>
              <Link href={`/patients/${row.patient.number}`} aria-label={`Open ${patientLabel(row.patient)}`} className="block h-full rounded-lg">
                <PatientTile {...row} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
