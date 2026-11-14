import type { WorklistItem, WorklistResponse } from "@triagecam/contracts";

import { flagsToWire } from "./flags.ts";
import { ageInYears, iso, isoOrNull, toPatientRef } from "./serialize.ts";
import { getSettings } from "./settings.ts";
import { syncWaitingPatients, patientHandoff, type PatientHistory } from "./trend/engine.ts";
import { rankPatients, tileState } from "./trend/rank.ts";

export const historyState = (history: PatientHistory) =>
  tileState({
    trendFlagOpen: history.openFlags.some((flag) => flag.rule !== "overdue"),
    latestGaveNoReading: history.snapshot.latestGaveNoReading,
    overdueFlagOpen: history.openFlags.some((flag) => flag.rule === "overdue"),
  });

/** Every waiting patient once, in rank order. Brings the overdue flags up to date first. */
export async function buildWorklist(now = new Date()): Promise<WorklistResponse> {
  const [histories, settings] = await Promise.all([syncWaitingPatients({ now }), getSettings()]);
  const flags = await flagsToWire(
    histories.flatMap((history) => history.openFlags.map((flag) => ({ flag, patient: history.patient }))),
  );

  const ranked = rankPatients(
    histories.map((history) => {
      const { patient, snapshot } = history;
      const firstTrendFlag = history.openFlags
        .filter((flag) => flag.rule !== "overdue")
        .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())[0];
      return {
        patientNumber: patient.number,
        state: historyState(history),
        score: snapshot.score,
        flagOpenedAt: firstTrendFlag?.openedAt ?? null,
        unobservedSince: snapshot.lastObservedAt ?? patient.createdAt,
        history,
      };
    }),
  );

  const items = ranked.map(({ history, state }, index): WorklistItem => {
    const { patient, snapshot } = history;
    const openIds = new Set(history.openFlags.map((flag) => flag.id));
    return {
      rank: index + 1,
      patientNumber: patient.number,
      patient: toPatientRef(patient),
      reasonForVisit: patient.reasonForVisit,
      ageYears: ageInYears(patient.dateOfBirth, now),
      state,
      waitingSince: iso(patient.createdAt),
      lastObservedAt: isoOrNull(snapshot.lastObservedAt),
      minutesSinceObserved: snapshot.minutesSinceObserved,
      pulse: snapshot.pulse,
      breathing: snapshot.breathing,
      score: snapshot.score,
      scoreAtCheckIn: snapshot.scoreAtCheckIn,
      parametersMeasured: snapshot.parametersMeasured,
      source: snapshot.source,
      flags: flags.filter((flag) => openIds.has(flag.id)),
      handoff: patientHandoff(patient, snapshot),
      sittingInProgress: snapshot.sittingInProgress,
    };
  });

  return { generatedAt: iso(now), recheckIntervalMin: settings.recheckIntervalMin, items };
}
