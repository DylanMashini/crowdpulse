'use client';

import {
  PRIVACY_CAPTURE,
  isLowConfidence,
  patientLabel,
  type CameraState,
  type Device,
  type Patient,
  type PatientRef,
  type SittingKind,
  type WorklistItem,
} from '@triagecam/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { Button, PatientIdentity, PrivacyNote, ProvenanceTag, Switch, buttonClass, fieldLabel, fieldWell, fieldWellIdle, intakeSummary } from '@/components/ds';
import { SittingTimer } from '@/components/ds/SittingTimer';
import { IntakeForm } from '@/components/patients/IntakeForm';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, Section } from '@/components/ui/Panel';
import { StateMessage } from '@/components/ui/StateMessage';
import { ApiError, api } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { cx } from '@/lib/cx';
import { milliseconds, minutesAgo, rate } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

import { LiveFeed, type FeedStats } from './LiveFeed';
import { SittingView } from './SittingView';
import { SUMMARY_OVERDUE_MS, readyToStart, sittingToShow, stageCopy, stageOf, type Stage } from './station';
import { useCameraCommands } from './use-camera-commands';
import { useFollowedSitting } from './use-followed-sitting';

/** A phone counts as online when the server heard from it within this long. */
const ONLINE_WITHIN_MS = 2 * 60_000;
const DEVICE_REFRESH_MS = 15_000;

export function CheckInScreen() {
  const { worklist } = useLive();
  const now = useNow();
  const serverOffsetMs = worklist.data?.serverOffsetMs ?? null;
  const serverNow = now + (serverOffsetMs ?? 0);

  const devices = useResource('devices', api.devices);
  const reloadDevices = devices.reload;
  useEffect(() => {
    const timer = setInterval(reloadDevices, DEVICE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reloadDevices]);

  // What each phone says about itself arrives on the stream the moment it changes; the list is
  // only asked again for what the stream does not carry.
  const [reported, setReported] = useState<Record<string, CameraState | null>>({});
  useLiveEvents((event) => {
    if (event.type === 'camera_state') {
      setReported((previous) => ({ ...previous, [event.deviceId]: event.state }));
      if (!devices.data?.devices.some((device) => device.id === event.deviceId)) reloadDevices();
    } else if (event.type === 'reconnected') {
      setReported({});
      reloadDevices();
    } else if (event.type === 'live_changed' || event.type === 'sitting_started') reloadDevices();
  });

  const cameras = useMemo(
    () =>
      (devices.data?.devices ?? [])
        .filter((device) => device.role === 'camera')
        .map((device) => (device.id in reported ? { ...device, camera: reported[device.id] ?? null } : device)),
    [devices.data, reported],
  );
  const isConnected = (device: Device) => device.camera !== null || device.liveAt !== null;
  const isOnline = (device: Device) => isConnected(device) || serverNow - new Date(device.lastSeenAt).getTime() < ONLINE_WITHIN_MS;
  const [chosen, setChosen] = useState<string | null>(null);
  // The phone this page was last showing. When it goes quiet the page stays on it and says so,
  // instead of dropping to an empty list in the middle of a sitting.
  const [last, setLast] = useState<string | null>(null);
  const selected =
    cameras.find((device) => device.id === chosen) ??
    cameras.find((device) => device.liveAt !== null) ??
    cameras.find(isConnected) ??
    cameras.find((device) => device.id === last) ??
    cameras.find(isOnline) ??
    null;
  if (selected && selected.id !== last) setLast(selected.id);

  const picker = (
    <Section heading="Camera phone" className="max-xl:order-4">
      <div role="radiogroup" aria-label="Camera phone" className="flex flex-col gap-[2px]">
        {cameras.map((device) => {
          const on = device.id === selected?.id;
          const seenMinutes = Math.max(0, Math.floor((serverNow - new Date(device.lastSeenAt).getTime()) / 60_000));
          return (
            <button
              key={device.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setChosen(device.id)}
              className={cx(
                'flex h-row w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left transition-colors',
                on ? 'bg-surface-3 shadow-[inset_0_1px_0_var(--line)]' : 'hover:bg-surface-2',
              )}
            >
              <span
                aria-hidden
                className={cx('grid size-[14px] flex-none place-items-center rounded-pill border', on ? 'border-signal' : 'border-line-hover')}
              >
                {on ? <span className="size-[6px] rounded-pill bg-signal" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-label text-ink">{device.label}</span>
                <span className="type-caption text-ink-faint">
                  {device.liveAt
                    ? 'Camera on'
                    : device.camera
                      ? 'Connected, camera off'
                      : isOnline(device)
                        ? 'Signed in, app not open'
                        : `Offline, last seen ${minutesAgo(seenMinutes)}`}
                </span>
              </span>
              {device.liveAt ? <span aria-hidden className="size-[6px] flex-none rounded-pill bg-signal glow-live" /> : null}
            </button>
          );
        })}
      </div>
      {devices.error ? (
        <p role="alert" className="mt-3 type-caption text-watch">
          The list could not be refreshed: {devices.error.message}
        </p>
      ) : null}
    </Section>
  );

  return (
    <>
      <PageHeader title="Check-in" description="Run the whole check-in from here: start the camera phone, watch it measure, fill in the form.">
        <LiveStatus updatedAt={devices.updatedAt} />
      </PageHeader>

      {devices.loading ? <StateMessage kind="loading" title="Loading camera phones" /> : null}
      {devices.error && !devices.data ? (
        <StateMessage kind="error" title="The camera phones could not be loaded" onRetry={devices.reload}>
          {devices.error.message}
        </StateMessage>
      ) : null}
      {devices.data && cameras.length === 0 ? (
        <StateMessage kind="empty" title="No camera phone has signed in yet">
          Open the Crowdpulse app on the phone, sign in and choose the camera role. The phone appears here within {DEVICE_REFRESH_MS / 1000} seconds.
        </StateMessage>
      ) : null}

      {cameras.length > 0 && selected ? (
        <Station
          key={selected.id}
          device={selected}
          serverOffsetMs={serverOffsetMs}
          serverNow={serverNow}
          picker={picker}
          waiting={worklist.data?.worklist.items ?? []}
        />
      ) : null}
      {cameras.length > 0 && !selected ? (
        <div className={columns}>
          <StateMessage kind="empty" title="No camera phone is online">
            Open Crowdpulse on the phone in the camera role, or choose a phone from the list to follow it anyway.
          </StateMessage>
          <div className={side}>{picker}</div>
        </div>
      ) : null}
    </>
  );
}

// Two columns ruled apart on a wide screen. Below that the columns dissolve into one run, ordered
// so the picture and its controls come first and the form right under them; the device list goes last.
const columns = 'grid flex-1 content-start xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:content-stretch';
const side = 'flex min-w-0 flex-col border-line max-xl:contents xl:border-l';

interface StationProps {
  device: Device;
  serverOffsetMs: number | null;
  serverNow: number;
  picker: ReactNode;
  /** The waiting room, for choosing who to re-check. */
  waiting: WorklistItem[];
}

type Confirming = 'stop' | 'cancel' | null;

/**
 * Everything that belongs to one camera phone, and the one place a check-in is run from: its
 * picture with the outlines of what it measures, what it is doing, the button for what comes
 * next, the readings, and the patient in front of it.
 */
function Station({ device, serverOffsetMs, serverNow, picker, waiting }: StationProps) {
  const camera = device.camera;
  const cameraLive = device.liveAt !== null;
  const followed = useFollowedSitting(device.id);
  /** The finished sitting staff have moved on from. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const sitting = sittingToShow(followed.sitting, camera, dismissed);
  const running = sitting !== null && sitting.endedAt === null;
  const patientNumber = camera?.patientNumber ?? sitting?.patientNumber ?? null;
  const kind: SittingKind | null = camera?.kind ?? sitting?.kind ?? null;

  // The patient in front of this phone. Their name and photo arrive on the stream the moment
  // they change, here or on another screen; the full record is fetched for the intake form.
  const record = useResource(patientNumber === null ? null : `patient:${patientNumber}`, () => api.patient(patientNumber as number));
  const reloadRecord = record.reload;
  const [pushed, setPushed] = useState<{ ref: PatientRef | null; saved: { patient: Patient; at: number } | null }>({ ref: null, saved: null });
  useLiveEvents((event) => {
    if (event.type === 'sitting_started' && event.sitting.deviceId === device.id) setPushed({ ref: event.patient, saved: null });
    else if (event.type === 'patient_changed' && event.patientNumber === patientNumber) {
      setPushed((previous) => ({ ...previous, ref: event.patient }));
      reloadRecord();
    } else if (event.type === 'reconnected') reloadRecord();
  });
  const saved = pushed.saved?.patient.number === patientNumber ? pushed.saved : null;
  const fetched = record.data?.patient ?? null;
  // Whichever arrived last: the answer to this form's own save, or the record as refetched.
  const patient = saved && (!fetched || saved.at > (record.updatedAt ?? 0)) ? saved.patient : fetched;
  const pushedRef = pushed.ref?.number === patientNumber ? pushed.ref : null;
  const patientRef: PatientRef | null =
    patientNumber === null
      ? null
      : patient
        ? { number: patient.number, name: patient.name, photoUpdatedAt: patient.photoUpdatedAt }
        : (pushedRef ?? { number: patientNumber, name: null, photoUpdatedAt: null });

  const onSaved = useCallback((next: Patient) => setPushed((previous) => ({ ...previous, saved: { patient: next, at: Date.now() } })), []);

  const [feed, setFeed] = useState<FeedStats | null>(null);
  // The picture goes the moment the phone says its camera is off, not when its last frame lapses.
  const showFeed = cameraLive && camera?.phase !== 'idle';

  // The phone is back at idle and the sitting's summary has not come: wait a little, then say so.
  const awaitingSummary = camera?.phase === 'idle' && running ? (sitting?.id ?? null) : null;
  const [overdue, setOverdue] = useState<string | null>(null);
  useEffect(() => {
    if (!awaitingSummary) return;
    const timer = setTimeout(() => setOverdue(awaitingSummary), SUMMARY_OVERDUE_MS);
    return () => clearTimeout(timer);
  }, [awaitingSummary]);

  // A phone that has reported once is not an older app: if it goes quiet, it has gone quiet.
  const [reportedBefore, setReportedBefore] = useState(false);
  if (camera && !reportedBefore) setReportedBefore(true);

  const stage = stageOf({ camera, cameraLive, sitting, reportedBefore, summaryOverdue: overdue !== null && overdue === sitting?.id });
  const lowConfidence = sitting?.summary?.heartRate.value != null && isLowConfidence(sitting.summary.heartRateConfidence);
  const noReading = sitting?.summary != null && sitting.summary.heartRate.value == null;
  const copy = stageCopy(stage, camera, device.label, patientRef ? patientLabel(patientRef) : null, kind, lowConfidence, noReading);

  // --- what the buttons do ----------------------------------------------------------------------

  const commands = useCameraCommands(device.id, device.label, camera);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [removing, setRemoving] = useState(false);
  /** A patient created for a check-in the phone then did not open: used again, not made twice. */
  const unopened = useRef<number | null>(null);
  const busy = commands.pending !== null || creating || removing;
  const { send, fail } = commands;

  /** What became of the patient of a check-in that was cancelled before it started. */
  const [notice, setNotice] = useState<string | null>(null);
  // Start, End and Call off name the patient this page shows, so they cannot act on a check-in
  // another dashboard has opened on the same phone since.
  const onPhone = camera?.patientNumber ?? undefined;

  const open = (number: number, sittingKind: SittingKind) => {
    // The sitting on screen is done with: the page is about the next one from here.
    if (sitting) setDismissed(sitting.id);
    setNotice(null);
    return send({ type: 'open', patientNumber: number, kind: sittingKind });
  };

  const checkInNew = async () => {
    setCreating(true);
    try {
      const number = unopened.current ?? (await api.createPatient()).patient.number;
      unopened.current = number;
      if (await open(number, 'check_in')) unopened.current = null;
    } catch (failure) {
      fail(failure instanceof ApiError ? failure.message : 'The patient could not be created. Try again.');
    } finally {
      setCreating(false);
    }
  };

  const start = () => void send({ type: 'start', patientNumber: onPhone, enrolFace: patient ? patient.faceOptIn && !patient.faceEnrolled : false });
  const confirmed = () => {
    const type = confirming;
    setConfirming(null);
    if (type) void send({ type, patientNumber: onPhone });
  };

  // A new check-in makes the patient's record before the camera starts. Cancelled before a
  // sitting, a record with no name and no sitting is nobody: it is taken out of the waiting
  // room again. One that staff have started to fill in is kept, and the page says so.
  const everSat = (record.data?.sittings.length ?? 0) > 0;
  const cancelCheckIn = async () => {
    const blank = kind === 'check_in' && patient !== null && !patient.name && record.data !== null && !everSat ? patient.number : null;
    const kept = kind === 'check_in' && patientRef !== null && blank === null ? patientLabel(patientRef) : null;
    if (!(await send({ type: 'cancel', patientNumber: onPhone }))) return;
    if (blank === null) return setNotice(kept ? `${kept} stays in the waiting room.` : null);
    try {
      await api.dischargePatient(blank);
      setNotice(null);
    } catch {
      setNotice(`Patient ${blank} is still in the waiting room. Discharge them from their record.`);
    }
  };

  // After a check-in was called off mid-sitting: the patient is still waiting, unless staff say otherwise.
  const removable = stage === 'called_off' && sitting !== null && sitting.kind === 'check_in' && record.data !== null && record.data.sittings.every((past) => past.summary === null);
  const remove = async () => {
    if (!sitting) return;
    setRemoving(true);
    try {
      await api.dischargePatient(sitting.patientNumber);
      setDismissed(sitting.id);
    } catch (failure) {
      fail(failure instanceof ApiError ? failure.message : 'The patient could not be removed. Try again.');
    } finally {
      setRemoving(false);
    }
  };

  const [optIn, setOptIn] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });
  const setFaceMatch = async (next: boolean) => {
    if (!patient) return;
    setOptIn({ saving: true, error: null });
    try {
      onSaved((await api.updatePatient(patient.number, { faceOptIn: next })).patient);
      setOptIn({ saving: false, error: null });
    } catch (failure) {
      setOptIn({ saving: false, error: failure instanceof ApiError ? failure.message : 'Face match could not be changed. Try again.' });
    }
  };

  // Each step replaces the button that was pressed. Focus follows to the next step's button, or to
  // the words when there is none to press, so the keyboard and a screen reader keep their place.
  const controlRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const held = useRef(false);
  useEffect(() => {
    const root = controlRef.current;
    if (!held.current || !root) return;
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && !active.disabled && root.contains(active)) return;
    // Never onto a lesser button because the main one is not ready yet: Enter would then cancel.
    const first = root.querySelector<HTMLButtonElement>('button');
    (first && !first.disabled ? first : statusRef.current)?.focus();
  }, [stage]);

  const pendingType = commands.pending?.type ?? null;
  const offline = camera === null;
  const actions = stageActions();

  function stageActions(): ReactNode {
    switch (stage) {
      case 'ready':
        return (
          <Button variant="primary" size="lg" disabled={busy} onClick={() => void checkInNew()}>
            {creating || pendingType === 'open' ? `Opening on ${device.label}` : 'Check in a new patient'}
          </Button>
        );
      case 'opening':
        return (
          <Button variant="quiet" disabled={busy} onClick={() => void cancelCheckIn()}>
            Cancel
          </Button>
        );
      case 'blocked':
        return (
          <Button disabled={busy} onClick={() => void cancelCheckIn()}>
            Close check-in
          </Button>
        );
      case 'framing':
        return (
          <>
            <Button variant="primary" size="lg" disabled={busy || !readyToStart(camera)} onClick={start}>
              {pendingType === 'start' ? 'Starting' : 'Start sitting'}
            </Button>
            <Button variant="quiet" size="lg" disabled={busy} onClick={() => void cancelCheckIn()}>
              Cancel
            </Button>
          </>
        );
      case 'starting':
        return (
          <Button variant="primary" size="lg" disabled>
            Starting
          </Button>
        );
      case 'running':
        return (
          <>
            <Button disabled={busy} onClick={() => setConfirming('stop')}>
              {pendingType === 'stop' ? 'Ending' : 'End now'}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming('cancel')}>
              Call off
            </Button>
          </>
        );
      case 'done':
        return (
          <>
            <Button variant="primary" size="lg" disabled={busy || offline} onClick={() => void checkInNew()}>
              {creating || pendingType === 'open' ? `Opening on ${device.label}` : 'Check in next patient'}
            </Button>
            {sitting ? (
              <Button size="lg" disabled={busy || offline} onClick={() => void open(sitting.patientNumber, 'recheck')}>
                Repeat sitting
              </Button>
            ) : null}
          </>
        );
      case 'called_off':
        return (
          <>
            {sitting ? (
              <Button variant="primary" size="lg" disabled={busy || offline} onClick={() => void open(sitting.patientNumber, sitting.kind)}>
                {pendingType === 'open' ? `Opening on ${device.label}` : 'Start again'}
              </Button>
            ) : null}
            <Button size="lg" disabled={busy || offline} onClick={() => void checkInNew()}>
              Check in a new patient
            </Button>
            {removable ? (
              <Button variant="quiet" size="lg" disabled={busy} onClick={() => void remove()}>
                {removing ? 'Removing' : 'Remove from waiting room'}
              </Button>
            ) : null}
          </>
        );
      default:
        return null;
    }
  }

  // The words and the buttons for this moment. Under the picture while the camera is on; in
  // its place, as the one thing to look at, while it is off.
  const control = (
    <div
      ref={controlRef}
      onFocusCapture={() => {
        held.current = true;
      }}
      onBlurCapture={(event) => {
        // Focus that goes somewhere else on the page has left; focus lost because the button it was on is gone has not.
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) held.current = false;
      }}
      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3"
    >
      <div ref={statusRef} tabIndex={-1} role="status" className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1 rounded-sm">
        <p className="type-heading text-ink">{copy.title}</p>
        {copy.detail ? <p className={cx('max-w-[520px] type-dense', copy.attention ? 'text-watch' : 'text-ink-muted')}>{copy.detail}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
  const timed = stage === 'starting' || stage === 'running' || stage === 'saving';
  const elapsed = sitting && running ? Math.max(0, (serverNow - new Date(sitting.startedAt).getTime()) / 1000) : 0;
  // What went wrong with the last button, or on the phone's own screen.
  const trouble = commands.error ?? (stage === 'blocked' ? null : (camera?.error ?? null));
  const newPatient = kind === 'check_in';

  return (
    <div className={columns}>
      <div className="flex min-w-0 flex-col max-xl:contents">
        <Section className="max-xl:order-1">
          <div className="flex flex-col gap-4">
            {showFeed ? (
              <>
                <LiveFeed
                  deviceId={device.id}
                  deviceLabel={device.label}
                  serverOffsetMs={serverOffsetMs}
                  onStats={setFeed}
                  className={cx('aspect-auto h-[clamp(240px,44vh,480px)]', stage === 'running' && camera?.viewfinder === 'measuring' && 'border-signal-line')}
                >
                  <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-3">
                    <ProvenanceTag kind="live" reading className="bg-surface-0/70">
                      Live
                    </ProvenanceTag>
                    {feed ? (
                      <span className="rounded-sm bg-surface-0/70 px-2 py-[2px] type-readout-sm text-[12px] text-ink-muted">
                        {rate(feed.fps)} fps{feed.delayMs === null ? '' : `, ${milliseconds(feed.delayMs)}`}
                      </span>
                    ) : null}
                  </div>
                </LiveFeed>
                {timed ? <SittingTimer elapsed={elapsed} doneLabel="Saving" /> : null}
                {control}
              </>
            ) : (
              <div className="flex min-h-[clamp(160px,24vh,240px)] w-full flex-col justify-center gap-4 rounded-lg border border-line bg-surface-0 p-5">
                {timed ? <SittingTimer elapsed={elapsed} doneLabel="Saving" /> : null}
                {control}
              </div>
            )}

            {trouble ? (
              <p role="alert" className="type-dense text-watch">
                {trouble}
              </p>
            ) : null}

            {stage === 'framing' && newPatient && patient ? (
              <div className="flex flex-col gap-1">
                <Switch
                  label="Face match for re-checks"
                  hint="Ask the patient first. Finds their record by face when they sit down again; deleted at discharge."
                  checked={patient.faceOptIn}
                  disabled={optIn.saving || busy}
                  onChange={(next) => void setFaceMatch(next)}
                />
                {optIn.error ? (
                  <p role="alert" className="type-caption text-urgent">
                    {optIn.error}
                  </p>
                ) : null}
              </div>
            ) : null}

            {notice && stage === 'ready' ? (
              <p role="status" className="type-dense text-ink-muted">
                {notice}
              </p>
            ) : null}

            {/* Between sittings, whichever way the last one ended: someone already waiting can sit down next. */}
            {camera && (stage === 'ready' || stage === 'done' || stage === 'called_off') ? (
              <Recheck waiting={waiting} disabled={busy} onOpen={(number) => void open(number, 'recheck')} />
            ) : null}

            <PrivacyNote icon="video">{PRIVACY_CAPTURE}</PrivacyNote>
          </div>
        </Section>

        <div className="flex min-w-0 flex-col empty:hidden max-xl:order-3">
          {followed.phase === 'searching' ? <StateMessage kind="loading" title={`Looking for a sitting on ${device.label}`} /> : null}
          {followed.error ? (
            <StateMessage kind="error" title="The sitting could not be loaded" onRetry={followed.retry}>
              {followed.error.message}
            </StateMessage>
          ) : null}
          {/* A sitting that was called off has no values to show: the words above say what happened. */}
          {sitting && patientRef && showsReadings(stage) ? <SittingView sitting={sitting} patient={patientRef} readings={followed.readings} serverNow={serverNow} /> : null}
        </div>
      </div>

      <div className={side}>
        <Section
          className="max-xl:order-2"
          heading={patientRef ? (newPatient ? 'New patient' : 'Patient') : 'Intake'}
          aside={
            patientRef ? (
              <Link href={`/patients/${patientRef.number}`} className={buttonClass('quiet')}>
                Open record
              </Link>
            ) : null
          }
        >
          {patientRef === null ? (
            <div className="flex max-w-[480px] flex-col gap-1">
              <p className="type-label text-ink">Waiting for the next patient</p>
              <p className="type-dense text-ink-muted">
                The form opens here as soon as a check-in starts: name, reason for the visit and the rest of intake. Fill it in while the camera measures.
              </p>
            </div>
          ) : patient ? (
            <div className="flex flex-col gap-4">
              {newPatient ? null : <PatientIdentity patient={patientRef} size="md" detail={intakeSummary(null, patient.reasonForVisit)} />}
              <IntakeForm
                key={patient.number}
                patient={patient}
                onSaved={onSaved}
                cameraDeviceId={device.id}
                cameraLive={cameraLive}
                autoFocus={newPatient && running && !patient.name}
              />
            </div>
          ) : record.error ? (
            <StateMessage kind="error" flush title="The patient could not be loaded" onRetry={record.reload}>
              {record.error.message}
            </StateMessage>
          ) : (
            <StateMessage kind="loading" flush title="Opening the intake form" />
          )}
        </Section>
        {picker}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'stop' ? 'End the sitting now?' : 'Call off this sitting?'}
        confirmLabel={confirming === 'stop' ? 'End sitting' : 'Call off'}
        cancelLabel="Keep measuring"
        onConfirm={confirmed}
        onCancel={() => setConfirming(null)}
      >
        {confirming === 'stop'
          ? 'What has been measured so far is saved. Breathing and beat-to-beat values need the full 60 seconds and may show No reading.'
          : 'The sitting stops and nothing is saved for this patient.'}
      </ConfirmDialog>
    </div>
  );
}

const showsReadings = (stage: Stage) => stage !== 'called_off' && stage !== 'ready' && stage !== 'offline';

interface RecheckProps {
  waiting: WorklistItem[];
  disabled: boolean;
  onOpen: (patientNumber: number) => void;
}

/** The other way a sitting starts: someone already in the waiting room sits down again. */
function Recheck({ waiting, disabled, onOpen }: RecheckProps) {
  const id = useId();
  const candidates = waiting.filter((item) => !item.sittingInProgress);
  const [choice, setChoice] = useState('');
  const chosen = candidates.find((item) => String(item.patientNumber) === choice) ?? null;
  if (candidates.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
      <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-[6px]">
        <label htmlFor={id} className={fieldLabel}>
          Re-check someone in the waiting room
        </label>
        <div className={cx('flex h-control-md items-center', fieldWell, fieldWellIdle)}>
          <select
            id={id}
            value={chosen ? choice : ''}
            onChange={(event) => setChoice(event.target.value)}
            className="h-full min-w-0 flex-1 cursor-pointer rounded-md border-0 bg-transparent px-[10px] type-dense text-ink focus-visible:outline-none"
          >
            <option value="">Choose a patient</option>
            {candidates.map((item) => (
              <option key={item.patientNumber} value={item.patientNumber}>
                {patientLabel(item.patient)}, No. {item.patientNumber}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button disabled={disabled || !chosen} onClick={() => (chosen ? onOpen(chosen.patientNumber) : undefined)}>
        Open re-check
      </Button>
    </div>
  );
}
