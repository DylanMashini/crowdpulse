import { type Flag, type FlagListQuery, type FlagListResponse, type FlagRule, patientLabel } from "@triagecam/contracts";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, type SQL } from "drizzle-orm";
import * as z from "zod";

import { db, schema } from "../db/client.ts";
import { publish } from "./events.ts";
import { ApiError } from "./http.ts";
import { decodeCursor, encodeCursor, takePage } from "./pagination.ts";
import type { FlagRow, PatientRow } from "./serialize.ts";
import { iso, isoOrNull, toPatientRef } from "./serialize.ts";

type Acknowledgement = { at: Date; email: string };

/** The first acknowledgement of each flag. */
async function firstAcknowledgements(flagIds: string[]): Promise<Map<string, Acknowledgement>> {
  const first = new Map<string, Acknowledgement>();
  if (flagIds.length === 0) return first;
  const rows = await db
    .select({ flagId: schema.acknowledgements.flagId, at: schema.acknowledgements.at, email: schema.users.email })
    .from(schema.acknowledgements)
    .innerJoin(schema.users, eq(schema.users.id, schema.acknowledgements.userId))
    .where(inArray(schema.acknowledgements.flagId, flagIds))
    .orderBy(asc(schema.acknowledgements.at));
  for (const row of rows) {
    if (!first.has(row.flagId)) first.set(row.flagId, { at: row.at, email: row.email });
  }
  return first;
}

/** What a flag needs to know about its patient. */
export type FlagPatient = Pick<PatientRow, "number" | "name" | "photoUpdatedAt">;

/**
 * The sentence was frozen when the flag opened, which may have been before anyone typed the
 * patient's name (or, in rows from before patients had names, as "Ticket 14"). The numbers
 * stay frozen; the opening words are brought up to date.
 */
const currentHandoff = (frozen: string, patient: FlagPatient): string =>
  frozen.replace(new RegExp(`^(Ticket|Patient) ${patient.number}: `), `${patientLabel(patient)}: `);

/**
 * Which alert a flag belongs to: the one definition of "one deterioration" that the server,
 * the dashboard and the nurse app all use (CONTRACTS section 6, Flag rules).
 *
 * The trend flags that one sitting raises for a patient are one alert. `applyRules` opens them
 * with the same `openedAt`, so the patient and that instant name the alert. A trend flag that
 * opens on a later sitting was raised on other numbers and is another alert. An overdue flag is
 * always an alert on its own.
 */
export const alertIdOf = (row: Pick<FlagRow, "id" | "rule" | "openedAt">, patient: Pick<FlagPatient, "number">): string =>
  row.rule === "overdue" ? row.id : `trend-${patient.number}-${row.openedAt.getTime()}`;

const toFlag = (row: FlagRow, patient: FlagPatient, acknowledgement: Acknowledgement | undefined): Flag => {
  const { handoff, ...detail } = row.detail;
  return {
    id: row.id,
    patientNumber: patient.number,
    patient: toPatientRef(patient),
    rule: row.rule,
    openedAt: iso(row.openedAt),
    closedAt: isoOrNull(row.closedAt),
    detail,
    acknowledgedAt: isoOrNull(acknowledgement?.at ?? null),
    acknowledgedBy: acknowledgement?.email ?? null,
    handoff: currentHandoff(handoff, patient),
    alertId: alertIdOf(row, patient),
  };
};

export type FlagWithPatient = { flag: FlagRow; patient: FlagPatient };

export async function flagsToWire(rows: FlagWithPatient[]): Promise<Flag[]> {
  const acknowledgements = await firstAcknowledgements(rows.map((row) => row.flag.id));
  return rows.map(({ flag, patient }) => toFlag(flag, patient, acknowledgements.get(flag.id)));
}

export async function flagToWire(flag: FlagRow, patient: FlagPatient): Promise<Flag> {
  const [wire] = await flagsToWire([{ flag, patient }]);
  return wire as Flag;
}

const selectFlags = () =>
  db
    .select({ flag: schema.flags, patient: schema.patients })
    .from(schema.flags)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.flags.patientId));

/** Every flag of one patient, newest first, with the rows they were built from. */
export async function patientFlags(patientId: string): Promise<{ rows: FlagWithPatient[]; flags: Flag[] }> {
  const rows = await selectFlags().where(eq(schema.flags.patientId, patientId)).orderBy(desc(schema.flags.openedAt));
  return { rows, flags: await flagsToWire(rows) };
}

const FlagCursor = z.object({ openedAt: z.iso.datetime(), id: z.uuid() });

export async function listFlags(query: FlagListQuery): Promise<FlagListResponse> {
  const conditions: (SQL | undefined)[] = [];
  if (query.status === "open") conditions.push(isNull(schema.flags.closedAt));
  if (query.status === "closed") conditions.push(isNotNull(schema.flags.closedAt));
  if (query.patient !== undefined) conditions.push(eq(schema.patients.number, query.patient));
  if (query.cursor) {
    const cursor = FlagCursor.safeParse(decodeCursor(query.cursor));
    if (!cursor.success) throw new ApiError("invalid_request", "The cursor is not valid");
    const openedAt = new Date(cursor.data.openedAt);
    conditions.push(
      or(
        lt(schema.flags.openedAt, openedAt),
        and(eq(schema.flags.openedAt, openedAt), lt(schema.flags.id, cursor.data.id)),
      ),
    );
  }
  const rows = await selectFlags()
    .where(and(...conditions))
    .orderBy(desc(schema.flags.openedAt), desc(schema.flags.id))
    .limit(query.limit + 1);
  const { items, last } = takePage(rows, query.limit);
  return {
    items: await flagsToWire(items),
    nextCursor: last ? encodeCursor({ openedAt: iso(last.flag.openedAt), id: last.flag.id }) : null,
  };
}

const TREND_RULES: FlagRule[] = ["score_rise", "baseline_shift"];

/**
 * Records who acknowledged and when. A second acknowledgement by the same person changes nothing.
 *
 * One deterioration usually trips both trend rules, and to the nurse it is one alert. So
 * acknowledging an open trend flag also acknowledges the patient's other open trend flag when
 * nobody has acknowledged that one yet. An overdue flag is a different alert and is never
 * covered by, or covers, a trend flag.
 */
export async function acknowledgeFlag(flagId: string, userId: string): Promise<Flag> {
  const [row] = await selectFlags().where(eq(schema.flags.id, flagId)).limit(1);
  if (!row) throw new ApiError("not_found", "There is no flag with that id");

  let covered: FlagWithPatient[] = [];
  if (row.flag.closedAt === null && TREND_RULES.includes(row.flag.rule)) {
    const others = await selectFlags().where(
      and(
        eq(schema.flags.patientId, row.flag.patientId),
        ne(schema.flags.id, flagId),
        isNull(schema.flags.closedAt),
        inArray(schema.flags.rule, TREND_RULES),
      ),
    );
    const acknowledged = await firstAcknowledgements(others.map((other) => other.flag.id));
    covered = others.filter((other) => !acknowledged.has(other.flag.id));
  }

  const rows = [row, ...covered];
  const at = new Date();
  const inserted = await db
    .insert(schema.acknowledgements)
    .values(rows.map(({ flag }) => ({ flagId: flag.id, userId, at })))
    .onConflictDoNothing()
    .returning({ flagId: schema.acknowledgements.flagId });
  const flags = await flagsToWire(rows);
  for (const flag of flags) {
    if (inserted.some((acknowledgement) => acknowledgement.flagId === flag.id)) publish({ type: "flag_acknowledged", flag });
  }
  return flags[0] as Flag;
}
