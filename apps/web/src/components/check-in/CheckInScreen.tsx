'use client';

import { PRIVACY_CAPTURE, type Device, type Patient, type PatientRef } from '@triagecam/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { PatientIdentity, PrivacyNote, ProvenanceTag, buttonClass, intakeSummary } from '@/components/ds';
import { IntakeForm } from '@/components/patients/IntakeForm';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, Panel } from '@/components/ui/Panel';
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
    <Panel heading="Camera phone">
      <div role="radiogroup" aria-label="Camera phone" className="flex flex-col gap-2">
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
                'flex w-full cursor-pointer items-center gap-3 rounded-md text-left transition-colors duration-[120ms] ease-out',
                on ? 'border-2 border-signal bg-signal-soft px-[11px] py-[7px]' : 'border border-line-strong px-3 py-2 hover:bg-surface-sunken',
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{device.label}</span>
                <span className="type-caption text-ink-muted">
                  {device.liveAt ? 'Camera on' : isOnline(device) ? 'Online, camera idle' : `Offline, last seen ${minutesAgo(seenMinutes)}`}
                </span>
              </span>
              <span aria-hidden className={cx('size-[20px] flex-none rounded-full', on ? 'border-[6px] border-signal' : 'border-2 border-line-strong')} />
            </button>
          );
        })}
      </div>
      {devices.error ? (
        <p role="alert" className="mt-3 type-caption font-medium text-flag">
          The list could not be refreshed: {devices.error.message}
        </p>
      ) : null}
    </Panel>
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
          Open the Triage Cam app on the phone, sign in and choose the camera role. The phone appears here within {DEVICE_REFRESH_MS / 1000} seconds.
        </StateMessage>
      ) : null}

      {cameras.length > 0 && selected ? (
        <Station key={selected.id} device={selected} serverOffsetMs={serverOffsetMs} serverNow={serverNow} picker={picker} />
      ) : null}
      {cameras.length > 0 && !selected ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <StateMessage kind="empty" title="No camera phone is online">
            Choose a phone from the list to follow it anyway, or open the app on the phone. A phone is online when the server heard from it in the last 2 minutes.
          </StateMessage>
          {picker}
        </div>
      ) : null}
    </>
  );
}

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

  // Two columns on a wide screen. Below that the columns dissolve into one run, ordered so the
  // picture comes first and the form right under it; the device list goes last.
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-5 max-xl:contents">
        <Panel
          className="max-xl:order-1"
          heading="Camera"
          aside={
            cameraLive ? (
              <span className="flex items-center gap-3">
                {feed ? (
                  <span className="font-mono text-[13px] text-ink-muted tabular-nums">
                    {rate(feed.fps)} fps{feed.delayMs === null ? '' : ` · ${milliseconds(feed.delayMs)}`}
                  </span>
                ) : null}
                <ProvenanceTag kind="live">Live</ProvenanceTag>
              </span>
            ) : null
          }
        >
          <div className="flex flex-col gap-3">
            {cameraLive ? (
              <LiveFeed
                deviceId={device.id}
                deviceLabel={device.label}
                serverOffsetMs={serverOffsetMs}
                onStats={setFeed}
                className="aspect-auto h-[clamp(240px,44vh,480px)]"
              />
            ) : (
              <div role="status" className="flex h-[clamp(160px,24vh,240px)] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong bg-surface-sunken p-4 text-center">
                <p className="type-subheading">The camera on {device.label} is idle</p>
                <p className="max-w-[420px] type-caption text-ink-muted">Start a check-in or a re-check on the phone. Its picture appears here the moment the camera starts.</p>
              </div>
            )}
            <PrivacyNote icon="video">{PRIVACY_CAPTURE}</PrivacyNote>
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-5 empty:hidden max-xl:order-3">
          {followed.phase === 'searching' ? <StateMessage kind="loading" title={`Looking for a sitting on ${device.label}`} /> : null}
          {followed.error ? (
            <StateMessage kind="error" title="The sitting could not be loaded" onRetry={followed.retry}>
              {followed.error.message}
            </StateMessage>
          ) : null}
          {sitting && patientRef ? <SittingView sitting={sitting} patient={patientRef} readings={followed.readings} serverNow={serverNow} /> : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5 max-xl:contents">
        <Panel
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
            <div className="flex flex-col gap-1">
              <p className="type-subheading">Waiting for the next patient</p>
              <p className="text-ink-muted">When a check-in starts on {device.label}, this form opens for their name, the reason for the visit and the rest of intake. Fill it in while the camera measures.</p>
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
            <StateMessage kind="error" title="The patient could not be loaded" onRetry={record.reload}>
              {record.error.message}
            </StateMessage>
          ) : (
            <StateMessage kind="loading" title="Opening the intake form" />
          )}
        </Panel>
        <div className="min-w-0 max-xl:order-4">{picker}</div>
      </div>
    </div>
  );
}
