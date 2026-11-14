// The trend rules of docs/CONTRACTS.md section 6 (plan section 5). Everything here is a pure
// function of a patient's sittings, the settings row and the clock, so the server, the seed
// script and the tests all get the same answer.
import type { CaptureSource, FlagDetail, FlagRule, Score, Settings, Trend } from "@triagecam/contracts";

const MINUTE_MS = 60_000;

/** A running sitting older than this was abandoned by the phone and no longer counts as in progress. */
const IN_PROGRESS_LIMIT_MS = 10 * MINUTE_MS;

/** What the rules need to know about one sitting. */
export type SittingFacts = {
  id: string;
  source: CaptureSource;
  startedAt: Date;
  /** Null while the sitting runs. */
  endedAt: Date | null;
  /** The phone finished it and sent a summary. An abandoned sitting has none and is ignored. */
  finished: boolean;
  /** bpm from the summary; null is "No reading". */
  heartRate: number | null;
  /** Breaths per minute from the summary; null is "No reading". */
  breathingRate: number | null;
};

type FinishedSitting = SittingFacts & { endedAt: Date };

export type RuleStatus = {
  /** The opening condition holds. */
  met: boolean;
  /** The closing condition holds. A rule can be neither: one raised observation is not yet a flag. */
  cleared: boolean;
};

/** Partial NEWS2 band for pulse. Rates are banded as whole numbers, as on the chart. */
export function pulseBand(bpm: number): Score {
  const rate = Math.round(bpm);
  if (rate <= 40 || rate >= 131) return 3;
  if (rate >= 111) return 2;
  if (rate <= 50 || rate >= 91) return 1;
  return 0;
}

/** Partial NEWS2 band for breathing rate. */
export function breathingBand(perMinute: number): Score {
  const rate = Math.round(perMinute);
  if (rate <= 8 || rate >= 25) return 3;
  if (rate >= 21) return 2;
  if (rate <= 11) return 1;
  return 0;
}

/** The higher of the measured parameter bands; bands are not summed. Null when nothing was measured. */
export function partialScore(pulse: number | null, breathing: number | null): Score | null {
  if (pulse === null && breathing === null) return null;
  const bands = [pulse === null ? 0 : pulseBand(pulse), breathing === null ? 0 : breathingBand(breathing)];
  return Math.max(...bands) as Score;
}

const isObservation = (sitting: SittingFacts) => sitting.heartRate !== null || sitting.breathingRate !== null;
const scoreOf = (sitting: SittingFacts) => partialScore(sitting.heartRate, sitting.breathingRate);
const wholeMinutes = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / MINUTE_MS));

/** Everything derived from a patient's sittings that the worklist, the flags and the handoff sentence use. */
export type PatientSnapshot = {
  /** The first observation: the sitting trends are measured against. */
  baseline: FinishedSitting | null;
  /** The newest finished sitting, observation or not. */
  latest: FinishedSitting | null;
  /** The newest finished sitting that gave a heart or breathing rate. */
  latestObservation: FinishedSitting | null;
  /** The newest finished sitting gave neither rate. */
  latestGaveNoReading: boolean;
  lastObservedAt: Date | null;
  minutesSinceObserved: number | null;
  /** Whole minutes from the baseline to the latest observation; null while the baseline is the only one. */
  minutesToLatestObservation: number | null;
  minutesWaiting: number;
  /** Check-in value against the latest sitting's value. */
  pulse: Trend;
  breathing: Trend;
  score: Score | null;
  scoreAtCheckIn: Score | null;
  parametersMeasured: 0 | 1 | 2;
  source: CaptureSource | null;
  sittingInProgress: boolean;
  rules: Record<FlagRule, RuleStatus>;
  /** The numbers a flag opened now would be raised on: check-in against the latest observation. */
  flagDetail: FlagDetail;
};

/** `sittings` in any order; `createdAt` is when the patient was created. */
export function snapshotPatient(sittings: SittingFacts[], createdAt: Date, settings: Settings, now: Date): PatientSnapshot {
  const finished = sittings
    .filter((sitting): sitting is FinishedSitting => sitting.finished && sitting.endedAt !== null)
    .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
  const observations = finished.filter(isObservation);
  const baseline = observations[0] ?? null;
  const latest = finished.at(-1) ?? null;
  const latestObservation = observations.at(-1) ?? null;
  const lastObservedAt = latestObservation?.endedAt ?? null;
  const minutesSinceObserved = lastObservedAt ? wholeMinutes(lastObservedAt.getTime(), now.getTime()) : null;
  const minutesToLatestObservation =
    baseline && latestObservation && latestObservation !== baseline
      ? wholeMinutes(baseline.endedAt.getTime(), latestObservation.endedAt.getTime())
      : null;
  const minutesWaiting = wholeMinutes(createdAt.getTime(), now.getTime());
  const scoreAtCheckIn = baseline ? scoreOf(baseline) : null;

  return {
    baseline,
    latest,
    latestObservation,
    latestGaveNoReading: latest !== null && !isObservation(latest),
    lastObservedAt,
    minutesSinceObserved,
    minutesToLatestObservation,
    minutesWaiting,
    pulse: { base: baseline?.heartRate ?? null, now: latest?.heartRate ?? null },
    breathing: { base: baseline?.breathingRate ?? null, now: latest?.breathingRate ?? null },
    score: latest ? scoreOf(latest) : null,
    scoreAtCheckIn,
    parametersMeasured: ((latest?.heartRate != null ? 1 : 0) + (latest?.breathingRate != null ? 1 : 0)) as 0 | 1 | 2,
    source: latest?.source ?? null,
    sittingInProgress: sittings.some(
      (sitting) => sitting.endedAt === null && now.getTime() - sitting.startedAt.getTime() < IN_PROGRESS_LIMIT_MS,
    ),
    rules: {
      score_rise: settings.scoreRiseEnabled ? scoreRise(observations) : DISABLED,
      baseline_shift: settings.baselineShiftEnabled ? baselineShift(observations, settings) : DISABLED,
      overdue: settings.overdueEnabled
        ? overdue(lastObservedAt ?? createdAt, now, settings.recheckIntervalMin)
        : DISABLED,
    },
    flagDetail: {
      pulse: { base: baseline?.heartRate ?? null, now: latestObservation?.heartRate ?? null },
      breathing: { base: baseline?.breathingRate ?? null, now: latestObservation?.breathingRate ?? null },
      scoreAtCheckIn,
      scoreNow: latestObservation ? scoreOf(latestObservation) : null,
      minutesSinceCheckIn: minutesToLatestObservation ?? (baseline ? 0 : minutesWaiting),
      minutesSinceObserved,
    },
  };
}

/** A rule that is switched off opens nothing and closes what is open. */
const DISABLED: RuleStatus = { met: false, cleared: true };

/**
 * Applies `raised` to the observations after the baseline. The rule opens when the two most
 * recent ones are both raised, and clears when the most recent one is not.
 */
function persisting(observations: SittingFacts[], raised: (observation: SittingFacts) => boolean): RuleStatus {
  const [, ...later] = observations;
  const last = later.at(-1);
  const previous = later.at(-2);
  if (!last || !raised(last)) return { met: false, cleared: true };
  return { met: previous !== undefined && raised(previous), cleared: false };
}

/** The partial score has risen since check-in and the rise persists across two consecutive observations. */
export function scoreRise(observations: SittingFacts[]): RuleStatus {
  const baseline = observations[0];
  const baselineScore = baseline ? (scoreOf(baseline) ?? 0) : 0;
  return persisting(observations, (observation) => (scoreOf(observation) ?? 0) > baselineScore);
}

/** Pulse or breathing has moved more than the configured amount from check-in on two consecutive observations. */
export function baselineShift(
  observations: SittingFacts[],
  thresholds: Pick<Settings, "pulseDeltaBpm" | "breathingDeltaPerMin">,
): RuleStatus {
  const baseline = observations[0];
  const moved = (now: number | null, base: number | null | undefined, limit: number) =>
    now !== null && base != null && Math.abs(now - base) > limit;
  return persisting(
    observations,
    (observation) =>
      moved(observation.heartRate, baseline?.heartRate, thresholds.pulseDeltaBpm) ||
      moved(observation.breathingRate, baseline?.breathingRate, thresholds.breathingDeltaPerMin),
  );
}

/** No valid observation for longer than the re-check interval, counted from `since`. */
export function overdue(since: Date, now: Date, recheckIntervalMin: number): RuleStatus {
  const met = now.getTime() - since.getTime() > recheckIntervalMin * MINUTE_MS;
  return { met, cleared: !met };
}
