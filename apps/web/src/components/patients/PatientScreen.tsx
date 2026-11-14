'use client';

import { flagAlerts, patientLabel, type Flag, type FlagAlert, type Patient, type PatientDetailResponse } from '@triagecam/contracts';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { Button, HandoffNote, Icon, PatientIdentity, PatientTimeline, StatusBadge, buttonClass } from '@/components/ds';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, Section, StaleNotice } from '@/components/ui/Panel';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { ageInYears, breathsPerMin, calendarDate, clockTime, heartRate, minutes, rate, rulesText, timeOrDayTime, years } from '@/lib/format';
import { toTimelineItems } from '@/lib/mapping';
import { severityOf } from '@/lib/severity';
import { useResource } from '@/lib/use-resource';

import { IntakeForm } from './IntakeForm';

export function PatientScreen({ number }: { number: number }) {
  const detail = useResource(`patient:${number}`, () => api.patient(number));

  useLiveEvents((event) => {
    const concernsPatient =
      event.type === 'reconnected' ||
      (event.type === 'patient_changed' && event.patientNumber === number) ||
      ((event.type === 'flag_opened' || event.type === 'flag_acknowledged' || event.type === 'flag_closed') && event.flag.patientNumber === number) ||
      ((event.type === 'sitting_started' || event.type === 'sitting_finished') && event.sitting.patientNumber === number);
    if (concernsPatient) detail.reload();
  });

  if (detail.loading) return <StateMessage kind="loading" title="Loading the patient" />;

  if (!detail.data) {
    const missing = detail.error?.code === 'not_found';
    return (
      <StateMessage
        kind={missing ? 'empty' : 'error'}
        title={missing ? `There is no patient with visit number ${number}` : 'The patient could not be loaded'}
        onRetry={missing ? undefined : detail.reload}
        action={
          <Link href="/patients" className={buttonClass('secondary')}>
            All patients
          </Link>
        }
      >
        {missing ? 'Visit numbers are given in order at check-in and are never reused. Find the patient by name under Patients.' : detail.error?.message}
      </StateMessage>
    );
  }

  return <PatientView detail={detail.data} updatedAt={detail.updatedAt} refreshError={detail.error?.message ?? null} onChanged={detail.reload} />;
}

interface PatientViewProps {
  detail: PatientDetailResponse;
  updatedAt: number | null;
  refreshError: string | null;
  onChanged: () => void;
}

function PatientView({ detail, updatedAt, refreshError, onChanged }: PatientViewProps) {
  const [saved, setSaved] = useState<{ patient: Patient; at: number } | null>(null);
  // Whichever arrived last: the answer to the form's own save, or the record as refetched.
  const patient = saved && saved.at > (updatedAt ?? 0) ? saved.patient : detail.patient;
  const [editing, setEditing] = useState(false);
  const age = ageInYears(patient.dateOfBirth);
  const summary = [age === null ? null : years(age), patient.sex ? SEX[patient.sex].toLowerCase() : null].filter(Boolean).join(', ');
  const { worklist } = useLive();
  const waiting = patient.status === 'waiting';
  // The patient itself does not say how long ago it was observed; its worklist row does.
  const row = worklist.data?.worklist.items.find((item) => item.patientNumber === patient.number);
  const [confirming, setConfirming] = useState(false);
  const [discharge, setDischarge] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const timeline = useMemo(() => toTimelineItems(detail.timeline), [detail.timeline]);
  const openFlags = detail.flags.filter((flag) => flag.closedAt === null);
  const severity = severityOf(
    detail.state,
    row?.score,
    openFlags.map((flag) => flag.rule),
  );

  const onDischarge = async () => {
    setDischarge({ busy: true, error: null });
    try {
      await api.dischargePatient(patient.number);
      setDischarge({ busy: false, error: null });
      setConfirming(false);
      onChanged();
    } catch (error) {
      setDischarge({ busy: false, error: errorMessage(error) });
    }
  };

  const facts = (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 type-dense">
      <dt className="text-ink-muted">Reason for visit</dt>
      <dd className="text-ink">{patient.reasonForVisit ?? <Missing />}</dd>
      <dt className="text-ink-muted">Date of birth</dt>
      <dd className="text-ink tabular-nums">{patient.dateOfBirth ? `${calendarDate(patient.dateOfBirth)}${age === null ? '' : ` (${years(age)})`}` : <Missing />}</dd>
      <dt className="text-ink-muted">Sex</dt>
      <dd className="text-ink">{patient.sex ? SEX[patient.sex] : <Missing />}</dd>
      <dt className="text-ink-muted">Pain</dt>
      <dd className="text-ink tabular-nums">{patient.painScore === null ? <Missing /> : `${patient.painScore} out of 10`}</dd>
      <dt className="text-ink-muted">Allergies</dt>
      <dd className="text-ink">{patient.allergies ?? <Missing />}</dd>
      <dt className="text-ink-muted">Notes</dt>
      <dd className="whitespace-pre-wrap text-ink">{patient.notes ?? <Missing />}</dd>
    </dl>
  );

  return (
    <>
      <PageHeader
        lead={
          <Link href="/patients" className={`${buttonClass('quiet')} -ml-2 gap-1 pr-2 pl-1`}>
            <Icon name="back" />
            All patients
          </Link>
        }
      >
        <LiveStatus updatedAt={updatedAt} />
        {waiting ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Discharge
          </Button>
        ) : null}
      </PageHeader>

      {refreshError ? <StaleNotice>This record could not be refreshed: {refreshError} What is shown may be out of date.</StaleNotice> : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line p-5">
        <PatientIdentity patient={patient} size="lg" heading detail={summary || undefined} />
        {detail.state ? (
          <StatusBadge state={detail.state} severity={severity} minutes={row?.minutesSinceObserved}>
            {detail.state === 'observed' && !row ? 'Observed' : undefined}
          </StatusBadge>
        ) : (
          <span className="type-dense text-ink-muted tabular-nums">Discharged at {patient.dischargedAt ? timeOrDayTime(patient.dischargedAt) : 'an unknown time'}</span>
        )}
      </div>

      <div className="grid flex-1 content-start lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] lg:content-stretch">
        <div className="flex min-w-0 flex-col">
          <Section
            heading="Intake"
            labelledBy="intake-heading"
            aside={
              <Button variant="quiet" onClick={() => setEditing((on) => !on)}>
                {editing ? 'Done' : 'Edit'}
              </Button>
            }
          >
            {editing ? <IntakeForm key={patient.number} patient={patient} onSaved={(next) => setSaved({ patient: next, at: Date.now() })} /> : facts}
            {patient.intakeCompletedAt ? null : <p className="mt-3 type-caption text-ink-faint">Intake has not been marked complete.</p>}
          </Section>

          <Section heading="Handoff" labelledBy="handoff-heading">
            <HandoffNote severity={openFlags.length > 0 ? severity : null}>{detail.handoff}</HandoffNote>
            <p className="mt-2 type-caption text-ink-faint">Written from the readings on this page</p>
          </Section>

          {waiting ? (
            <Section heading="Open flags" labelledBy="flags-heading">
              {openFlags.length === 0 ? (
                <p className="type-dense text-ink-muted">No flag is open for this patient. A flag opens when a trend rule is met or a re-check is overdue.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {flagAlerts(openFlags).map((alert) => (
                    <FlagItem key={alert.id} alert={alert} onChanged={onChanged} />
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          <Section heading="Record" labelledBy="record-heading">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 type-dense">
              <dt className="text-ink-muted">Checked in</dt>
              <dd className="text-ink tabular-nums">{timeOrDayTime(patient.createdAt)}</dd>
              <dt className="text-ink-muted">Sittings</dt>
              <dd className="text-ink tabular-nums">
                {detail.sittings.length === 0 ? 'None yet' : `${detail.sittings.length}, baseline ${detail.baseline ? `from ${clockTime(detail.baseline.startedAt)}` : 'not set yet'}`}
              </dd>
              <dt className="text-ink-muted">Face match</dt>
              <dd className="text-ink">
                {patient.faceEnrolled
                  ? 'Opted in. Matching numbers are stored until discharge.'
                  : waiting
                    ? patient.faceOptIn
                      ? 'Opted in. Nothing stored yet.'
                      : 'Not opted in. Re-checks are started by name.'
                    : 'Nothing is stored for face match'}
              </dd>
            </dl>
          </Section>
        </div>

        <Section heading="Timeline" labelledBy="timeline-heading" className="border-line lg:border-l">
          <PatientTimeline items={timeline} />
        </Section>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Discharge ${patientLabel(patient)}?`}
        confirmLabel="Discharge"
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
        <p>{patientLabel(patient)} leaves the waiting room and any open flags are closed. The record, with its photo and readings, is kept under Patients.</p>
        <p className="mt-2 text-ink">
          {patient.faceEnrolled ? 'The face-match numbers stored for this patient are deleted. ' : ''}This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

const SEX: Record<NonNullable<Patient['sex']>, string> = { female: 'Female', male: 'Male', other: 'Other' };

function Missing() {
  return <span className="text-ink-faint">Not recorded</span>;
}

/** The numbers the flag was raised on, frozen when it opened. */
function flagNumbers(flag: Flag): string {
  const { pulse, breathing, scoreAtCheckIn, scoreNow, minutesSinceCheckIn, minutesSinceObserved } = flag.detail;
  if (flag.rule === 'overdue') {
    return minutesSinceObserved == null ? 'No observation since check-in' : `No observation for ${minutes(minutesSinceObserved)} when the flag opened`;
  }
  const change = (name: string, base: number | null, now: number | null, withUnit: (value: number) => string) =>
    base == null || now == null ? `${name} had no reading` : `${name} ${rate(base)} to ${withUnit(now)}`;
  const score = scoreAtCheckIn != null && scoreNow != null ? `, partial score ${scoreAtCheckIn} to ${scoreNow}` : '';
  return `${change('Pulse', pulse.base, pulse.now, heartRate)}, ${change('breathing', breathing.base, breathing.now, breathsPerMin)}${score}, ${minutes(minutesSinceCheckIn)} after check-in`;
}

/**
 * One alert, as the server groups them (`Flag.alertId`): a flag, or the trend flags that one
 * sitting raised together. It is acknowledged once, and only its own flags are acknowledged.
 */
function FlagItem({ alert, onChanged }: { alert: FlagAlert; onChanged: () => void }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { flags, lead: flag, waiting } = alert;

  const acknowledge = async () => {
    const next = waiting[0];
    if (!next) return;
    setState({ busy: true, error: null });
    try {
      // The server acknowledges the alert's other flags with this one.
      await api.acknowledgeFlag(next.id);
      setState({ busy: false, error: null });
      onChanged();
    } catch (error) {
      setState({ busy: false, error: errorMessage(error) });
    }
  };

  const overdue = flag.rule === 'overdue';
  const severity = overdue ? null : severityOf('flag', flag.detail.scoreNow, flags.map((each) => each.rule));
  const urgent = severity === 'urgent';

  return (
    <li className={cx('flex flex-col gap-3 rounded-lg border p-4', urgent ? 'border-urgent-line bg-urgent-soft' : 'border-line bg-surface-2')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge state={overdue ? 'overdue' : 'flag'} severity={severity}>
          {overdue ? 'Overdue' : 'Trend flag'}
        </StatusBadge>
        <span className="type-label text-ink">{rulesText(flags.map((each) => each.rule))}</span>
        <span className="type-caption text-ink-faint tabular-nums">Opened at {clockTime(flag.openedAt)}</span>
      </div>
      <p className={cx('type-dense tabular-nums', urgent ? 'text-ink' : 'text-ink-muted')}>{flagNumbers(flag)}</p>
      <div className="flex flex-wrap items-center gap-3">
        {alert.acknowledgedAt ? (
          <p className="inline-flex h-control-md items-center gap-2 type-dense text-ink-muted tabular-nums">
            <Icon name="check" />
            Acknowledged{alert.acknowledgedBy ? ` by ${alert.acknowledgedBy}` : ''} at {clockTime(alert.acknowledgedAt)}
          </p>
        ) : (
          <Button variant="primary" onClick={acknowledge} disabled={state.busy}>
            {state.busy ? 'Acknowledging' : 'Acknowledge'}
          </Button>
        )}
        {state.error ? (
          <p role="alert" className="type-caption text-urgent">
            {state.error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
