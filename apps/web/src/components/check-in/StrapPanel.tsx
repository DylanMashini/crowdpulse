'use client';

import { useEffect, useRef, useState } from 'react';

import { Button, Readout } from '@/components/ds';
import { Panel } from '@/components/ui/Panel';
import { useNow } from '@/lib/clock';
import { secondsAgo, signed } from '@/lib/format';
import { connectStrap, strapSupported, type StrapConnection, type StrapSample } from '@/lib/heart-rate-strap';

type Link =
  | { status: 'idle'; note: string | null }
  | { status: 'connecting' }
  | { status: 'connected'; name: string }
  | { status: 'lost'; name: string };

export interface PostingState {
  /** Reference readings the server has accepted for the sitting on screen. */
  accepted: number;
  /** The last failed post. Failed readings are kept and sent again. */
  error: string | null;
}

export interface StrapPanelProps {
  onSample: (sample: StrapSample) => void;
  latest: StrapSample | null;
  posting: PostingState;
  /** Server clock minus this browser's clock, in ms. Null until it has been measured. */
  serverOffsetMs: number | null;
  sittingRunning: boolean;
}

/** After this long without a notification the last strap value is no longer shown as current. */
const STRAP_STALE_MS = 5000;

/** Connects the reference chest strap over Web Bluetooth and shows what it is sending. */
export function StrapPanel({ onSample, latest, posting, serverOffsetMs, sittingRunning }: StrapPanelProps) {
  const [link, setLink] = useState<Link>({ status: 'idle', note: null });
  const connection = useRef<StrapConnection | null>(null);
  const sampleHandler = useRef(onSample);
  const now = useNow();

  useEffect(() => {
    sampleHandler.current = onSample;
  });
  useEffect(() => () => connection.current?.disconnect(), []);

  if (!strapSupported()) {
    return (
      <Panel heading="Chest strap">
        <p className="type-subheading">Web Bluetooth is not available in this browser</p>
        <p className="mt-1 text-ink-muted">
          Open the dashboard in Chrome on this laptop, at a localhost or https address, to read the reference strap. Camera readings are not affected.
        </p>
      </Panel>
    );
  }

  const connect = async () => {
    setLink({ status: 'connecting' });
    try {
      const opened = await connectStrap(
        (sample) => sampleHandler.current(sample),
        () => setLink((current) => (current.status === 'connected' ? { status: 'lost', name: current.name } : current)),
      );
      connection.current = opened;
      setLink({ status: 'connected', name: opened.name });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'NotFoundError';
      setLink({
        status: 'idle',
        note: cancelled
          ? 'No strap was chosen. Wet the strap contacts, put it on, then try again.'
          : `The strap did not connect: ${error instanceof Error ? error.message : 'unknown Bluetooth error'}. Check that it is worn and not paired to another device.`,
      });
    }
  };

  const disconnect = () => {
    connection.current?.disconnect();
    connection.current = null;
    setLink({ status: 'idle', note: null });
  };

  const fresh = latest !== null && now - latest.receivedAt < STRAP_STALE_MS;

  return (
    <Panel heading="Chest strap">
      {link.status === 'idle' ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink-muted">
            The reference for heart rate. Uses the standard Bluetooth heart rate service, including beat-to-beat intervals when the strap sends them.
          </p>
          {link.note ? (
            <p role="alert" className="font-medium">
              {link.note}
            </p>
          ) : null}
          <Button onClick={connect}>Connect chest strap</Button>
        </div>
      ) : null}

      {link.status === 'connecting' ? (
        <p role="status" className="text-ink-muted">
          Choose the strap in the Chrome dialog. Connecting can take a few seconds.
        </p>
      ) : null}

      {link.status === 'lost' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="font-medium">
            Connection to {link.name} lost. Reference readings have stopped.
          </p>
          <Button onClick={connect}>Reconnect</Button>
        </div>
      ) : null}

      {link.status === 'connected' ? (
        <div className="flex flex-col items-start gap-3">
          <Readout
            label={link.name}
            icon="pulse"
            tag="reference"
            size="lg"
            unit="bpm"
            value={fresh && latest?.heartRate != null ? latest.heartRate : undefined}
            state={fresh && latest?.heartRate != null ? 'valid' : 'none'}
            age={latest ? secondsAgo(latest.receivedAt, now) : undefined}
            reason={
              latest === null
                ? 'Waiting for the first value from the strap'
                : fresh
                  ? 'The strap reports no skin contact'
                  : `Nothing from the strap since ${secondsAgo(latest.receivedAt, now)}`
            }
          />
          <dl className="grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-1 type-caption">
            <dt className="text-ink-muted">Beat intervals in the last value</dt>
            <dd className="text-right tabular-nums">{latest ? (latest.rrIntervalsMs.length ? `${latest.rrIntervalsMs.length} sent` : 'None sent') : 'Waiting'}</dd>
            <dt className="text-ink-muted">Laptop clock against server</dt>
            <dd className="text-right tabular-nums">{serverOffsetMs === null ? 'Not measured yet' : `${signed(serverOffsetMs, 0)} ms`}</dd>
            <dt className="text-ink-muted">Saved to this sitting</dt>
            <dd className="text-right tabular-nums">{sittingRunning || posting.accepted ? `${posting.accepted} readings` : 'No sitting running'}</dd>
          </dl>
          {posting.error ? (
            <p role="alert" className="type-caption font-medium text-flag">
              Reference readings are not reaching the server: {posting.error} They are kept and sent again.
            </p>
          ) : null}
          <Button variant="quiet" onClick={disconnect} className="-ml-2 px-2">
            Disconnect
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
