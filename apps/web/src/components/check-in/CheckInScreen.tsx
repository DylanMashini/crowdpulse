'use client';

import type { Device, ReferenceReading } from '@triagecam/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { cx } from '@/lib/cx';
import { minutesAgo } from '@/lib/format';
import type { StrapSample } from '@/lib/heart-rate-strap';
import { useResource } from '@/lib/use-resource';

import { LiveViewPanel } from './LiveViewPanel';
import { SittingView, type ReferencePoint } from './SittingView';
import { StrapPanel, type PostingState } from './StrapPanel';
import { useFollowedSitting } from './use-followed-sitting';

/** A phone counts as online when the server heard from it within this long. */
const ONLINE_WITHIN_MS = 2 * 60_000;
const DEVICE_REFRESH_MS = 15_000;
/** Strap samples kept in the browser for the chart: 15 minutes at one per second. */
const STRAP_HISTORY = 900;
const POST_BATCH = 120;

interface QueuedReference {
  sittingId: string;
  reading: ReferenceReading;
}

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
  const selected = cameras.find((device) => device.id === chosen) ?? cameras.find(isOnline) ?? null;

  return (
    <>
      <PageHeader title="Check-in" description="Follows the sitting on a camera phone as it runs, beside the reference chest strap">
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

      {cameras.length > 0 ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          {selected ? (
            <Station key={selected.id} device={selected} serverOffsetMs={serverOffsetMs} serverNow={serverNow} />
          ) : (
            <StateMessage kind="empty" title="No camera phone is online">
              Choose a phone from the list to follow it anyway, or open the app on the phone. A phone is online when the server heard from it in the last 2 minutes.
            </StateMessage>
          )}
          <Panel heading="Camera phone" className="max-xl:order-first xl:col-start-2 xl:row-start-1">
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
                          {isOnline(device) ? 'Online' : `Offline, last seen ${minutesAgo(seenMinutes)}`}
                          {device.liveAt ? ', live view on' : ''}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={cx('size-[20px] flex-none rounded-full', on ? 'border-[6px] border-signal' : 'border-2 border-line-strong')}
                      />
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
        </div>
      ) : null}
    </>
  );
}

/** Everything that belongs to one camera phone: its sitting, its live view and the strap readings posted against it. */
function Station({ device, serverOffsetMs, serverNow }: { device: Device; serverOffsetMs: number | null; serverNow: number }) {
  const followed = useFollowedSitting(device.id);
  const sitting = followed.sitting;
  const running = sitting !== null && sitting.endedAt === null;

  const [samples, setSamples] = useState<StrapSample[]>([]);
  const [posting, setPosting] = useState<PostingState>({ accepted: 0, error: null });
  const [postedFor, setPostedFor] = useState<string | null>(null);
  const queue = useRef<QueuedReference[]>([]);
  const target = useRef<{ sittingId: string | null; offsetMs: number }>({ sittingId: null, offsetMs: 0 });

  useEffect(() => {
    target.current = { sittingId: running && sitting ? sitting.id : null, offsetMs: serverOffsetMs ?? 0 };
  });

  // The count on screen belongs to one sitting. A new sitting starts it again.
  const sittingId = sitting?.id ?? null;
  if (postedFor !== sittingId) {
    setPostedFor(sittingId);
    setPosting({ accepted: 0, error: null });
  }

  const onSample = useCallback((sample: StrapSample) => {
    setSamples((previous) => [...previous.slice(1 - STRAP_HISTORY), sample]);
    const { sittingId: id, offsetMs } = target.current;
    if (!id) return;
    queue.current.push({
      sittingId: id,
      reading: {
        t: new Date(sample.receivedAt + offsetMs).toISOString(),
        heartRate: sample.heartRate,
        rrIntervalsMs: sample.rrIntervalsMs.slice(0, 32),
        source: 'chest_strap',
      },
    });
  }, []);

  useEffect(() => {
    let sending = false;
    const timer = setInterval(() => {
      const first = queue.current[0];
      if (sending || !first) return;
      const batch = queue.current.filter((item) => item.sittingId === first.sittingId).slice(0, POST_BATCH);
      queue.current = queue.current.filter((item) => !batch.includes(item));
      sending = true;
      api
        .postReference(first.sittingId, batch.map((item) => item.reading))
        .then(
          ({ accepted }) => setPosting((previous) => ({ accepted: previous.accepted + accepted, error: null })),
          (error: unknown) => {
            // Keep them: posting a reading twice is safe to retry, losing one is not.
            queue.current = [...batch, ...queue.current];
            setPosting((previous) => ({ ...previous, error: errorMessage(error) }));
          },
        )
        .finally(() => {
          sending = false;
        });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const reference = useMemo<ReferencePoint[]>(() => {
    const stored = followed.storedReference.flatMap((reading) =>
      reading.heartRate == null ? [] : [{ t: new Date(reading.t).getTime(), heartRate: reading.heartRate }],
    );
    const local = samples.flatMap((sample) =>
      sample.heartRate == null ? [] : [{ t: sample.receivedAt + (serverOffsetMs ?? 0), heartRate: sample.heartRate }],
    );
    return [...stored, ...local];
  }, [followed.storedReference, samples, serverOffsetMs]);

  return (
    <>
      <div className="min-w-0 xl:col-start-1 xl:row-span-3 xl:row-start-1">
        {followed.phase === 'searching' ? <StateMessage kind="loading" title={`Looking for a sitting on ${device.label}`} /> : null}
        {followed.error ? (
          <StateMessage kind="error" title="The sitting could not be loaded" onRetry={followed.retry} className="mb-5">
            {followed.error.message}
          </StateMessage>
        ) : null}
        {followed.phase === 'idle' && !followed.error ? (
          <StateMessage kind="empty" title={`No sitting is running on ${device.label}`}>
            Start a check-in or a re-check on the phone. The ticket number and the readings appear here as soon as the sitting starts.
          </StateMessage>
        ) : null}
        {sitting ? <SittingView sitting={sitting} readings={followed.readings} reference={reference} serverNow={serverNow} /> : null}
      </div>
      <div className="xl:col-start-2">
        <LiveViewPanel deviceId={device.id} deviceLabel={device.label} deviceLive={device.liveAt !== null} />
      </div>
      <div className="xl:col-start-2">
        <StrapPanel onSample={onSample} latest={samples.at(-1) ?? null} posting={posting} serverOffsetMs={serverOffsetMs} sittingRunning={running} />
      </div>
    </>
  );
}
