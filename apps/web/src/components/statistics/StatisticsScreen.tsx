'use client';

import { LOWER_CONFIDENCE_REPEAT, patientLabel, type FlagRule, type PatientStatistics, type Statistics, type TileState } from '@triagecam/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { PatientIdentity, ScoreChip, StatusBadge, TrendValue, buttonClass, TableFrame, tableCell, tableHeadCell, tableRow, textLink, type Severity } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, StaleNotice } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { dayTime, decimal, minutes, percent, seconds, timeOrDayTime } from '@/lib/format';
import { rowSeverity } from '@/lib/mapping';
import { severityOf } from '@/lib/severity';
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
    <div className={cell}>
      <dt className="type-caption text-ink-muted">{label}</dt>
      <dd className="mt-2 flex flex-col gap-2">
        <span className="type-readout-lg text-ink">{value}</span>
        {note ? <span className="type-caption text-ink-faint tabular-nums">{note}</span> : null}
      </dd>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2 type-dense first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right whitespace-nowrap text-ink tabular-nums">{children}</dd>
    </div>
  );
}

const none = (words: string) => <span className="text-ink-faint">{words}</span>;
const orNone = (value: number | null, format: (value: number) => string, words: string) => (value == null ? none(words) : format(value));

// The page is a ruled sheet: cells share hairlines instead of each sitting in a card of its own.
const cell = 'min-w-0 border-b border-line p-5';
const pair = 'grid xl:grid-cols-2 xl:[&>*:nth-child(odd)]:border-r';

// The same forms and colours as the chips: red for an urgent trend flag, amber for any other,
// the inverse for overdue, dashed for no reading, the stable grey for observed.
type Share = 'urgent' | TileState;
const SHARES: Array<{ share: Share; label: string; swatch: string }> = [
  { share: 'urgent', label: 'Urgent trend flag', swatch: 'bg-urgent' },
  { share: 'flag', label: 'Trend flag', swatch: 'bg-watch' },
  { share: 'overdue', label: 'Overdue', swatch: 'bg-overdue' },
  { share: 'no-reading', label: 'No reading', swatch: 'border border-dashed border-line-hover' },
  { share: 'observed', label: 'Observed', swatch: 'bg-stable' },
];

/**
 * Who is in the room now, by state: one bar split in the order a nurse would walk it. A flagged
 * patient is the colour their worklist row is, so `urgentFlags` of the flags are drawn red. A
 * patient whose latest sitting gave a lower-confidence pulse is in the no-reading state and
 * its part of the bar, and is counted under its own words in the legend.
 */
function StateBar({ byState, urgentFlags, lowConfidence, total }: { byState: Record<TileState, number>; urgentFlags: number; lowConfidence: number; total: number }) {
  const urgent = Math.min(urgentFlags, byState.flag);
  const counts: Record<Share, number> = { ...byState, urgent, flag: byState.flag - urgent };
  const shown = (share: Share) => (share === 'no-reading' ? counts[share] - lowConfidence : counts[share]);
  return (
    <div className="flex flex-col gap-3">
      <div aria-hidden className="flex h-[8px] gap-[2px]">
        {SHARES.filter(({ share }) => counts[share] > 0).map(({ share, swatch }) => (
          <span key={share} className={cx('min-w-[6px] rounded-sm', swatch)} style={{ flexGrow: counts[share], flexBasis: 0 }} />
        ))}
      </div>
      <ul aria-label={`${plural(total, 'patient', 'patients')} waiting, by state`} className="flex flex-wrap gap-x-5 gap-y-2 type-dense">
        {SHARES.map(({ share, label, swatch }) => (
          <li key={share} className="flex items-center gap-2">
            <span aria-hidden className={cx('size-[8px] rounded-[2px]', swatch)} />
            <span className="text-ink tabular-nums">{shown(share)}</span>
            <span className="text-ink-muted">{label}</span>
            {share === 'no-reading' && lowConfidence > 0 ? (
              <>
                <span className="text-ink tabular-nums">{lowConfidence}</span>
                <span className="text-ink-muted">{LOWER_CONFIDENCE_REPEAT}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One cell of the sheet with its heading. */
function Block({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className={cell}>
      <h2 className="mb-4 type-subheading text-ink">{heading}</h2>
      {children}
    </section>
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
          <StaleNotice>The statistics could not be refreshed: {statistics.error.message} The numbers below may be out of date.</StaleNotice>
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
  // A waiting patient is drawn in the severity their worklist row has; the rules behind a flag are on the worklist.
  const { worklist } = useLive();
  const severities = new Map(worklist.data?.worklist.items.map((item) => [item.patientNumber, rowSeverity(item)]));
  const urgentFlags = worklist.data?.worklist.items.filter((item) => item.state === 'flag' && rowSeverity(item) === 'urgent').length ?? 0;

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
    <>
      <dl className="grid sm:grid-cols-2 sm:[&>*:nth-child(odd)]:border-r xl:grid-cols-4 xl:[&>*:not(:last-child)]:border-r">
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

      <div className={pair}>
        <Block heading="Waiting room now">
          {waitingNow.patients === 0 ? (
            <p className="type-dense text-ink-muted">Nobody is waiting. Patients appear here when a check-in starts.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <StateBar byState={waitingNow.byState} urgentFlags={urgentFlags} lowConfidence={waitingNow.lowConfidence ?? 0} total={waitingNow.patients} />
              <dl>
                <Line label="Median wait">{orNone(waitingNow.medianMinutesWaiting, minutes, 'Nobody waiting')}</Line>
                <Line label="Longest wait">{orNone(waitingNow.longestMinutesWaiting, minutes, 'Nobody waiting')}</Line>
                <Line label="Median time since last observation">{orNone(waitingNow.medianMinutesSinceObserved, minutes, 'Nobody waiting')}</Line>
                <Line label="Longest time since last observation">{orNone(waitingNow.longestMinutesSinceObserved, minutes, 'Nobody waiting')}</Line>
              </dl>
            </div>
          )}
        </Block>

        <Block heading="Re-checks">
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
        </Block>
      </div>

      <div className={pair}>
        <div className={cell}>
          <RateHistogram title="Heart rate" unit="bpm" distribution={data.heartRate} usual={{ from: 51, to: 90 }} />
        </div>
        <div className={cell}>
          <RateHistogram title="Breathing rate" unit="breaths per min" distribution={data.breathingRate} usual={{ from: 12, to: 20 }} />
        </div>
      </div>

      <div className={pair}>
        <Block heading="Camera signal">
          <dl>
            <Line label="Sittings that gave a reading">
              {sittings.finished === 0 ? none(noSittings) : `${sittings.withReading} of ${sittings.finished} (${percent(sittings.withReading / sittings.finished)})`}
            </Line>
            <Line label="Seconds with a heart rate">{orNone(sittings.meanHeartRateCoverage, percent, noSittings)}</Line>
            <Line label="Seconds with a breathing rate">{orNone(sittings.meanBreathingRateCoverage, percent, noSittings)}</Line>
            <Line label="Median time to first reading">{orNone(sittings.medianTimeToFirstReadingSeconds, seconds, 'No sitting gave a heart rate')}</Line>
          </dl>
        </Block>

        <Block heading="Flags">
          {/* Counted as the worklist and the nurse app count them: one deterioration is one flag. */}
          <dl>
            <Line label="Flags raised">{flags.raised}</Line>
            <Line label="Acknowledged">{flags.raised === 0 ? none('No flag raised') : `${flags.acknowledged} of ${flags.raised}`}</Line>
            <Line label="Median time to acknowledge">{orNone(flags.medianMinutesToAcknowledge, minutes, 'None acknowledged')}</Line>
            <Line label="Open now, not acknowledged">
              {flags.unacknowledgedNow} of {flags.openNow}
            </Line>
          </dl>
          <h3 id="rules-tripped-heading" className="mt-5 mb-2 type-caption text-ink-muted">
            Rules that tripped
          </h3>
          <dl aria-labelledby="rules-tripped-heading">
            {RULES.map(({ rule, label }) => (
              <Line key={rule} label={label}>
                {flags.byRule[rule]}
              </Line>
            ))}
          </dl>
          <p className="mt-3 type-caption text-ink-faint">One flag can trip both trend rules, so these can add up to more than the flags raised.</p>
        </Block>
      </div>

      <section aria-labelledby="per-patient-heading">
        <h2 id="per-patient-heading" className="px-5 pt-5 pb-2 type-subheading text-ink">
          Patients in this period
        </h2>
        <TableFrame label="Patients in this period">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {COLUMNS.map(({ heading, right }) => (
                  <th key={heading} scope="col" className={cx(tableHeadCell, right && 'text-right')}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.perPatient.map((row) => (
                <PatientRow key={row.patientNumber} row={row} severity={row.state ? (severities.get(row.patientNumber) ?? severityOf(row.state, row.score)) : null} />
              ))}
            </tbody>
          </table>
        </TableFrame>
        <p className="max-w-[720px] p-5 type-caption text-ink-faint">
          Counted from this waiting room&apos;s own sittings. How the camera compares with contact sensors is measured on public recordings:{' '}
          <Link href="/#accuracy" className={textLink}>
            see accuracy
          </Link>
          .
        </p>
      </section>
    </>
  );
}

const COLUMNS: Array<{ heading: string; right?: boolean }> = [
  { heading: 'Patient' },
  { heading: 'Status' },
  { heading: 'Score' },
  { heading: 'Pulse, bpm', right: true },
  { heading: 'Breathing, /min', right: true },
  { heading: 'In the room', right: true },
  { heading: 'Observations', right: true },
  { heading: 'Flags', right: true },
];

function PatientRow({ row, severity }: { row: PatientStatistics; severity: Severity | null }) {
  const faint = 'type-caption whitespace-nowrap text-ink-faint';
  // "No reading" means a sitting ran and gave nothing; with no sitting at all, say that instead.
  const unmeasured = row.sittings === 0 && row.pulse.base == null && row.breathing.base == null;
  return (
    <tr className={cx('relative', tableRow)}>
      <td className={cx(tableCell, 'w-full max-w-0 min-w-[200px]')}>
        <Link href={`/patients/${row.patientNumber}`} aria-label={`Open ${patientLabel(row.patient)}`} className="flex rounded-sm after:absolute after:inset-0 after:content-['']">
          <PatientIdentity patient={row.patient} size="sm" quiet={!row.state || (row.state === 'observed' && !severity)} />
        </Link>
      </td>
      <td className={tableCell}>
        {row.state ? (
          <StatusBadge state={row.state} severity={severity} minutes={row.minutesSinceObserved} lowConfidence={row.pulse.lowConfidence != null} brief />
        ) : (
          <span className="whitespace-nowrap text-ink-faint tabular-nums">Discharged{row.dischargedAt ? ` ${timeOrDayTime(row.dischargedAt)}` : ''}</span>
        )}
      </td>
      <td className={tableCell}>{row.score != null ? <ScoreChip score={row.score} caption={false} /> : <span className={faint}>Not scored</span>}</td>
      <td className={cx(tableCell, 'text-right')}>
        <span className="inline-flex items-center gap-3">
          <Sparkline values={row.heartRates} />
          <TrendValue trend={row.pulse} unit="bpm" notMeasuredYet={unmeasured} layout="cell" severity={severity} />
        </span>
      </td>
      <td className={cx(tableCell, 'text-right')}>
        <TrendValue trend={row.breathing} unit="/min" notMeasuredYet={unmeasured} layout="cell" severity={severity} />
      </td>
      <td className={cx(tableCell, 'text-right whitespace-nowrap tabular-nums')}>{minutes(row.minutesInRoom)}</td>
      <td className={cx(tableCell, 'text-right whitespace-nowrap tabular-nums')}>
        {row.sittings === 0 ? <span className={faint}>No sitting finished</span> : `${row.observations} of ${row.sittings}`}
      </td>
      <td className={cx(tableCell, 'text-right tabular-nums')}>{row.flags === 0 ? <span className={faint}>None</span> : row.flags}</td>
    </tr>
  );
}
