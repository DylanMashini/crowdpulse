import * as z from 'zod';

import { PatientNumber, PatientRef, Timestamp, Unit } from './common.ts';
import { PatientStatus } from './patients.ts';
import { FlagRule, Score, TileState, Trend } from './worklist.ts';

export const StatisticsQuery = z.object({
  /** Inclusive start; default is the start of the server's local day. */
  from: Timestamp.optional(),
  /** Exclusive end; default is now. */
  to: Timestamp.optional(),
});
export type StatisticsQuery = z.infer<typeof StatisticsQuery>;

const count = z.int().nonnegative();
/** A median or a mean with nothing under it is null, never 0. */
const measure = z.number().nonnegative().nullable();

/** How one rate was spread over the sittings that measured it. */
export const RateDistribution = z.object({
  /** Finished sittings whose summary has this rate. */
  sittings: count,
  median: measure,
  lowest: measure,
  highest: measure,
  /**
   * Whole-number bins, lowest first, with no gaps between them. `from` and `to` are both
   * inclusive and a rate is binned after rounding, as the screens show it. Empty when
   * `sittings` is 0.
   */
  bins: z.array(z.object({ from: z.int(), to: z.int(), sittings: count })),
});
export type RateDistribution = z.infer<typeof RateDistribution>;

/** One patient who was in the waiting room during the range. */
export const PatientStatistics = z.object({
  patientNumber: PatientNumber,
  patient: PatientRef,
  status: PatientStatus,
  /** Null once discharged. */
  state: TileState.nullable(),
  arrivedAt: Timestamp,
  dischargedAt: Timestamp.nullable(),
  /** Whole minutes from arrival to discharge, or to generatedAt for a patient still waiting. */
  minutesInRoom: count,
  /** Whole minutes since the last observation at generatedAt. Null when discharged or never observed. */
  minutesSinceObserved: count.nullable(),
  /** Finished sittings started in the range. */
  sittings: count,
  /** Those that gave a heart or breathing rate. */
  observations: count,
  /** The first observation against the latest finished sitting, as on the worklist. */
  pulse: Trend,
  breathing: Trend,
  /** Heart rate of every observation that has one, oldest first, in bpm. */
  heartRates: z.array(z.number()),
  score: Score.nullable(),
  /** Alerts raised in the range, counted as in `Statistics.flags.raised`. */
  flags: count,
});
export type PatientStatistics = z.infer<typeof PatientStatistics>;

export const Statistics = z.object({
  generatedAt: Timestamp,
  from: Timestamp,
  to: Timestamp,
  /** The re-check interval from the settings, to read the cadence against. */
  recheckIntervalMin: z.number().positive(),
  patients: z.object({
    /** In the waiting room at any moment of the range. */
    seen: count,
    /** Intake started in the range. */
    arrived: count,
    /** Discharged in the range. */
    discharged: count,
    /** Arrival to the end of the first observation, over patients who arrived in the range. */
    medianMinutesToFirstObservation: measure,
    /** Arrival to discharge, over patients discharged in the range. */
    medianMinutesToDischarge: measure,
  }),
  /** The waiting room at generatedAt. Not limited to the range. */
  waitingNow: z.object({
    patients: count,
    byState: z.record(TileState, count),
    medianMinutesWaiting: measure,
    longestMinutesWaiting: measure,
    /** Since the last observation, or since arrival for a patient not yet observed. */
    medianMinutesSinceObserved: measure,
    longestMinutesSinceObserved: measure,
  }),
  /** Finished sittings started in the range. */
  sittings: z.object({
    finished: count,
    /** Those that gave a heart or breathing rate: the observations. */
    withReading: count,
    checkIns: count,
    rechecks: count,
    /** Finished sittings per patient who had at least one. */
    meanPerPatient: measure,
    /** Between one observation of a patient and the next, the later one started in the range. */
    medianMinutesBetweenObservations: measure,
    /** Mean share of a sitting's seconds that gave a heart rate. */
    meanHeartRateCoverage: Unit.nullable(),
    meanBreathingRateCoverage: Unit.nullable(),
    medianTimeToFirstReadingSeconds: measure,
  }),
  heartRate: RateDistribution,
  breathingRate: RateDistribution,
  /**
   * Counted in alerts (`flagAlerts`), the unit every other screen counts in: a deterioration
   * that trips both trend rules is one. Only `byRule` counts single flags.
   */
  flags: z.object({
    /** Alerts opened in the range. */
    raised: count,
    /**
     * How often each rule tripped in the range: flags, one per rule. An alert that tripped both
     * trend rules is under both, so these can add up to more than `raised`.
     */
    byRule: z.record(FlagRule, count),
    /** Of those raised, how many a staff member acknowledged. */
    acknowledged: count,
    /** From an alert opening to its first acknowledgement. */
    medianMinutesToAcknowledge: measure,
    /** Alerts open at generatedAt, whenever they were raised. */
    openNow: count,
    /** Of those, the ones still waiting for an acknowledgement, as the nurse app counts them. */
    unacknowledgedNow: count,
  }),
  /** Patients seen in the range: those waiting first, then by longest time in the room. */
  perPatient: z.array(PatientStatistics),
});
export type Statistics = z.infer<typeof Statistics>;
