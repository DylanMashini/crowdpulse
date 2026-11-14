'use client';

import {
  EXPOSURE_STUCK,
  EXPOSURE_STUCK_AFTER_SECONDS,
  isLowConfidence,
  LOWER_CONFIDENCE,
  LOWER_CONFIDENCE_DETAIL,
  type Estimate,
  type PatientRef,
  type Sitting,
  type StoredReading,
  type SummaryValue,
} from '@triagecam/contracts';
import Link from 'next/link';
import { useMemo } from 'react';

import { PatientIdentity, QualityMeter, Readout, SittingChart, buttonClass, type IconName, type ReadoutState } from '@/components/ds';
import { Panel } from '@/components/ui/Panel';
import { clockTime, exposureIsStuck, rate, reasonText, seconds, secondsAgo } from '@/lib/format';
import { provenanceOf } from '@/lib/mapping';

/** No reading from the phone for this long: the last value is struck through as stale. */
const STALE_AFTER_MS = 3000;
/** And for this long: the value is taken off the screen. */
const BLANK_AFTER_MS = 10_000;

export interface SittingViewProps {
  sitting: Sitting;
  /** Who is sitting in front of the camera. */
  patient: PatientRef;
  readings: StoredReading[];
  /** The server clock now, in ms. */
  serverNow: number;
}

interface ReadoutContent {
  state: ReadoutState;
  /** Already rounded for the screen. */
  value?: string;
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
      : { state: 'stale', value: rate(previous), age: `last reading ${secondsAgo(at, serverNow)}`, coverage: estimate.coverage };
  }
  if (estimate.state === 'valid' && estimate.value != null) {
    return { state: 'valid', value: rate(estimate.value), age: secondsAgo(at, serverNow), coverage: estimate.coverage };
  }
  // The engine's own stale state arrives without a value, so there is nothing to strike through.
  // Exposure that has not settled for seconds on end will not: say what to do about it.
  const stuck = exposureIsStuck(readings.slice(-EXPOSURE_STUCK_AFTER_SECONDS).map((reading) => pick(reading).reason));
  return {
    state: estimate.state === 'settling' ? 'settling' : 'none',
    reason: stuck ? EXPOSURE_STUCK : reasonText(estimate.reason),
    coverage: estimate.coverage,
  };
}

function summaryContent(value: SummaryValue, endedAt: string, lowConfidence = false): ReadoutContent {
  if (value.value == null) return { state: 'none', reason: 'No reading was accepted in this sitting', coverage: value.coverage };
  // A lower-confidence rate is not the median of anything much: say what it is instead.
  const age = lowConfidence ? LOWER_CONFIDENCE_DETAIL : `Median of the sitting that ended at ${clockTime(endedAt)}`;
  return { state: 'valid', value: rate(value.value), age, coverage: value.coverage };
}

function Vital({ label, icon, unit, content, tag, qualifier }: { label: string; icon: IconName; unit: string; content: ReadoutContent; tag: ReturnType<typeof provenanceOf>; qualifier?: string }) {
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
        qualifier={qualifier}
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

/** One sitting as it runs and after it ends: who it is, the two vitals, and the heart rate second by second. */
export function SittingView({ sitting, patient, readings, serverNow }: SittingViewProps) {
  const startedAt = new Date(sitting.startedAt).getTime();
  const running = sitting.endedAt === null;
  const endMs = sitting.endedAt ? new Date(sitting.endedAt).getTime() : serverNow;
  const elapsed = Math.max(0, Math.round((endMs - startedAt) / 1000));
  const provenance = provenanceOf(sitting.source);
  const tag = running && sitting.source === 'camera' ? { kind: 'live' as const, label: 'Live' } : provenance;

  const lowConfidence = sitting.summary?.heartRate.value != null && isLowConfidence(sitting.summary.heartRateConfidence);
  const heart =
    sitting.summary && sitting.endedAt
      ? summaryContent(sitting.summary.heartRate, sitting.endedAt, lowConfidence)
      : liveContent(readings, (r) => r.heartRate, serverNow);
  const breathing =
    sitting.summary && sitting.endedAt ? summaryContent(sitting.summary.breathingRate, sitting.endedAt) : liveContent(readings, (r) => r.breathingRate, serverNow);

  const heartRates = useMemo(
    () =>
      series(
        readings.map((reading) => ({ t: new Date(reading.t).getTime(), value: reading.heartRate.value })),
        startedAt,
        Math.min(900, elapsed + 1),
      ),
    [readings, startedAt, elapsed],
  );

  const summary = sitting.summary;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <PatientIdentity
            patient={patient}
            size="md"
            detail={
              <span className="tabular-nums">
                {sitting.kind === 'check_in' ? 'Check-in' : 'Re-check'}, {running ? `running for ${seconds(elapsed)}` : `${seconds(elapsed)}, finished at ${clockTime(endMs)}`}
              </span>
            }
          />
          <Link href={`/patients/${sitting.patientNumber}`} className={buttonClass('secondary')}>
            Open record
          </Link>
        </div>

        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Vital label="Heart rate" icon="pulse" unit="bpm" content={heart} tag={tag} qualifier={lowConfidence ? LOWER_CONFIDENCE : undefined} />
          <Vital label="Breathing rate" icon="breath" unit="breaths per min" content={breathing} tag={tag} />
        </div>

        {summary ? (
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 lg:grid-cols-4">
            <Readout size="md" label="RMSSD" tag="experimental" unit="ms" value={summary.rmssd.value == null ? undefined : rate(summary.rmssd.value)} state={summary.rmssd.value == null ? 'none' : 'valid'} reason="Too few clean beat intervals" />
            <Readout size="md" label="SDNN" tag="experimental" unit="ms" value={summary.sdnn.value == null ? undefined : rate(summary.sdnn.value)} state={summary.sdnn.value == null ? 'none' : 'valid'} reason="Too few clean beat intervals" />
            <Readout
              size="md"
              label="Time to first reading"
              unit="s"
              value={summary.timeToFirstReadingSeconds == null ? undefined : rate(summary.timeToFirstReadingSeconds)}
              state={summary.timeToFirstReadingSeconds == null ? 'none' : 'valid'}
              reason="No live heart rate"
            />
            <Readout size="md" label="Longest dropout" unit="s" value={rate(summary.longestDropoutSeconds)} />
          </div>
        ) : null}
      </Panel>

      <SittingChart values={heartRates} minSeconds={60} ended={summary != null} />
    </div>
  );
}
