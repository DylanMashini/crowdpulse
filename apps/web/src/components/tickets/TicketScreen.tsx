'use client';

import type { Flag, TicketDetailResponse } from '@triagecam/contracts';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { Button, HandoffNote, Icon, StatusBadge, TicketNumber, TicketTimeline, buttonClass } from '@/components/ds';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { clockTime, ruleText } from '@/lib/format';
import { toTimelineItems } from '@/lib/mapping';
import { useResource } from '@/lib/use-resource';

export function TicketScreen({ number }: { number: number }) {
  const detail = useResource(`ticket:${number}`, () => api.ticket(number));

  useLiveEvents((event) => {
    const concernsTicket =
      event.type === 'reconnected' ||
      (event.type === 'ticket_changed' && event.ticketNumber === number) ||
      ((event.type === 'flag_opened' || event.type === 'flag_acknowledged' || event.type === 'flag_closed') && event.flag.ticketNumber === number) ||
      ((event.type === 'sitting_started' || event.type === 'sitting_finished') && event.sitting.ticketNumber === number);
    if (concernsTicket) detail.reload();
  });

  if (detail.loading) return <StateMessage kind="loading" title={`Loading ticket ${number}`} />;

  if (!detail.data) {
    const missing = detail.error?.code === 'not_found';
    return (
      <StateMessage
        kind={missing ? 'empty' : 'error'}
        title={missing ? `There is no ticket ${number}` : `Ticket ${number} could not be loaded`}
        onRetry={missing ? undefined : detail.reload}
        action={
          <Link href="/tickets" className={buttonClass('secondary')}>
            All tickets
          </Link>
        }
      >
        {missing ? 'Ticket numbers are given in order at check-in and are never reused. Check the number on the patient’s slip.' : detail.error?.message}
      </StateMessage>
    );
  }

  return <TicketView detail={detail.data} updatedAt={detail.updatedAt} refreshError={detail.error?.message ?? null} onChanged={detail.reload} />;
}

interface TicketViewProps {
  detail: TicketDetailResponse;
  updatedAt: number | null;
  refreshError: string | null;
  onChanged: () => void;
}

function TicketView({ detail, updatedAt, refreshError, onChanged }: TicketViewProps) {
  const { ticket } = detail;
  const { worklist } = useLive();
  const waiting = ticket.status === 'waiting';
  // The ticket itself does not say how long ago it was observed; its worklist row does.
  const row = worklist.data?.worklist.items.find((item) => item.ticketNumber === ticket.number);
  const [confirming, setConfirming] = useState(false);
  const [discharge, setDischarge] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const timeline = useMemo(() => toTimelineItems(detail.timeline), [detail.timeline]);
  const openFlags = detail.flags.filter((flag) => flag.closedAt === null);

  const onDischarge = async () => {
    setDischarge({ busy: true, error: null });
    try {
      await api.dischargeTicket(ticket.number);
      setDischarge({ busy: false, error: null });
      setConfirming(false);
      onChanged();
    } catch (error) {
      setDischarge({ busy: false, error: errorMessage(error) });
    }
  };

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div className="flex flex-col gap-2">
          <Link href="/tickets" className="type-caption font-medium text-signal underline underline-offset-[3px]">
            All tickets
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1>
              <TicketNumber number={ticket.number} size="lg" />
            </h1>
            {detail.state ? (
              <StatusBadge state={detail.state} minutes={row?.minutesSinceObserved}>
                {detail.state === 'observed' && !row ? 'Observed' : undefined}
              </StatusBadge>
            ) : (
              <span className="text-ink-muted">Discharged at {ticket.dischargedAt ? clockTime(ticket.dischargedAt) : 'an unknown time'}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <LiveStatus updatedAt={updatedAt} />
          {waiting ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Discharge
            </Button>
          ) : null}
        </div>
      </header>

      {refreshError ? (
        <p role="alert" className="mb-4 rounded-md border border-flag bg-flag-soft px-3 py-2 font-medium">
          This ticket could not be refreshed: {refreshError} What is shown may be out of date.
        </p>
      ) : null}

      <div className="grid items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="handoff-heading" className="flex flex-col gap-2">
            <h2 id="handoff-heading" className="type-heading">
              Handoff
            </h2>
            <HandoffNote>{detail.handoff}</HandoffNote>
            <p className="type-caption text-ink-muted">Built from the measured values by a fixed template. Camera estimates, not a clinical assessment.</p>
          </section>

          {waiting ? (
            <section aria-labelledby="flags-heading" className="flex flex-col gap-2">
              <h2 id="flags-heading" className="type-heading">
                Open flags
              </h2>
              {openFlags.length === 0 ? (
                <p className="text-ink-muted">No flag is open on this ticket. A flag opens when a trend rule is met or a re-check is overdue.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {openFlags.map((flag) => (
                    <FlagItem key={flag.id} flag={flag} onChanged={onChanged} />
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section aria-labelledby="record-heading" className="flex flex-col gap-2">
            <h2 id="record-heading" className="type-heading">
              Record
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 rounded-lg border border-line bg-surface-raised p-4">
              <dt className="text-ink-muted">Checked in</dt>
              <dd className="font-mono tabular-nums">{clockTime(ticket.createdAt)}</dd>
              <dt className="text-ink-muted">Sittings</dt>
              <dd className="tabular-nums">
                {detail.sittings.length === 0 ? 'None yet' : `${detail.sittings.length}, baseline ${detail.baseline ? `from ${clockTime(detail.baseline.startedAt)}` : 'not set yet'}`}
              </dd>
              <dt className="text-ink-muted">Face match</dt>
              <dd>
                {ticket.faceEnrolled
                  ? 'Opted in. Matching numbers are stored until discharge.'
                  : waiting
                    ? ticket.faceOptIn
                      ? 'Opted in. Nothing stored yet.'
                      : 'Not opted in. Re-checks use the ticket number.'
                    : 'No face data is stored for this ticket'}
              </dd>
            </dl>
          </section>
        </div>

        <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
          <h2 id="timeline-heading" className="type-heading">
            Timeline
          </h2>
          <div className="rounded-lg border border-line bg-surface-raised p-4">
            <TicketTimeline items={timeline} />
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Discharge ticket ${ticket.number}?`}
        confirmLabel="Discharge and delete face data"
        cancelLabel="Keep waiting"
        busyLabel="Discharging"
        busy={discharge.busy}
        error={discharge.error}
        onConfirm={onDischarge}
        onCancel={() => {
          setConfirming(false);
          setDischarge({ busy: false, error: null });
        }}
      >
        <p>The ticket leaves the waiting room and its open flags are closed.</p>
        <p className="mt-2">
          {ticket.faceEnrolled ? 'The face-match numbers stored for this ticket are deleted.' : 'Any face-match numbers stored for this ticket are deleted.'} This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

/** The numbers the flag was raised on, frozen when it opened. */
function flagNumbers(flag: Flag): string {
  const { pulse, breathing, scoreAtCheckIn, scoreNow, minutesSinceCheckIn, minutesSinceObserved } = flag.detail;
  if (flag.rule === 'overdue') {
    return minutesSinceObserved == null ? 'No observation since check-in' : `No observation for ${Math.round(minutesSinceObserved)} min when the flag opened`;
  }
  const change = (name: string, unit: string, base: number | null, now: number | null) =>
    base == null || now == null ? `${name} had no reading` : `${name} ${base} to ${now} ${unit}`;
  const score = scoreAtCheckIn != null && scoreNow != null ? `, partial score ${scoreAtCheckIn} to ${scoreNow}` : '';
  return `${change('Pulse', 'bpm', pulse.base, pulse.now)}, ${change('breathing', 'breaths per min', breathing.base, breathing.now)}${score}, ${Math.round(minutesSinceCheckIn)} min after check-in`;
}

function FlagItem({ flag, onChanged }: { flag: Flag; onChanged: () => void }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const acknowledge = async () => {
    setState({ busy: true, error: null });
    try {
      await api.acknowledgeFlag(flag.id);
      setState({ busy: false, error: null });
      onChanged();
    } catch (error) {
      setState({ busy: false, error: errorMessage(error) });
    }
  };

  return (
    <li className={`flex flex-col gap-3 rounded-lg bg-surface-raised p-[15px] ${flag.rule === 'overdue' ? 'border-2 border-ink' : 'border-2 border-flag'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge state={flag.rule === 'overdue' ? 'overdue' : 'flag'}>{flag.rule === 'overdue' ? 'Overdue' : 'Trend flag'}</StatusBadge>
        <span className="font-semibold">{ruleText(flag.rule)}</span>
        <span className="type-caption text-ink-muted">Opened at {clockTime(flag.openedAt)}</span>
      </div>
      <p>{flagNumbers(flag)}</p>
      <div className="flex flex-wrap items-center gap-3">
        {flag.acknowledgedAt ? (
          <p className="inline-flex h-control-md items-center gap-2 font-semibold text-ink-muted">
            <Icon name="check" size={18} />
            Acknowledged{flag.acknowledgedBy ? ` by ${flag.acknowledgedBy}` : ''} at {clockTime(flag.acknowledgedAt)}
          </p>
        ) : (
          <Button variant="primary" onClick={acknowledge} disabled={state.busy}>
            {state.busy ? 'Acknowledging' : 'Acknowledge'}
          </Button>
        )}
        {state.error ? (
          <p role="alert" className="font-medium text-critical">
            {state.error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
