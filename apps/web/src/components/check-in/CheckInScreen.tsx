'use client';

import { PRIVACY_CAPTURE, type Device, type Patient, type PatientRef } from '@triagecam/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { PatientIdentity, PrivacyNote, ProvenanceTag, buttonClass, intakeSummary } from '@/components/ds';
import { IntakeForm } from '@/components/patients/IntakeForm';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, Section } from '@/components/ui/Panel';
import { StateMessage } from '@/components/ui/StateMessage';
import { api } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { cx } from '@/lib/cx';
import { milliseconds, minutesAgo, rate } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

import { LiveFeed, type FeedStats } from './LiveFeed';
import { SittingView } from './SittingView';
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
  useLiveEvents((event) => {
    if (event.type === 'live_changed' || event.type === 'reconnected' || event.type === 'sitting_started') reloadDevices();
  });

  const cameras = useMemo(() => devices.data?.devices.filter((device) => device.role === 'camera') ?? [], [devices.data]);
  const isOnline = (device: Device) => device.liveAt !== null || serverNow - new Date(device.lastSeenAt).getTime() < ONLINE_WITHIN_MS;
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = cameras.find((device) => device.id === chosen) ?? cameras.find((device) => device.liveAt !== null) ?? cameras.find(isOnline) ?? null;

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
                  {device.liveAt ? 'Camera on' : isOnline(device) ? 'Online, camera idle' : `Offline, last seen ${minutesAgo(seenMinutes)}`}
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
      <PageHeader title="Check-in" description="Start a check-in on the camera phone. The picture, the readings and the intake form appear here as it runs.">
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
        <Station key={selected.id} device={selected} serverOffsetMs={serverOffsetMs} serverNow={serverNow} picker={picker} />
      ) : null}
      {cameras.length > 0 && !selected ? (
        <div className={columns}>
          <StateMessage kind="empty" title="No camera phone is online">
            Choose a phone from the list to follow it anyway, or open the app on the phone. A phone is online when the server heard from it in the last 2 minutes.
          </StateMessage>
          <div className={side}>{picker}</div>
        </div>
      ) : null}
    </>
  );
}

// Two columns ruled apart on a wide screen. Below that the columns dissolve into one run, ordered
// so the picture comes first and the form right under it; the device list goes last.
const columns = 'grid flex-1 content-start xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:content-stretch';
const side = 'flex min-w-0 flex-col border-line max-xl:contents xl:border-l';

interface StationProps {
  device: Device;
  serverOffsetMs: number | null;
  serverNow: number;
  picker: ReactNode;
}

/** Everything that belongs to one camera phone: its picture, its sitting, and the patient in front of it. */
function Station({ device, serverOffsetMs, serverNow, picker }: StationProps) {
  const followed = useFollowedSitting(device.id);
  const sitting = followed.sitting;
  const running = sitting !== null && sitting.endedAt === null;
  const patientNumber = sitting?.patientNumber ?? null;

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
  const cameraLive = device.liveAt !== null;

  const newPatient = sitting?.kind === 'check_in';

  return (
    <div className={columns}>
      <div className="flex min-w-0 flex-col max-xl:contents">
        <Section className="max-xl:order-1">
          <div className="flex flex-col gap-3">
            {cameraLive ? (
              <LiveFeed
                deviceId={device.id}
                deviceLabel={device.label}
                serverOffsetMs={serverOffsetMs}
                onStats={setFeed}
                className="aspect-auto h-[clamp(240px,44vh,480px)]"
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
            ) : (
              <div role="status" className="flex h-[clamp(160px,24vh,240px)] w-full flex-col items-center justify-center gap-1 rounded-lg border border-line bg-surface-0 p-4 text-center">
                <p className="type-subheading text-ink">The camera on {device.label} is idle</p>
                <p className="max-w-[420px] type-dense text-ink-muted">Start a check-in or a re-check on the phone. Its picture appears here the moment the camera starts.</p>
              </div>
            )}
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
          {sitting && patientRef ? <SittingView sitting={sitting} patient={patientRef} readings={followed.readings} serverNow={serverNow} /> : null}
        </div>
      </div>

      <div className={side}>
        <Section
          className="max-xl:order-2"
          heading={sitting ? (newPatient ? 'New patient' : 'Patient') : 'Intake'}
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
              <p className="type-dense text-ink-muted">When a check-in starts on {device.label}, this form opens for their name, the reason for the visit and the rest of intake. Fill it in while the camera measures.</p>
            </div>
          ) : patient ? (
            <div className="flex flex-col gap-4">
              {newPatient ? null : (
                <PatientIdentity patient={patientRef} size="md" detail={intakeSummary(null, patient.reasonForVisit)} />
              )}
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
    </div>
  );
}
