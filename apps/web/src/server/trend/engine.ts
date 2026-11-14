import { type Flag, type FlagRule, patientLabel, type Settings } from "@triagecam/contracts";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { publish, worklistChanged } from "../events.ts";
import { flagToWire } from "../flags.ts";
import { notifyFlagOpened } from "../push.ts";
import type { FlagRow, SittingRow, PatientRow } from "../serialize.ts";
import { hasSummary } from "../serialize.ts";
import { getSettings } from "../settings.ts";
import { handoffSentence } from "./handoff.ts";
import { type SittingFacts, snapshotPatient, type PatientSnapshot } from "./rules.ts";

/** Trend rules first: this is also the order flags are listed in. */
const RULES: FlagRule[] = ["score_rise", "baseline_shift", "overdue"];

export type PatientHistory = {
  patient: PatientRow;
  /** Oldest first. */
  sittings: SittingRow[];
  snapshot: PatientSnapshot;
  /** Open flags, in RULES order. */
  openFlags: FlagRow[];
};

export type SyncOptions = { now?: Date; notify?: boolean };

const sittingFacts = (row: SittingRow): SittingFacts => ({
  id: row.id,
  source: row.source,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  finished: hasSummary(row),
  heartRate: row.heartRate,
  breathingRate: row.breathingRate,
});

/** The handoff sentence for a patient as it stands: check-in against the latest observation. */
export const patientHandoff = (patient: Pick<PatientRow, "number" | "name">, snapshot: PatientSnapshot): string =>
  handoffSentence({
    label: patientLabel(patient),
    pulse: snapshot.flagDetail.pulse,
    breathing: snapshot.flagDetail.breathing,
    minutesLater: snapshot.minutesToLatestObservation,
    minutesSinceObserved: snapshot.minutesSinceObserved,
    minutesWaiting: snapshot.minutesWaiting,
    latestGaveNoReading: snapshot.latestGaveNoReading,
  });

async function loadHistories(patients: PatientRow[], settings: Settings, now: Date): Promise<PatientHistory[]> {
  if (patients.length === 0) return [];
  const patientIds = patients.map((patient) => patient.id);
  const [sittings, openFlags] = await Promise.all([
    db
      .select()
      .from(schema.sittings)
      .where(inArray(schema.sittings.patientId, patientIds))
      .orderBy(asc(schema.sittings.startedAt)),
    db
      .select()
      .from(schema.flags)
      .where(and(inArray(schema.flags.patientId, patientIds), isNull(schema.flags.closedAt))),
  ]);
  return patients.map((patient) => {
    const own = sittings.filter((sitting) => sitting.patientId === patient.id);
    return {
      patient,
      sittings: own,
      snapshot: snapshotPatient(own.map(sittingFacts), patient.createdAt, settings, now),
      openFlags: openFlags
        .filter((flag) => flag.patientId === patient.id)
        .sort((a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule)),
    };
  });
}

/** Opens and closes one patient's flags to match its rules. Returns the flags that opened. */
async function applyRules(history: PatientHistory, now: Date): Promise<{ opened: Flag[]; changed: boolean }> {
  const { patient, snapshot } = history;
  const opened: Flag[] = [];
  let changed = false;

  for (const rule of RULES) {
    const status = snapshot.rules[rule];
    const open = history.openFlags.find((flag) => flag.rule === rule);

    if (!open && status.met) {
      // The partial unique index allows one open flag per patient and rule, so a concurrent
      // request that got there first makes this insert a no-op.
      const [row] = await db
        .insert(schema.flags)
        .values({
          patientId: patient.id,
          rule,
          openedAt: now,
          detail: { ...snapshot.flagDetail, handoff: patientHandoff(patient, snapshot) },
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      history.openFlags.push(row);
      const flag = await flagToWire(row, patient);
      publish({ type: "flag_opened", flag });
      opened.push(flag);
      changed = true;
    } else if (open && status.cleared) {
      const [row] = await db
        .update(schema.flags)
        .set({ closedAt: now })
        .where(and(eq(schema.flags.id, open.id), isNull(schema.flags.closedAt)))
        .returning();
      history.openFlags = history.openFlags.filter((flag) => flag.id !== open.id);
      if (!row) continue;
      publish({ type: "flag_closed", flag: await flagToWire(row, patient) });
      changed = true;
    }
  }
  history.openFlags.sort((a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
  return { opened, changed };
}

/** One after another, so the cool-down sees the push that went out just before. */
async function notifyInOrder(flags: Flag[], patientId: string, cooldownMin: number): Promise<void> {
  for (const flag of flags) await notifyFlagOpened(flag, patientId, cooldownMin);
}

/**
 * Runs the trend rules for the given waiting patients, opens and closes flags to match, and
 * returns each patient's history with its flags as they now stand.
 */
export async function syncPatients(patients: PatientRow[], options: SyncOptions = {}): Promise<PatientHistory[]> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const histories = await loadHistories(patients, settings, now);
  let changed = false;
  for (const history of histories) {
    if (history.patient.status !== "waiting") continue;
    const result = await applyRules(history, now);
    changed ||= result.changed;
    if (options.notify !== false && result.opened.length > 0) {
      // Not awaited: a slow or failed push must not hold up or fail the request.
      void notifyInOrder(result.opened, history.patient.id, settings.notifyCooldownMin);
    }
  }
  if (changed) worklistChanged();
  return histories;
}

export async function syncWaitingPatients(options: SyncOptions = {}): Promise<PatientHistory[]> {
  const patients = await db.select().from(schema.patients).where(eq(schema.patients.status, "waiting"));
  return syncPatients(patients, options);
}

export async function syncPatient(patient: PatientRow, options: SyncOptions = {}): Promise<PatientHistory> {
  const [history] = await syncPatients([patient], options);
  return history as PatientHistory;
}
