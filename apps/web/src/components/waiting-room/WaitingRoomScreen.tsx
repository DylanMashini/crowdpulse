'use client';

import type { WorklistItem } from '@triagecam/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useLive } from '@/components/app/live';
import { PatientTile, WorklistTable } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { toWorklistRow } from '@/lib/mapping';

type View = 'list' | 'wall';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What the room holds, in one sentence, so the counts do not have to be read off the rows. */
function summarise(items: WorklistItem[], recheckIntervalMin: number): string {
  const count = (state: WorklistItem['state']) => items.filter((item) => item.state === state).length;
  const parts = [
    count('flag') ? plural(count('flag'), 'trend flag', 'trend flags') : null,
    count('overdue') ? `${count('overdue')} overdue` : null,
    count('no-reading') ? `${count('no-reading')} without a reading` : null,
  ].filter(Boolean);
  return `${plural(items.length, 'ticket', 'tickets')} waiting${parts.length ? `: ${parts.join(', ')}` : ''}. Overdue after ${recheckIntervalMin} min without an observation.`;
}

/** The nurse view: every waiting ticket in the order to walk to them. */
export function WaitingRoomScreen() {
  const router = useRouter();
  const { worklist } = useLive();
  const [view, setView] = useState<View>('list');

  const loaded = worklist.data?.worklist;
  const rows = useMemo(() => loaded?.items.map(toWorklistRow) ?? [], [loaded]);

  return (
    <>
      <PageHeader title="Waiting room" description={loaded && loaded.items.length > 0 ? summarise(loaded.items, loaded.recheckIntervalMin) : undefined}>
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
          A ticket appears here when a patient is checked in on a camera phone. Discharged tickets are under Tickets.
        </StateMessage>
      ) : null}

      {loaded && loaded.items.length > 0 && view === 'list' ? (
        <WorklistTable rows={rows} onSelect={(ticket) => router.push(`/tickets/${ticket}`)} />
      ) : null}

      {loaded && loaded.items.length > 0 && view === 'wall' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4">
          {rows.map((row) => (
            <li key={row.ticket}>
              <Link href={`/tickets/${row.ticket}`} aria-label={`Open ticket ${row.ticket}`} className="block h-full rounded-lg">
                <PatientTile {...row} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
