'use client';

import {
  FROM_LIVE_READINGS,
  FROM_LIVE_READINGS_DETAIL,
  isLowConfidence,
  LOWER_CONFIDENCE,
  LOWER_CONFIDENCE_DETAIL,
  type PatientRef,
  type Sitting,
  type StoredReading,
  type SummaryValue,
} from '@triagecam/contracts';
import { useMemo } from 'react';

import { LiveTrace, PatientIdentity, QualityMeter, Readout, SittingChart, type IconName, type ReadoutState } from '@/components/ds';
import { Section } from '@/components/ui/Panel';
import { clockTime, rate, seconds } from '@/lib/format';
import { provenanceOf } from '@/lib/mapping';

import { coverageIsShown, liveReadout, noSummaryReason } from './live-readout';

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
  /** How old a held value is: "8 s ago". */
  heldAge?: string;
  reason?: string;
  coverage: number;
}

function summaryContent(value: SummaryValue, endedAt: string, noValueReason: string, lowConfidence = false, fromLive = false): ReadoutContent {
  if (value.value == null) return { state: 'none', reason: noValueReason, coverage: value.coverage };
  // A lower-confidence rate is not the median of anything much, and a check-in value taken
  // from the readings shown live is not the record's median: say what each is instead.
  const age = fromLive ? FROM_LIVE_READINGS_DETAIL : lowConfidence ? LOWER_CONFIDENCE_DETAIL : `Median of the sitting that ended at ${clockTime(endedAt)}`;
  return { state: 'valid', value: rate(value.value), age, coverage: value.coverage };
}

interface VitalProps {
  label: string;
  icon: IconName;
  unit: string;
  kind: 'pulse' | 'breath';
  content: ReadoutContent;
  tag: ReturnType<typeof provenanceOf>;
  /** The sitting is running: the numerals take the accent and the trace draws at the reading's rate. */
  live: boolean;
  /** Qualifies the value itself: "Lower confidence". */
  qualifier?: string;
}

function Vital({ label, icon, unit, kind, content, tag, live, qualifier }: VitalProps) {
  const reading = live && content.state === 'valid' && content.value !== undefined;
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <Readout
        size="lg"
        label={label}
        icon={icon}
        unit={unit}
        value={content.value}
        state={content.state}
        age={content.age}
        reason={content.reason}
        heldAge={content.heldAge}
        tag={tag.kind}
        tagLabel={tag.label}
        qualifier={qualifier}
        live={live}
      >
        {live ? <LiveTrace kind={kind} rate={reading ? Number(content.value) : null} className="mt-3" /> : null}
      </Readout>
      {/* Kept in the layout while hidden, so the box does not grow when the first second is recorded. */}
      <div className={coverageIsShown(live, content.coverage) ? undefined : 'invisible'}>
        <QualityMeter value={content.coverage} hint="Share of seconds recorded" />
      </div>
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
  const heartFromLive = sitting.summary?.heartRateFromLive === true;
  const breathingFromLive = sitting.summary?.breathingRateFromLive === true;
  const heart =
    sitting.summary && sitting.endedAt
      ? summaryContent(sitting.summary.heartRate, sitting.endedAt, noSummaryReason(readings, (r) => r.heartRate, sitting.kind), lowConfidence, heartFromLive)
      : liveReadout(readings, (r) => r.heartRate, serverNow);
  const breathing =
    sitting.summary && sitting.endedAt
      ? summaryContent(sitting.summary.breathingRate, sitting.endedAt, noSummaryReason(readings, (r) => r.breathingRate, sitting.kind), false, breathingFromLive)
      : liveReadout(readings, (r) => r.breathingRate, serverNow);

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
    <>
      <Section>
        {/* The countdown and the way to the record are beside the picture and the form; this says whose readings these are. */}
        <div className="mb-4">
          <PatientIdentity
            patient={patient}
            size="md"
            detail={
              <span className="tabular-nums">
                {sitting.kind === 'check_in' ? 'check-in' : 're-check'}, {running ? 'measuring now' : `${seconds(elapsed)}, finished at ${clockTime(endMs)}`}
              </span>
            }
          />
        </div>

        {/* The two readings share one well, ruled down the middle: an instrument, not two cards. */}
        <div className="grid rounded-lg border border-line bg-surface-0 max-sm:divide-y sm:grid-cols-2 sm:divide-x divide-line">
          <Vital label="Heart rate" icon="pulse" unit="bpm" kind="pulse" content={heart} tag={tag} live={running} qualifier={heartFromLive ? FROM_LIVE_READINGS : lowConfidence ? LOWER_CONFIDENCE : undefined} />
          <Vital label="Breathing rate" icon="breath" unit="breaths per min" kind="breath" content={breathing} tag={tag} live={running} qualifier={breathingFromLive ? FROM_LIVE_READINGS : undefined} />
        </div>
        {running ? <p className="mt-2 type-caption text-ink-faint">Each trace is drawn at the rate being read, not from the camera&apos;s raw signal.</p> : null}

        {summary ? (
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
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
      </Section>

      <Section>
        <SittingChart values={heartRates} minSeconds={60} ended={summary != null} />
      </Section>
    </>
  );
}
