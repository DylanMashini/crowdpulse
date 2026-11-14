'use client';

import type { Statistics } from '@triagecam/contracts';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { TicketNumber, buttonClass, tableCell, tableFrame, tableHeadCell } from '@/components/ds';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { dayTime, fixed, percent, signed } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

import { BiasChart } from './BiasChart';

type Preset = 'today' | 'day' | 'week';
const HOUR = 3_600_000;

interface Range {
  preset: Preset;
  /** Start of the range. Missing for today: the server then starts at its own midnight. */
  from?: string;
}

function Stat({ label, value, unit, note }: { label: string; value: string | null; unit?: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-1">
        {value === null ? (
          <span className="type-subheading leading-[44px]">Not measured</span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="type-readout-lg">{value}</span>
            {unit ? <span className="text-ink-muted">{unit}</span> : null}
          </span>
        )}
        <span className="type-caption text-ink-muted">{note}</span>
      </dd>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{children}</dd>
    </div>
  );
}

const none = <span className="font-sans text-ink-muted">Not measured</span>;

export function StatisticsScreen() {
  const [range, setRange] = useState<Range>({ preset: 'today' });
  const statistics = useResource(`statistics:${range.preset}:${range.from ?? ''}`, () => api.statistics(range.from));

  const choose = (preset: Preset) => {
    const hours = preset === 'day' ? 24 : preset === 'week' ? 24 * 7 : null;
    setRange({ preset, from: hours === null ? undefined : new Date(Date.now() - hours * HOUR).toISOString() });
  };

  const data = statistics.data;

  return (
    <>
      <PageHeader
        title="Statistics"
        description={data ? `Pilot results from ${dayTime(data.from)} to ${dayTime(data.to)}. Every number states what it was counted over.` : 'Pilot results: agreement with the chest strap, coverage and flags'}
      >
        <Segmented
          label="Period"
          value={range.preset}
          onChange={choose}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'day', label: 'Last 24 hours' },
            { value: 'week', label: 'Last 7 days' },
          ]}
        />
      </PageHeader>

      {statistics.loading ? <StateMessage kind="loading" title="Loading the pilot numbers" /> : null}
      {statistics.error && !data ? (
        <StateMessage kind="error" title="The statistics could not be loaded" onRetry={statistics.reload}>
          {statistics.error.message}
        </StateMessage>
      ) : null}
      {data ? <Results data={data} /> : null}
    </>
  );
}

function Results({ data }: { data: Statistics }) {
  const { heartRate, sittings, flags, totals } = data;
  const paired = `n = ${heartRate.pairedReadings} paired readings`;
  const hasReference = totals.sittingsWithReference > 0;

  if (sittings.attempted === 0 && flags.episodes === 0) {
    return (
      <StateMessage
        kind="empty"
        title="No sittings finished in this period"
        action={
          <Link href="/check-in" className={buttonClass('secondary')}>
            Go to check-in
          </Link>
        }
      >
        Results appear after the first finished sitting. For agreement numbers, connect the chest strap on the Check-in page before the sitting starts.
      </StateMessage>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {hasReference ? (
        <Panel heading="Heart rate against the chest strap">
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Mean absolute error" value={heartRate.meanAbsoluteErrorBpm == null ? null : fixed(heartRate.meanAbsoluteErrorBpm)} unit="bpm" note={paired} />
            <Stat label="Bias, camera minus strap" value={heartRate.biasBpm == null ? null : signed(heartRate.biasBpm)} unit="bpm" note={paired} />
            <Stat label="Readings within 5 bpm" value={heartRate.within5BpmShare == null ? null : percent(heartRate.within5BpmShare)} note={paired} />
            <Stat
              label="Sittings accepted and within 5 bpm"
              value={sittings.accurateAcceptedShare == null ? null : percent(sittings.accurateAcceptedShare)}
              note={`n = ${totals.sittingsWithReference} sittings with a reference. No reading counts as a miss.`}
            />
          </dl>
        </Panel>
      ) : (
        <StateMessage
          kind="empty"
          title="No sitting has a reference yet"
          action={
            <Link href="/check-in" className={buttonClass('secondary')}>
              Go to check-in
            </Link>
          }
        >
          Error, bias and the share within 5 bpm need the chest strap. Connect it on the Check-in page, then run a sitting. The coverage and flag numbers below do not need it.
        </StateMessage>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {hasReference ? (
          <Panel heading="Bias by ticket">
            <p className="-mt-2 mb-3 max-w-[640px] type-caption text-ink-muted">
              Mean of camera estimate minus chest strap for each ticket. The dashed line is the mean over all {heartRate.pairedReadings} paired readings.
            </p>
            <BiasChart tickets={data.perTicket} overallBias={heartRate.biasBpm} />
          </Panel>
        ) : null}

        <div className={cx('flex flex-col gap-5', !hasReference && 'xl:col-span-2 xl:grid xl:grid-cols-2')}>
          <Panel heading="Sittings">
            <dl>
              <Line label="Finished">{sittings.attempted}</Line>
              <Line label="Gave a heart rate">
                {sittings.withReading} of {sittings.attempted}
              </Line>
              <Line label="Mean coverage">{sittings.meanCoverage == null ? none : percent(sittings.meanCoverage)}</Line>
              <Line label="Median time to first reading">
                {sittings.medianTimeToFirstReadingSeconds == null ? none : `${fixed(sittings.medianTimeToFirstReadingSeconds)} s`}
              </Line>
              <Line label="Longest dropout">{sittings.longestDropoutSeconds == null ? none : `${fixed(sittings.longestDropoutSeconds, 0)} s`}</Line>
            </dl>
          </Panel>
          <Panel heading="Flags">
            <dl>
              <Line label="Episodes opened">{flags.episodes}</Line>
              <Line label="Per person-hour">{flags.episodesPerPersonHour == null ? none : fixed(flags.episodesPerPersonHour, 2)}</Line>
              <Line label="Person-hours waited">{fixed(totals.personHours)}</Line>
              <Line label="Acknowledged">
                {flags.acknowledged} of {flags.episodes}
              </Line>
              <Line label="Median time to acknowledge">
                {flags.medianMinutesToAcknowledge == null ? none : `${fixed(flags.medianMinutesToAcknowledge, 0)} min`}
              </Line>
            </dl>
          </Panel>
        </div>
      </div>

      <section aria-labelledby="per-ticket-heading" className="flex flex-col gap-3">
        <h2 id="per-ticket-heading" className="type-heading">
          Results per ticket
        </h2>
        <div className={tableFrame}>
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr>
                <th scope="col" className={tableHeadCell}>
                  Ticket
                </th>
                {['Sittings', 'Paired readings', 'Mean absolute error, bpm', 'Bias, bpm', 'Within 5 bpm', 'Coverage'].map((heading) => (
                  <th key={heading} scope="col" className={cx(tableHeadCell, 'text-right')}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.perTicket.map((row) => {
                const cell = cx(tableCell, 'text-right font-mono tabular-nums');
                const missing = <span className="font-sans text-[13px] text-ink-muted">No reference</span>;
                return (
                  <tr key={row.ticketNumber}>
                    <td className={tableCell}>
                      <TicketNumber number={row.ticketNumber} size="sm" />
                    </td>
                    <td className={cell}>{row.sittings}</td>
                    <td className={cell}>{row.pairedReadings}</td>
                    <td className={cell}>{row.meanAbsoluteErrorBpm == null ? missing : fixed(row.meanAbsoluteErrorBpm)}</td>
                    <td className={cell}>{row.biasBpm == null ? missing : signed(row.biasBpm)}</td>
                    <td className={cell}>{row.within5BpmShare == null ? missing : percent(row.within5BpmShare)}</td>
                    <td className={cell}>{row.coverage == null ? <span className="font-sans text-[13px] text-ink-muted">No sitting finished</span> : percent(row.coverage)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="max-w-[720px] type-caption text-ink-muted">
          A pilot on a small number of volunteers. These numbers describe this sample only and are not evidence of clinical accuracy. Sittings from the stub source are left out.
        </p>
      </section>
    </div>
  );
}
