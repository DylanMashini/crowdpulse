'use client';

import { patientLabel, type FlagRule, type PatientStatistics, type Statistics, type TileState } from '@triagecam/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useLiveEvents } from '@/components/app/live';
import { PatientIdentity, ScoreChip, StatusBadge, TrendValue, buttonClass, tableCell, tableFrame, tableHeadCell } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { dayTime, decimal, minutes, percent, seconds, timeOrDayTime } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

import { RateHistogram } from './RateHistogram';
import { Sparkline } from './Sparkline';

type Preset = 'today' | 'day' | 'week';
const HOUR = 3_600_000;
/** Events arrive in bursts (every auto-save of the intake form is one), so they share one refresh. */
const REFRESH_DELAY_MS = 2000;

interface Range {
  preset: Preset;
  /** Start of the range. Missing for today: the server then starts at its own midnight. */
  from?: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="type-readout-lg">{value}</span>
        {note ? <span className="type-caption text-ink-muted">{note}</span> : null}
      </dd>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium whitespace-nowrap tabular-nums">{children}</dd>
    </div>
  );
}

const none = (words: string) => <span className="font-normal text-ink-muted">{words}</span>;
const orNone = (value: number | null, format: (value: number) => string, words: string) => (value == null ? none(words) : format(value));

const STATES: Array<{ state: TileState; label: string; swatch: string }> = [
  { state: 'flag', label: 'Trend flag', swatch: 'bg-flag' },
  { state: 'overdue', label: 'Overdue', swatch: 'bg-overdue' },
  { state: 'no-reading', label: 'No reading', swatch: 'border border-dashed border-line-strong bg-surface-sunken' },
  { state: 'observed', label: 'Observed', swatch: 'bg-signal' },
];

/** Who is in the room now, by state: one bar split in the order a nurse would walk it. */
function StateBar({ byState, total }: { byState: Record<TileState, number>; total: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div aria-hidden className="flex h-[12px] gap-[2px]">
        {STATES.filter(({ state }) => byState[state] > 0).map(({ state, swatch }) => (
          <span key={state} className={cx('min-w-[6px] rounded-sm', swatch)} style={{ flexGrow: byState[state], flexBasis: 0 }} />
        ))}
      </div>
      <ul aria-label={`${plural(total, 'patient', 'patients')} waiting, by state`} className="flex flex-wrap gap-x-5 gap-y-2">
        {STATES.map(({ state, label, swatch }) => (
          <li key={state} className="flex items-center gap-2">
            <span aria-hidden className={cx('size-[10px] rounded-[2px]', swatch)} />
            <span className="font-semibold tabular-nums">{byState[state]}</span>
            <span className="text-ink-muted">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RULES: Array<{ rule: FlagRule; label: string }> = [
  { rule: 'score_rise', label: 'Partial score rose' },
  { rule: 'baseline_shift', label: 'Moved from baseline' },
  { rule: 'overdue', label: 'Overdue for a re-check' },
];

export function StatisticsScreen() {
  const [range, setRange] = useState<Range>({ preset: 'today' });
  const statistics = useResource(`statistics:${range.preset}:${range.from ?? ''}`, () => api.statistics(range.from));
  const reload = statistics.reload;

  // The page counts what the waiting room is doing, so it follows the room: at most one refresh
  // every REFRESH_DELAY_MS, however many events arrive in that time.
  const latestReload = useRef(reload);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latestReload.current = reload;
  });
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
  useLiveEvents((event) => {
    // None of these changes a number on the page.
    if (event.type === 'reading' || event.type === 'live_changed' || event.type === 'sitting_started') return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      latestReload.current();
    }, REFRESH_DELAY_MS);
  });

  const choose = (preset: Preset) => {
    const hours = preset === 'day' ? 24 : preset === 'week' ? 24 * 7 : null;
    setRange({ preset, from: hours === null ? undefined : new Date(Date.now() - hours * HOUR).toISOString() });
  };

  const data = statistics.data;

  return (
    <>
      <PageHeader title="Statistics" description={data ? `${dayTime(data.from)} to ${dayTime(data.to)}` : 'Patients, observations and flags'}>
        <LiveStatus updatedAt={statistics.updatedAt} />
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

      {statistics.loading ? <StateMessage kind="loading" title="Loading statistics" /> : null}
      {statistics.error ? (
        data ? (
          <p role="alert" className="mb-4 rounded-md border border-flag bg-flag-soft px-3 py-2 font-medium">
            The statistics could not be refreshed: {statistics.error.message} The numbers below may be out of date.
          </p>
        ) : (
          <StateMessage kind="error" title="The statistics could not be loaded" onRetry={statistics.reload}>
            {statistics.error.message}
          </StateMessage>
        )
      ) : null}
      {data ? <Results data={data} /> : null}
    </>
  );
}

function Results({ data }: { data: Statistics }) {
  const { patients, waitingNow, sittings, flags } = data;

  if (patients.seen === 0) {
    return (
      <StateMessage
        kind="empty"
        title="Nobody was in the waiting room in this period"
        action={
          <Link href="/check-in" className={buttonClass('secondary')}>
            Go to check-in
          </Link>
        }
      >
        The numbers start with the first check-in on a camera phone. Choose a longer period to see earlier patients.
      </StateMessage>
    );
  }

  const noSittings = 'No sitting finished';
  const cadence = sittings.medianMinutesBetweenObservations;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Patients seen" value={String(patients.seen)} note={`${patients.arrived} arrived, ${patients.discharged} discharged`} />
          <Stat
            label="Waiting now"
            value={String(waitingNow.patients)}
            note={waitingNow.longestMinutesWaiting == null ? 'The waiting room is empty' : `Longest wait ${minutes(waitingNow.longestMinutesWaiting)}`}
          />
          <Stat
            label="Observations"
            value={String(sittings.withReading)}
            note={sittings.finished === 0 ? noSittings : `${sittings.withReading} of ${plural(sittings.finished, 'sitting', 'sittings')} gave a reading`}
          />
          <Stat
            label="Flags raised"
            value={String(flags.raised)}
            note={flags.raised === 0 ? 'No trend or overdue flag' : `${flags.acknowledged} acknowledged, ${flags.openNow} open now`}
          />
        </dl>
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel heading="Waiting room now">
          {waitingNow.patients === 0 ? (
            <p className="text-ink-muted">Nobody is waiting. Patients appear here when a check-in starts.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <StateBar byState={waitingNow.byState} total={waitingNow.patients} />
              <dl>
                <Line label="Median wait">{orNone(waitingNow.medianMinutesWaiting, minutes, 'Nobody waiting')}</Line>
                <Line label="Longest wait">{orNone(waitingNow.longestMinutesWaiting, minutes, 'Nobody waiting')}</Line>
                <Line label="Median time since last observation">{orNone(waitingNow.medianMinutesSinceObserved, minutes, 'Nobody waiting')}</Line>
                <Line label="Longest time since last observation">{orNone(waitingNow.longestMinutesSinceObserved, minutes, 'Nobody waiting')}</Line>
              </dl>
            </div>
          )}
        </Panel>

        <Panel heading="Re-checks">
          <dl>
            <Line label="Check-in sittings">{sittings.checkIns}</Line>
            <Line label="Re-check sittings">{sittings.rechecks}</Line>
            <Line label="Sittings per patient">{orNone(sittings.meanPerPatient, decimal, noSittings)}</Line>
            <Line label="Median time between observations">
              {cadence == null ? none('No patient observed twice') : `${minutes(cadence)}, target ${minutes(data.recheckIntervalMin)}`}
            </Line>
            <Line label="Median time from arrival to first observation">
              {orNone(patients.medianMinutesToFirstObservation, minutes, 'No new patient observed')}
            </Line>
            <Line label="Median time from arrival to discharge">{orNone(patients.medianMinutesToDischarge, minutes, 'Nobody discharged')}</Line>
          </dl>
        </Panel>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <RateHistogram title="Heart rate" unit="bpm" distribution={data.heartRate} usual={{ from: 51, to: 90 }} />
        <RateHistogram title="Breathing rate" unit="breaths per min" distribution={data.breathingRate} usual={{ from: 12, to: 20 }} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel heading="Camera signal">
          <dl>
            <Line label="Sittings that gave a reading">
              {sittings.finished === 0 ? none(noSittings) : `${sittings.withReading} of ${sittings.finished} (${percent(sittings.withReading / sittings.finished)})`}
            </Line>
            <Line label="Seconds with a heart rate">{orNone(sittings.meanHeartRateCoverage, percent, noSittings)}</Line>
            <Line label="Seconds with a breathing rate">{orNone(sittings.meanBreathingRateCoverage, percent, noSittings)}</Line>
            <Line label="Median time to first reading">{orNone(sittings.medianTimeToFirstReadingSeconds, seconds, 'No sitting gave a heart rate')}</Line>
          </dl>
        </Panel>

        <Panel heading="Flags">
          <dl>
            {RULES.map(({ rule, label }) => (
              <Line key={rule} label={label}>
                {flags.byRule[rule]}
              </Line>
            ))}
            <Line label="Acknowledged">{flags.raised === 0 ? none('No flag raised') : `${flags.acknowledged} of ${flags.raised}`}</Line>
            <Line label="Median time to acknowledge">{orNone(flags.medianMinutesToAcknowledge, minutes, 'None acknowledged')}</Line>
            <Line label="Open now, not acknowledged">
              {flags.unacknowledgedNow} of {flags.openNow}
            </Line>
          </dl>
        </Panel>
      </div>

      <section aria-labelledby="per-patient-heading" className="flex flex-col gap-3">
        <h2 id="per-patient-heading" className="type-heading">
          Patients in this period
        </h2>
        <div className={tableFrame}>
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr>
                {['Patient', 'Status', 'In the room', 'Observations', 'Pulse', 'Breathing', 'Score', 'Flags'].map((heading) => (
                  <th key={heading} scope="col" className={tableHeadCell}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.perPatient.map((row) => (
                <PatientRow key={row.patientNumber} row={row} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-[720px] type-caption text-ink-muted">
          Counted from this waiting room&apos;s own sittings. How the camera compares with contact sensors is measured on public recordings:{' '}
          <Link href="/#accuracy" className="font-medium text-signal underline underline-offset-[3px]">
            see accuracy
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function PatientRow({ row }: { row: PatientStatistics }) {
  const muted = 'text-[13px] whitespace-nowrap text-ink-muted';
  // "No reading" means a sitting ran and gave nothing; with no sitting at all, say that instead.
  const unmeasured = row.sittings === 0 && row.pulse.base == null && row.breathing.base == null;
  return (
    <tr className="relative hover:[&>td]:bg-surface">
      <td className={cx(tableCell, 'max-w-[260px] min-w-[180px]')}>
        <Link href={`/patients/${row.patientNumber}`} aria-label={`Open ${patientLabel(row.patient)}`} className="flex rounded-sm after:absolute after:inset-0 after:content-['']">
          <PatientIdentity patient={row.patient} size="sm" />
        </Link>
      </td>
      <td className={tableCell}>
        {row.state ? (
          <StatusBadge state={row.state} minutes={row.minutesSinceObserved} brief />
        ) : (
          <span className="whitespace-nowrap text-ink-muted">Discharged{row.dischargedAt ? ` ${timeOrDayTime(row.dischargedAt)}` : ''}</span>
        )}
      </td>
      <td className={cx(tableCell, 'whitespace-nowrap tabular-nums')}>{minutes(row.minutesInRoom)}</td>
      <td className={cx(tableCell, 'whitespace-nowrap tabular-nums')}>
        {row.sittings === 0 ? <span className={muted}>No sitting finished</span> : `${row.observations} of ${row.sittings}`}
      </td>
      <td className={tableCell}>
        <span className="flex items-center gap-2">
          <TrendValue trend={row.pulse} unit="bpm" notMeasuredYet={unmeasured} stacked />
          <Sparkline values={row.heartRates} />
        </span>
      </td>
      <td className={tableCell}>
        <TrendValue trend={row.breathing} unit="/min" notMeasuredYet={unmeasured} stacked />
      </td>
      <td className={tableCell}>{row.score != null ? <ScoreChip score={row.score} caption={false} /> : <span className={muted}>Not scored</span>}</td>
      <td className={cx(tableCell, 'tabular-nums')}>{row.flags === 0 ? <span className={muted}>None</span> : row.flags}</td>
    </tr>
  );
}
