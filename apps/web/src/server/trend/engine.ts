import { byFlagRule, type Flag, patientLabel, type Settings } from "@triagecam/contracts";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { publish, worklistChanged } from "../events.ts";
import { flagToWire } from "../flags.ts";
import { notifyFlagOpened } from "../push.ts";
import type { FlagRow, SittingRow, PatientRow } from "../serialize.ts";
import { hasSummary, trustedHeartRate } from "../serialize.ts";
import { getSettings } from "../settings.ts";
import { applyRules, type RuleState, type RuleStore } from "./apply.ts";
import { handoffSentence } from "./handoff.ts";
import { type SittingFacts, snapshotPatient, type PatientSnapshot } from "./rules.ts";

export type PatientHistory = {
  patient: PatientRow;
  /** Oldest first. */
  sittings: SittingRow[];
  snapshot: PatientSnapshot;
  /** Open flags, in rule order (`FLAG_RULE_ORDER`). */
  openFlags: FlagRow[];
};

export type SyncOptions = { now?: Date; notify?: boolean };

export const sittingFacts = (row: SittingRow): SittingFacts => ({
  id: row.id,
  source: row.source,
  kind: row.kind,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  finished: hasSummary(row),
  heartRate: trustedHeartRate(row),
  lowConfidenceHeartRate: trustedHeartRate(row) === null ? row.heartRate : null,
  breathingRate: row.breathingRate,
});

/** The handoff sentence for a patient as it stands: check-in against the latest observation. */
export const patientHandoff = (patient: Pick<PatientRow, "number" | "name">, snapshot: PatientSnapshot): string =>
  handoffSentence({
    label: patientLabel(patient),
    pulse: snapshot.flagDetail.pulse,
    breathing: snapshot.flagDetail.breathing,
    pulseFrom: snapshot.pulseFrom,
    breathingFrom: snapshot.breathingFrom,
    minutesLater: snapshot.minutesToLatestObservation,
    minutesSinceObserved: snapshot.minutesSinceObserved,
    minutesWaiting: snapshot.minutesWaiting,
    latestGaveNoReading: snapshot.latestGaveNoReading,
    latestLowConfidencePulse: snapshot.latestLowConfidencePulse,
  });

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadHistories(patients: PatientRow[], settings: Settings, now: Date, from: typeof db | Transaction = db): Promise<PatientHistory[]> {
  if (patients.length === 0) return [];
  const patientIds = patients.map((patient) => patient.id);
  const sittingsQuery = () =>
    from.select().from(schema.sittings).where(inArray(schema.sittings.patientId, patientIds)).orderBy(asc(schema.sittings.startedAt));
  const openFlagsQuery = () =>
    from
      .select()
      .from(schema.flags)
      .where(and(inArray(schema.flags.patientId, patientIds), isNull(schema.flags.closedAt)));
  // A transaction is one connection, which runs one query at a time.
  const [sittings, openFlags] =
    from === db ? await Promise.all([sittingsQuery(), openFlagsQuery()]) : [await sittingsQuery(), await openFlagsQuery()];
  return patients.map((patient) => {
    const own = sittings.filter((sitting) => sitting.patientId === patient.id);
    return {
      patient,
      sittings: own,
      snapshot: snapshotPatient(own.map(sittingFacts), patient.createdAt, settings, now),
      openFlags: openFlags.filter((flag) => flag.patientId === patient.id).sort(byFlagRule),
    };
  });
}

type FlagState = RuleState<FlagRow> & PatientHistory;

/** Postgres advisory locks are named by two integers: this one says "a patient's flags". */
const FLAG_LOCK = 7401;

/**
 * Holds the patient's flags for the rest of the transaction: no other request opens or closes
 * one until it ends. Everything that writes a patient's flags takes it first.
 */
export const lockPatientFlags = (tx: Transaction, patientId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(${FLAG_LOCK}, hashtext(${patientId}))`);

/**
 * One patient's flags in Postgres. The lock is an advisory lock on the patient, held to the end
 * of a transaction that everything inside it runs on, so the flags a request opens appear to
 * every other request together or not at all.
 */
const flagStore = (patient: PatientRow, settings: Settings, now: Date): RuleStore<FlagState, FlagRow> => ({
  locked: (work) =>
    db.transaction(async (tx) => {
      await lockPatientFlags(tx, patient.id);
      // The caller's copy of the patient may be from before a discharge, which closed its flags.
      const [current] = await tx.select().from(schema.patients).where(eq(schema.patients.id, patient.id));
      const [history] = current?.status === "waiting" ? await loadHistories([current], settings, now, tx) : [];
      return work(
        history ? { ...history, rules: history.snapshot.rules } : null,
        {
          // The partial unique index allows one open flag per patient and rule. Nothing else
          // opens flags, so inside the lock this insert cannot conflict; it stays a no-op
          // rather than an error if it ever does.
          open: async (rule, at, state) => {
            const [row] = await tx
              .insert(schema.flags)
              .values({
                patientId: patient.id,
                rule,
                openedAt: at,
                detail: { ...state.snapshot.flagDetail, handoff: patientHandoff(patient, state.snapshot) },
              })
              .onConflictDoNothing()
              .returning();
            return row;
          },
          // Still a no-op rather than an error if the flag is somehow closed already.
          close: async (flag, at) => {
            const [row] = await tx
              .update(schema.flags)
              .set({ closedAt: at })
              .where(and(eq(schema.flags.id, flag.id), isNull(schema.flags.closedAt)))
              .returning();
            return row;
          },
        },
      );
    }),
});

/**
 * Opens and closes one patient's flags to match its rules (`applyRules`), and brings `history`
 * up to what the changes were decided on. Returns the flags that opened. Events go out once
 * the changes are committed, so a dashboard that reloads on one finds them.
 */
async function syncFlags(history: PatientHistory, settings: Settings, now: Date): Promise<{ opened: Flag[]; changed: boolean }> {
  const { patient } = history;
  const { changes, state } = await applyRules<FlagRow, FlagState>(
    { ...history, rules: history.snapshot.rules },
    now,
    flagStore(patient, settings, now),
  );
  if (state) {
    history.sittings = state.sittings;
    history.snapshot = state.snapshot;
    history.openFlags = [...state.openFlags].sort(byFlagRule);
  }

  const opened: Flag[] = [];
  for (const change of changes) {
    const flag = await flagToWire(change.flag, patient);
    if (change.type === "opened") {
      publish({ type: "flag_opened", flag });
      opened.push(flag);
    } else {
      publish({ type: "flag_closed", flag });
    }
  }
  return { opened, changed: changes.length > 0 };
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
    const result = await syncFlags(history, settings, now);
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
