'use client';

import type { Estimate, Sitting, StoredReading, SummaryValue } from '@triagecam/contracts';
import Link from 'next/link';
import { useMemo } from 'react';

import { QualityMeter, Readout, ReferenceChart, TicketNumber, buttonClass, type IconName, type ReadoutState } from '@/components/ds';
import { Panel } from '@/components/ui/Panel';
import { clockTime, reasonText, secondsAgo } from '@/lib/format';
import { provenanceOf } from '@/lib/mapping';

/** No reading from the phone for this long: the last value is struck through as stale. */
const STALE_AFTER_MS = 3000;
/** And for this long: the value is taken off the screen. */
const BLANK_AFTER_MS = 10_000;

export interface ReferencePoint {
  /** Server clock, in ms. */
  t: number;
  /** bpm. */
  heartRate: number;
}

export interface SittingViewProps {
  sitting: Sitting;
  readings: StoredReading[];
  reference: ReferencePoint[];
  /** The server clock now, in ms. */
  serverNow: number;
}

interface ReadoutContent {
  state: ReadoutState;
  value?: number;
  age?: string;
  reason?: string;
  coverage: number;
}

function lastValid(readings: StoredReading[], pick: (reading: StoredReading) => Estimate): number | null {
  for (let index = readings.length - 1; index >= 0; index--) {
    const reading = readings[index];
    const value = reading ? pick(reading).value : null;
    if (value != null) return value;
  }
  return null;
}

function liveContent(readings: StoredReading[], pick: (reading: StoredReading) => Estimate, serverNow: number): ReadoutContent {
  const latest = readings.at(-1);
  if (!latest) return { state: 'settling', reason: 'Waiting for the first reading from the phone', coverage: 0 };

  const estimate = pick(latest);
  const at = new Date(latest.t).getTime();
  const silence = serverNow - at;
  if (silence > BLANK_AFTER_MS) {
    return { state: 'none', reason: `No readings from the phone since ${secondsAgo(at, serverNow)}`, coverage: estimate.coverage };
  }
  if (silence > STALE_AFTER_MS) {
    const previous = lastValid(readings, pick);
    return previous == null
      ? { state: 'none', reason: `No readings from the phone since ${secondsAgo(at, serverNow)}`, coverage: estimate.coverage }
      : { state: 'stale', value: Math.round(previous), age: `last reading ${secondsAgo(at, serverNow)}`, coverage: estimate.coverage };
  }
  if (estimate.state === 'valid' && estimate.value != null) {
    return { state: 'valid', value: Math.round(estimate.value), age: secondsAgo(at, serverNow), coverage: estimate.coverage };
  }
  // The engine's own stale state arrives without a value, so there is nothing to strike through.
  return {
    state: estimate.state === 'settling' ? 'settling' : 'none',
    reason: reasonText(estimate.reason),
    coverage: estimate.coverage,
  };
}

function summaryContent(value: SummaryValue, endedAt: string): ReadoutContent {
  return value.value == null
    ? { state: 'none', reason: 'No reading was accepted in this sitting', coverage: value.coverage }
    : { state: 'valid', value: Math.round(value.value), age: `Median of the sitting that ended at ${clockTime(endedAt)}`, coverage: value.coverage };
}

function Vital({ label, icon, unit, content, tag }: { label: string; icon: IconName; unit: string; content: ReadoutContent; tag: ReturnType<typeof provenanceOf> }) {
  return (
    <div className="flex flex-col gap-3">
      <Readout
        size="xl"
        label={label}
        icon={icon}
        unit={unit}
        value={content.value}
        state={content.state}
        age={content.age}
        reason={content.reason}
        tag={tag.kind}
        tagLabel={tag.label}
      />
      <QualityMeter value={content.coverage} label="Coverage, share of seconds with a reading" />
    </div>
  );
}

/** Second-by-second series for the chart: index is whole seconds since the sitting started. */
function series(points: Array<{ t: number; value: number | null }>, startedAt: number, length: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length }, () => null);
  for (const point of points) {
    const second = Math.round((point.t - startedAt) / 1000);
    if (second >= 0 && second < length && point.value != null) out[second] = Math.round(point.value);
  }
  return out;
}

/** One sitting as it runs and after it ends: ticket, the two vitals, and estimate against reference. */
export function SittingView({ sitting, readings, reference, serverNow }: SittingViewProps) {
  const startedAt = new Date(sitting.startedAt).getTime();
  const running = sitting.endedAt === null;
  const endMs = sitting.endedAt ? new Date(sitting.endedAt).getTime() : serverNow;
  const elapsed = Math.max(0, Math.round((endMs - startedAt) / 1000));
  const provenance = provenanceOf(sitting.source);
  const tag = running && sitting.source === 'camera' ? { kind: 'live' as const, label: 'Live' } : provenance;

  const heart = sitting.summary && sitting.endedAt ? summaryContent(sitting.summary.heartRate, sitting.endedAt) : liveContent(readings, (r) => r.heartRate, serverNow);
  const breathing =
    sitting.summary && sitting.endedAt ? summaryContent(sitting.summary.breathingRate, sitting.endedAt) : liveContent(readings, (r) => r.breathingRate, serverNow);

  const chart = useMemo(() => {
    const length = Math.min(900, elapsed + 1);
    return {
      estimate: series(
        readings.map((reading) => ({ t: new Date(reading.t).getTime(), value: reading.heartRate.value })),
        startedAt,
        length,
      ),
      reference: series(
        reference.map((point) => ({ t: point.t, value: point.heartRate })),
        startedAt,
        length,
      ),
    };
  }, [readings, reference, startedAt, elapsed]);

  const summary = sitting.summary;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <TicketNumber number={sitting.ticketNumber} size="lg" />
            <p className="text-ink-muted">
              {sitting.kind === 'check_in' ? 'Check-in sitting' : 'Re-check sitting'},{' '}
              <span className="tabular-nums">
                {running ? `running for ${elapsed} s` : `${elapsed} s, finished at ${clockTime(endMs)}`}
              </span>
            </p>
          </div>
          <Link href={`/tickets/${sitting.ticketNumber}`} className={buttonClass('secondary')}>
            Open ticket
          </Link>
        </div>

        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Vital label="Heart rate" icon="pulse" unit="bpm" content={heart} tag={tag} />
          <Vital label="Breathing rate" icon="breath" unit="breaths per min" content={breathing} tag={tag} />
        </div>

        {summary ? (
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 lg:grid-cols-4">
            <Readout size="md" label="RMSSD" tag="experimental" unit="ms" value={summary.rmssd.value == null ? undefined : Math.round(summary.rmssd.value)} state={summary.rmssd.value == null ? 'none' : 'valid'} reason="Too few clean beat intervals" />
            <Readout size="md" label="SDNN" tag="experimental" unit="ms" value={summary.sdnn.value == null ? undefined : Math.round(summary.sdnn.value)} state={summary.sdnn.value == null ? 'none' : 'valid'} reason="Too few clean beat intervals" />
            <Readout
              size="md"
              label="Time to first reading"
              unit="s"
              value={summary.timeToFirstReadingSeconds == null ? undefined : Math.round(summary.timeToFirstReadingSeconds)}
              state={summary.timeToFirstReadingSeconds == null ? 'none' : 'valid'}
              reason="No heart rate was accepted"
            />
            <Readout size="md" label="Longest dropout" unit="s" value={Math.round(summary.longestDropoutSeconds)} />
          </div>
        ) : null}
      </Panel>

      <ReferenceChart estimate={chart.estimate} reference={chart.reference} minSeconds={60} />
    </div>
  );
}
