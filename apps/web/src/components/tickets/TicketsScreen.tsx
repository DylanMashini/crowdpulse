'use client';

import type { Ticket } from '@triagecam/contracts';
import Link from 'next/link';
import { useState } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { Button, StatusBadge, TicketNumber, tableCell, tableFrame, tableHeadCell } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage, type TicketStatusFilter } from '@/lib/api';
import { dayTime } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

const EMPTY: Record<TicketStatusFilter, { title: string; text: string }> = {
  waiting: { title: 'No tickets are waiting', text: 'A ticket is created when a patient is checked in on a camera phone.' },
  discharged: { title: 'No tickets have been discharged', text: 'A ticket is discharged from its own page. Its face data is deleted then.' },
  all: { title: 'There are no tickets yet', text: 'A ticket is created when a patient is checked in on a camera phone.' },
};

interface MorePages {
  status: TicketStatusFilter;
  items: Ticket[];
  nextCursor: string | null;
}

function faceText(ticket: Ticket): string {
  if (ticket.faceEnrolled) return 'Stored';
  if (ticket.status === 'discharged') return 'Deleted or never stored';
  return ticket.faceOptIn ? 'Opted in, not stored yet' : 'Not opted in';
}

export function TicketsScreen() {
  const { worklist } = useLive();
  const [status, setStatus] = useState<TicketStatusFilter>('waiting');
  const first = useResource(`tickets:${status}`, () => api.tickets(status));
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useLiveEvents((event) => {
    if (event.type === 'ticket_changed' || event.type === 'reconnected') {
      setMore(null);
      first.reload();
    }
  });

  const extra = more?.status === status ? more : null;
  const items = first.data ? [...first.data.items, ...(extra?.items ?? [])] : [];
  const nextCursor = extra ? extra.nextCursor : (first.data?.nextCursor ?? null);
  const states = new Map(worklist.data?.worklist.items.map((item) => [item.ticketNumber, item]));

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore({ busy: true, error: null });
    try {
      const page = await api.tickets(status, nextCursor);
      setMore({ status, items: [...(extra?.items ?? []), ...page.items], nextCursor: page.nextCursor });
      setLoadingMore({ busy: false, error: null });
    } catch (error) {
      setLoadingMore({ busy: false, error: errorMessage(error) });
    }
  };

  return (
    <>
      <PageHeader title="Tickets" description="Every ticket, newest first. A ticket number is the only thing that identifies a patient.">
        <LiveStatus updatedAt={first.updatedAt} />
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'waiting', label: 'Waiting' },
            { value: 'discharged', label: 'Discharged' },
            { value: 'all', label: 'All' },
          ]}
        />
      </PageHeader>

      {first.loading ? <StateMessage kind="loading" title="Loading tickets" /> : null}
      {first.error && !first.data ? (
        <StateMessage kind="error" title="The tickets could not be loaded" onRetry={first.reload}>
          {first.error.message}
        </StateMessage>
      ) : null}
      {first.data && items.length === 0 ? (
        <StateMessage kind="empty" title={EMPTY[status].title}>
          {EMPTY[status].text}
        </StateMessage>
      ) : null}

      {items.length > 0 ? (
        <div className={tableFrame}>
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={tableHeadCell}>
                  Ticket
                </th>
                <th scope="col" className={tableHeadCell}>
                  Status
                </th>
                <th scope="col" className={tableHeadCell}>
                  Checked in
                </th>
                <th scope="col" className={tableHeadCell}>
                  Discharged
                </th>
                <th scope="col" className={tableHeadCell}>
                  Face data
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((ticket) => {
                const item = states.get(ticket.number);
                return (
                  <tr key={ticket.number} className="relative hover:[&>td]:bg-surface">
                    <td className={tableCell}>
                      <Link
                        href={`/tickets/${ticket.number}`}
                        aria-label={`Open ticket ${ticket.number}`}
                        className="rounded-sm after:absolute after:inset-0 after:content-['']"
                      >
                        <TicketNumber number={ticket.number} size="sm" />
                      </Link>
                    </td>
                    <td className={tableCell}>
                      {ticket.status === 'discharged' ? (
                        <span className="text-ink-muted">Discharged</span>
                      ) : item ? (
                        <StatusBadge state={item.state} minutes={item.minutesSinceObserved} />
                      ) : (
                        'Waiting'
                      )}
                    </td>
                    <td className={`${tableCell} whitespace-nowrap tabular-nums`}>{dayTime(ticket.createdAt)}</td>
                    <td className={`${tableCell} whitespace-nowrap tabular-nums`}>
                      {ticket.dischargedAt ? dayTime(ticket.dischargedAt) : <span className="text-ink-muted">Still waiting</span>}
                    </td>
                    <td className={`${tableCell} whitespace-nowrap`}>{faceText(ticket)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {nextCursor ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={loadMore} disabled={loadingMore.busy}>
            {loadingMore.busy ? 'Loading' : 'Show older tickets'}
          </Button>
          {loadingMore.error ? (
            <p role="alert" className="font-medium text-critical">
              {loadingMore.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
