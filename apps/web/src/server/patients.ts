import type {
  CreatePatientRequest,
  Patient,
  PatientDetailResponse,
  PatientListQuery,
  PatientListResponse,
  TimelineEntry,
  UpdatePatientRequest,
} from "@triagecam/contracts";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import * as z from "zod";

import { db, schema } from "../db/client.ts";
import { publish, patientChanged, worklistChanged } from "./events.ts";
import { flagsToWire, patientFlags } from "./flags.ts";
import { ApiError } from "./http.ts";
import { decodeCursor, encodeCursor, takePage } from "./pagination.ts";
import type { PatientRow } from "./serialize.ts";
import { hasSummary, iso, toPatient, toPatientRef, toSitting } from "./serialize.ts";
import { syncPatient, patientHandoff } from "./trend/engine.ts";
import { partialScore } from "./trend/rules.ts";
import { distinctAcknowledgements, orderTimeline } from "./trend/timeline.ts";
import { historyState } from "./worklist.ts";

async function enrolledPatientIds(patientIds: string[]): Promise<Set<string>> {
  if (patientIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ patientId: schema.faceEmbeddings.patientId })
    .from(schema.faceEmbeddings)
    .where(inArray(schema.faceEmbeddings.patientId, patientIds));
  return new Set(rows.map((row) => row.patientId));
}

export async function patientToWire(row: PatientRow): Promise<Patient> {
  return toPatient(row, (await enrolledPatientIds([row.id])).has(row.id));
}

export async function findPatient(number: number): Promise<PatientRow> {
  const [row] = await db.select().from(schema.patients).where(eq(schema.patients.number, number)).limit(1);
  if (!row) throw new ApiError("not_found", `There is no patient ${number}`);
  return row;
}

/** The patient, refused with patient_discharged unless it is still waiting. */
export async function findWaitingPatient(number: number): Promise<PatientRow> {
  const row = await findPatient(number);
  if (row.status !== "waiting") throw new ApiError("patient_discharged", `Patient ${number} has been discharged`);
  return row;
}

export async function createPatient(request: CreatePatientRequest): Promise<Patient> {
  const [row] = await db.insert(schema.patients).values(request).returning();
  if (!row) throw new Error("The patient was not created");
  patientChanged(toPatientRef(row));
  worklistChanged();
  return toPatient(row, false);
}

export async function listPatients(query: PatientListQuery): Promise<PatientListResponse> {
  const conditions: (SQL | undefined)[] = [];
  if (query.status !== "all") conditions.push(eq(schema.patients.status, query.status));
  if (query.cursor) {
    const before = z.int().positive().safeParse(decodeCursor(query.cursor));
    if (!before.success) throw new ApiError("invalid_request", "The cursor is not valid");
    conditions.push(lt(schema.patients.number, before.data));
  }
  const rows = await db
    .select()
    .from(schema.patients)
    .where(and(...conditions))
    .orderBy(desc(schema.patients.number))
    .limit(query.limit + 1);
  const { items, last } = takePage(rows, query.limit);
  const enrolled = await enrolledPatientIds(items.map((row) => row.id));
  return {
    items: items.map((row) => toPatient(row, enrolled.has(row.id))),
    nextCursor: last ? encodeCursor(last.number) : null,
  };
}

export async function deleteFaceEmbeddings(patientId: string): Promise<void> {
  await db.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.patientId, patientId));
}

/**
 * Saves whatever part of the intake form was sent. Called as staff type, so it is cheap and
 * safe to repeat. Withdrawing the face opt-in deletes the stored embedding. The intake
 * details of a discharged patient can still be corrected; the opt-in cannot be changed.
 */
export async function updatePatient(number: number, request: UpdatePatientRequest): Promise<Patient> {
  const { faceOptIn, intakeComplete, ...intake } = request;
  const patient = faceOptIn === undefined ? await findPatient(number) : await findWaitingPatient(number);
  // Completing intake needs at least a name, counting the one in this very request.
  if (intakeComplete && !(intake.name === undefined ? patient.name : intake.name)) {
    throw new ApiError("invalid_request", "Enter the patient's name before completing intake");
  }
  const changes = {
    ...intake,
    ...(faceOptIn === undefined ? {} : { faceOptIn }),
    ...(intakeComplete === undefined
      ? {}
      : { intakeCompletedAt: intakeComplete ? (patient.intakeCompletedAt ?? new Date()) : null }),
  };
  if (Object.keys(changes).length === 0) return patientToWire(patient);

  const [row] = await db.update(schema.patients).set(changes).where(eq(schema.patients.id, patient.id)).returning();
  if (!row) throw new Error("The patient was not updated");
  if (faceOptIn === false) await deleteFaceEmbeddings(patient.id);
  patientChanged(toPatientRef(row));
  // The worklist shows the name, the reason for the visit and the age.
  if (row.status === "waiting") worklistChanged();
  return patientToWire(row);
}

/**
 * Sets the status, closes open flags and deletes face embeddings. The name, the intake details
 * and the profile photo stay with the record. Safe to call twice.
 */
export async function dischargePatient(number: number): Promise<Patient> {
  const patient = await findPatient(number);
  if (patient.status === "discharged") return toPatient(patient, false);

  const now = new Date();
  const { row, closed } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.patients)
      .set({ status: "discharged", dischargedAt: now })
      .where(eq(schema.patients.id, patient.id))
      .returning();
    const closedFlags = await tx
      .update(schema.flags)
      .set({ closedAt: now })
      .where(and(eq(schema.flags.patientId, patient.id), isNull(schema.flags.closedAt)))
      .returning();
    await tx
      .update(schema.sittings)
      .set({ endedAt: now })
      .where(and(eq(schema.sittings.patientId, patient.id), isNull(schema.sittings.endedAt)));
    await tx.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.patientId, patient.id));
    return { row: updated, closed: closedFlags };
  });
  if (!row) throw new Error("The patient was not discharged");

  for (const flag of await flagsToWire(closed.map((flag) => ({ flag, patient: row })))) {
    publish({ type: "flag_closed", flag });
  }
  patientChanged(toPatientRef(row));
  worklistChanged();
  return toPatient(row, false);
}

export async function patientDetail(number: number): Promise<PatientDetailResponse> {
  const patient = await findPatient(number);
  const history = await syncPatient(patient);
  const { snapshot } = history;
  const { rows: flagRows, flags } = await patientFlags(patient.id);
  const acknowledgements =
    flagRows.length === 0
      ? []
      : await db
          .select({ flagId: schema.acknowledgements.flagId, at: schema.acknowledgements.at, by: schema.users.email })
          .from(schema.acknowledgements)
          .innerJoin(schema.users, eq(schema.users.id, schema.acknowledgements.userId))
          .where(
            inArray(
              schema.acknowledgements.flagId,
              flagRows.map((row) => row.flag.id),
            ),
          )
          .orderBy(asc(schema.acknowledgements.at));

  const timeline: TimelineEntry[] = [{ type: "created", at: iso(patient.createdAt) }];
  for (const sitting of history.sittings) {
    if (!sitting.endedAt || !hasSummary(sitting)) continue;
    timeline.push({
      type: "sitting",
      at: iso(sitting.endedAt),
      sittingId: sitting.id,
      kind: sitting.kind,
      source: sitting.source,
      heartRate: sitting.heartRate,
      breathingRate: sitting.breathingRate,
      score: partialScore(sitting.heartRate, sitting.breathingRate),
    });
  }
  for (const flag of flags) {
    const { alertId } = flag;
    timeline.push({ type: "flag_opened", at: flag.openedAt, flagId: flag.id, rule: flag.rule, handoff: flag.handoff, alertId });
    if (flag.closedAt) timeline.push({ type: "flag_closed", at: flag.closedAt, flagId: flag.id, rule: flag.rule, alertId });
  }
  for (const acknowledgement of distinctAcknowledgements(acknowledgements)) {
    timeline.push({
      type: "flag_acknowledged",
      at: iso(acknowledgement.at),
      flagId: acknowledgement.flagId,
      by: acknowledgement.by,
    });
  }
  if (patient.dischargedAt) timeline.push({ type: "discharged", at: iso(patient.dischargedAt) });

  const baseline = history.sittings.find((sitting) => sitting.id === snapshot.baseline?.id);
  return {
    patient: await patientToWire(patient),
    state: patient.status === "waiting" ? historyState(history) : null,
    baseline: baseline ? toSitting(baseline, number) : null,
    sittings: history.sittings.map((sitting) => toSitting(sitting, number)),
    flags,
    timeline: orderTimeline(timeline),
    handoff: patientHandoff(patient, snapshot),
  };
}
