'use client';

import { PRIVACY_CAPTURE } from '@triagecam/contracts';
import { useState } from 'react';

import { PrivacyNote, ProvenanceTag, Switch } from '@/components/ds';
import { Panel } from '@/components/ui/Panel';
import { liveStreamUrl } from '@/lib/api';

export interface LiveViewPanelProps {
  deviceId: string;
  deviceLabel: string;
  /** The phone has posted a preview frame in the last 5 seconds. */
  deviceLive: boolean;
}

type ViewState = 'off' | 'connecting' | 'live' | 'lost';

const MESSAGES: Record<Exclude<ViewState, 'live'>, { title: string; text: string }> = {
  off: { title: 'Live view is off', text: 'Turn it on to see the camera preview from this phone. Nothing is recorded.' },
  connecting: {
    title: 'Waiting for the phone',
    text: 'No preview frame yet. Live view also has to be turned on in the camera app on the phone.',
  },
  lost: {
    title: 'Live view lost',
    text: 'The phone has sent no frame for more than 5 seconds, so the last picture was removed. It returns by itself when frames arrive again.',
  },
};

/**
 * The operator-enabled preview from a camera phone. The picture is relayed in memory and never
 * stored, and a frame that is no longer live is taken off the screen instead of left standing.
 */
export function LiveViewPanel({ deviceId, deviceLabel, deviceLive }: LiveViewPanelProps) {
  const [wanted, setWanted] = useState(false);
  const [seenLive, setSeenLive] = useState(false);
  if (wanted && deviceLive && !seenLive) setSeenLive(true);

  const state: ViewState = !wanted ? 'off' : deviceLive ? 'live' : seenLive ? 'lost' : 'connecting';

  return (
    <Panel heading="Live view" aside={state === 'live' ? <ProvenanceTag kind="live">Live, not stored</ProvenanceTag> : null}>
      <div className="flex flex-col gap-3">
        <Switch
          label="Show live view"
          hint={`Preview from ${deviceLabel}`}
          checked={wanted}
          onChange={(next) => {
            setWanted(next);
            if (!next) setSeenLive(false);
          }}
        />
        {state === 'live' ? (
          // The stream is multipart JPEG from this server; next/image cannot show it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={liveStreamUrl(deviceId)}
            alt={`Live camera preview from ${deviceLabel}`}
            className="aspect-[4/3] w-full rounded-md bg-surface-sunken object-contain"
          />
        ) : (
          <div
            role="status"
            className="flex aspect-[4/3] w-full flex-col justify-center gap-1 rounded-md border border-dashed border-line-strong bg-surface-sunken p-4"
          >
            <p className="type-subheading">{MESSAGES[state].title}</p>
            <p className="type-caption text-ink-muted">{MESSAGES[state].text}</p>
          </div>
        )}
        <PrivacyNote icon="video">{PRIVACY_CAPTURE}</PrivacyNote>
      </div>
    </Panel>
  );
}
