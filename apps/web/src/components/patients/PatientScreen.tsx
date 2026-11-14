'use client';

import { patientLabel, type Flag, type Patient, type PatientDetailResponse } from '@triagecam/contracts';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { Button, HandoffNote, Icon, PatientIdentity, PatientTimeline, StatusBadge, buttonClass } from '@/components/ds';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { ageInYears, calendarDate, clockTime, heartRate, minutes, rate, ruleText, years } from '@/lib/format';
import { toTimelineItems } from '@/lib/mapping';
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
  const facts = [age === null ? null : years(age), patient.sex ? SEX[patient.sex] : null].filter(Boolean).join(' · ');
  const { worklist } = useLive();
  const waiting = patient.status === 'waiting';
  // The patient itself does not say how long ago it was observed; its worklist row does.
  const row = worklist.data?.worklist.items.find((item) => item.patientNumber === patient.number);
  const [confirming, setConfirming] = useState(false);
  const [discharge, setDischarge] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const timeline = useMemo(() => toTimelineItems(detail.timeline), [detail.timeline]);
  const openFlags = detail.flags.filter((flag) => flag.closedAt === null);

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

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <Link href="/patients" className="type-caption font-medium text-signal underline underline-offset-[3px]">
            All patients
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <PatientIdentity patient={patient} size="lg" heading detail={facts || undefined} />
            {detail.state ? (
              <StatusBadge state={detail.state} minutes={row?.minutesSinceObserved}>
                {detail.state === 'observed' && !row ? 'Observed' : undefined}
              </StatusBadge>
            ) : (
              <span className="text-ink-muted">Discharged at {patient.dischargedAt ? clockTime(patient.dischargedAt) : 'an unknown time'}</span>
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
          This record could not be refreshed: {refreshError} What is shown may be out of date.
        </p>
      ) : null}

      <div className="grid items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="intake-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id="intake-heading" className="type-heading">
                Intake
              </h2>
              <Button variant="quiet" onClick={() => setEditing((on) => !on)}>
                {editing ? 'Done' : 'Edit'}
              </Button>
            </div>
            <div className="rounded-lg border border-line bg-surface-raised p-4">
              {editing ? (
                <IntakeForm key={patient.number} patient={patient} onSaved={(next) => setSaved({ patient: next, at: Date.now() })} />
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
                  <dt className="text-ink-muted">Reason for visit</dt>
                  <dd className="font-medium">{patient.reasonForVisit ?? <Missing />}</dd>
                  <dt className="text-ink-muted">Date of birth</dt>
                  <dd>{patient.dateOfBirth ? `${calendarDate(patient.dateOfBirth)}${age === null ? '' : ` (${years(age)})`}` : <Missing />}</dd>
                  <dt className="text-ink-muted">Sex</dt>
                  <dd>{patient.sex ? SEX[patient.sex] : <Missing />}</dd>
                  <dt className="text-ink-muted">Pain</dt>
                  <dd className="tabular-nums">{patient.painScore === null ? <Missing /> : `${patient.painScore} out of 10`}</dd>
                  <dt className="text-ink-muted">Allergies</dt>
                  <dd>{patient.allergies ?? <Missing />}</dd>
                  <dt className="text-ink-muted">Notes</dt>
                  <dd className="whitespace-pre-wrap">{patient.notes ?? <Missing />}</dd>
                </dl>
              )}
            </div>
            {patient.intakeCompletedAt ? null : <p className="type-caption text-ink-muted">Intake has not been marked complete.</p>}
          </section>

          <section aria-labelledby="handoff-heading" className="flex flex-col gap-2">
            <h2 id="handoff-heading" className="type-heading">
              Handoff
            </h2>
            <HandoffNote>{detail.handoff}</HandoffNote>
            <p className="type-caption text-ink-muted">Written from the readings on this page</p>
          </section>

          {waiting ? (
            <section aria-labelledby="flags-heading" className="flex flex-col gap-2">
              <h2 id="flags-heading" className="type-heading">
                Open flags
              </h2>
              {openFlags.length === 0 ? (
                <p className="text-ink-muted">No flag is open for this patient. A flag opens when a trend rule is met or a re-check is overdue.</p>
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
              <dd className="font-mono tabular-nums">{clockTime(patient.createdAt)}</dd>
              <dt className="text-ink-muted">Sittings</dt>
              <dd className="tabular-nums">
                {detail.sittings.length === 0 ? 'None yet' : `${detail.sittings.length}, baseline ${detail.baseline ? `from ${clockTime(detail.baseline.startedAt)}` : 'not set yet'}`}
              </dd>
              <dt className="text-ink-muted">Face match</dt>
              <dd>
                {patient.faceEnrolled
                  ? 'Opted in. Matching numbers are stored until discharge.'
                  : waiting
                    ? patient.faceOptIn
                      ? 'Opted in. Nothing stored yet.'
                      : 'Not opted in. Re-checks are started by name.'
                    : 'Nothing is stored for face match'}
              </dd>
            </dl>
          </section>
        </div>

        <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
          <h2 id="timeline-heading" className="type-heading">
            Timeline
          </h2>
          <div className="rounded-lg border border-line bg-surface-raised p-4">
            <PatientTimeline items={timeline} />
          </div>
        </section>
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
        <p className="mt-2">
          {patient.faceEnrolled ? 'The face-match numbers stored for this patient are deleted. ' : ''}This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

const SEX: Record<NonNullable<Patient['sex']>, string> = { female: 'Female', male: 'Male', other: 'Other' };

function Missing() {
  return <span className="text-ink-muted">Not recorded</span>;
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
  return `${change('Pulse', pulse.base, pulse.now, heartRate)}, ${change('breathing', breathing.base, breathing.now, (value) => `${rate(value)} breaths per min`)}${score}, ${minutes(minutesSinceCheckIn)} after check-in`;
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
