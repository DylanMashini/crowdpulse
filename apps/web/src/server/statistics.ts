import { flagAlerts, type PatientStatistics, type Statistics, type TileState } from "@triagecam/contracts";
import { and, asc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { flagsToWire } from "./flags.ts";
import { hasSummary, iso, isoOrNull, type SittingRow, toPatientRef, trustedHeartRate } from "./serialize.ts";
import { getSettings } from "./settings.ts";
import {
  BREATHING_RATE_BINS,
  HEART_RATE_BINS,
  distribution,
  flagStatistics,
  highest,
  mean,
  median,
  minutesBetweenObservations,
} from "./stats/summary.ts";
import { sittingFacts, syncWaitingPatients } from "./trend/engine.ts";
import { snapshotPatient } from "./trend/rules.ts";
import { historyState } from "./worklist.ts";

const MINUTE_MS = 60_000;

function startOfLocalDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, to.getTime() - from.getTime()) / MINUTE_MS;

type FinishedSitting = SittingRow & { endedAt: Date };
const isFinished = (sitting: SittingRow): sitting is FinishedSitting => hasSummary(sitting) && sitting.endedAt !== null;
const isObservation = (sitting: SittingRow) => trustedHeartRate(sitting) !== null || sitting.breathingRate !== null;

/**
 * What the waiting room did in [from, to): who came and went, how often they were observed,
 * what the camera measured and how flags were handled. Sittings from the JavaScript stub
 * measure nothing and are left out of every number.
 */
export async function statistics(range: { from?: string; to?: string }): Promise<Statistics> {
  const now = new Date();
  const to = range.to ? new Date(range.to) : now;
  const from = range.from ? new Date(range.from) : startOfLocalDay(to);
  const inRange = (at: Date) => at >= from && at < to;

  // First, so the overdue flags are up to date before any flag is counted.
  const histories = await syncWaitingPatients({ now });
  const flagsWithPatient = () =>
    db
      .select({ flag: schema.flags, patient: schema.patients })
      .from(schema.flags)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.flags.patientId));
  const [patients, raisedRows, openRows, settings] = await Promise.all([
    // Everyone who was in the waiting room at some moment of the range.
    db
      .select()
      .from(schema.patients)
      .where(and(lt(schema.patients.createdAt, to), or(isNull(schema.patients.dischargedAt), gte(schema.patients.dischargedAt, from))))
      .orderBy(asc(schema.patients.createdAt)),
    flagsWithPatient().where(and(gte(schema.flags.openedAt, from), lt(schema.flags.openedAt, to))),
    flagsWithPatient().where(isNull(schema.flags.closedAt)),
    getSettings(),
  ]);

  const patientIds = patients.map((patient) => patient.id);
  // As the API sends them, so they are grouped into alerts exactly as every screen groups them.
  const [sittings, raised, openNow] = await Promise.all([
    patientIds.length === 0
      ? []
      : db
          .select()
          .from(schema.sittings)
          .where(and(inArray(schema.sittings.patientId, patientIds), lt(schema.sittings.startedAt, to), ne(schema.sittings.source, "stub")))
          .orderBy(asc(schema.sittings.startedAt)),
    flagsToWire(raisedRows),
    flagsToWire(openRows),
  ]);

  const stateNow = new Map<string, TileState>(histories.map((history) => [history.patient.id, historyState(history)]));
  const byState: Record<TileState, number> = { observed: 0, flag: 0, overdue: 0, "no-reading": 0 };
  for (const state of stateNow.values()) byState[state] += 1;
  const lowConfidenceNow = histories.filter(
    (history) => stateNow.get(history.patient.id) === "no-reading" && history.snapshot.latestLowConfidencePulse !== null,
  ).length;
  const minutesWaiting = histories.map((history) => minutesBetween(history.patient.createdAt, now));
  const minutesSinceObserved = histories.map((history) =>
    minutesBetween(history.snapshot.lastObservedAt ?? history.patient.createdAt, now),
  );

  const finishedInRange: FinishedSitting[] = [];
  const minutesToFirstObservation: number[] = [];
  const observationGaps: number[] = [];
  const sittingsPerPatient: number[] = [];

  const rows = patients.map((patient): PatientStatistics => {
    const finished = sittings.filter((sitting) => sitting.patientId === patient.id).filter(isFinished);
    const observations = finished.filter(isObservation).sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
    const counted = finished.filter((sitting) => inRange(sitting.startedAt));
    finishedInRange.push(...counted);
    if (counted.length > 0) sittingsPerPatient.push(counted.length);

    const first = observations[0];
    if (first && inRange(patient.createdAt)) minutesToFirstObservation.push(minutesBetween(patient.createdAt, first.endedAt));
    observationGaps.push(...minutesBetweenObservations(observations, (later) => inRange(later.startedAt)));

    // The numbers as they stand now, or as they stood at discharge.
    const waiting = patient.status === "waiting";
    const asOf = patient.dischargedAt ?? now;
    const snapshot = snapshotPatient(finished.map(sittingFacts), patient.createdAt, settings, asOf);
    return {
      patientNumber: patient.number,
      patient: toPatientRef(patient),
      status: patient.status,
      state: waiting ? (stateNow.get(patient.id) ?? null) : null,
      arrivedAt: iso(patient.createdAt),
      dischargedAt: isoOrNull(patient.dischargedAt),
      minutesInRoom: snapshot.minutesWaiting,
      minutesSinceObserved: waiting ? snapshot.minutesSinceObserved : null,
      sittings: counted.length,
      observations: counted.filter(isObservation).length,
      pulse: snapshot.pulse,
      breathing: snapshot.breathing,
      heartRates: observations.flatMap((sitting) => trustedHeartRate(sitting) ?? []),
      score: snapshot.score,
      flags: flagAlerts(raised.filter((flag) => flag.patientNumber === patient.number)).length,
    };
  });

  const discharged = patients.filter((patient) => patient.dischargedAt && inRange(patient.dischargedAt));
  const waitingFirst = (row: PatientStatistics) => (row.status === "waiting" ? 0 : 1);

  return {
    generatedAt: iso(now),
    from: iso(from),
    to: iso(to),
    recheckIntervalMin: settings.recheckIntervalMin,
    patients: {
      seen: patients.length,
      arrived: patients.filter((patient) => inRange(patient.createdAt)).length,
      discharged: discharged.length,
      medianMinutesToFirstObservation: median(minutesToFirstObservation),
      medianMinutesToDischarge: median(discharged.map((patient) => minutesBetween(patient.createdAt, patient.dischargedAt as Date))),
    },
    waitingNow: {
      patients: histories.length,
      byState,
      lowConfidence: lowConfidenceNow,
      medianMinutesWaiting: median(minutesWaiting),
      longestMinutesWaiting: highest(minutesWaiting),
      medianMinutesSinceObserved: median(minutesSinceObserved),
      longestMinutesSinceObserved: highest(minutesSinceObserved),
    },
    sittings: {
      finished: finishedInRange.length,
      withReading: finishedInRange.filter(isObservation).length,
      checkIns: finishedInRange.filter((sitting) => sitting.kind === "check_in").length,
      rechecks: finishedInRange.filter((sitting) => sitting.kind === "recheck").length,
      meanPerPatient: mean(sittingsPerPatient),
      medianMinutesBetweenObservations: median(observationGaps),
      meanHeartRateCoverage: mean(finishedInRange.map((sitting) => sitting.heartRateCoverage ?? 0)),
      meanBreathingRateCoverage: mean(finishedInRange.map((sitting) => sitting.breathingRateCoverage ?? 0)),
      medianTimeToFirstReadingSeconds: median(finishedInRange.flatMap((sitting) => sitting.timeToFirstReadingSeconds ?? [])),
    },
    heartRate: distribution(
      finishedInRange.flatMap((sitting) => trustedHeartRate(sitting) ?? []),
      HEART_RATE_BINS,
    ),
    breathingRate: distribution(
      finishedInRange.flatMap((sitting) => sitting.breathingRate ?? []),
      BREATHING_RATE_BINS,
    ),
    flags: flagStatistics(raised, openNow),
    perPatient: rows.sort((a, b) => waitingFirst(a) - waitingFirst(b) || b.minutesInRoom - a.minutesInRoom),
  };
}
