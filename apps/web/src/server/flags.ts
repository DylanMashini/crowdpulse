import type { Flag, FlagListQuery, FlagListResponse } from "@triagecam/contracts";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import * as z from "zod";

import { db, schema } from "../db/client.ts";
import { publish } from "./events.ts";
import { ApiError } from "./http.ts";
import { decodeCursor, encodeCursor, takePage } from "./pagination.ts";
import type { FlagRow } from "./serialize.ts";
import { iso, isoOrNull } from "./serialize.ts";

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

const toFlag = (row: FlagRow, ticketNumber: number, acknowledgement: Acknowledgement | undefined): Flag => {
  const { handoff, ...detail } = row.detail;
  return {
    id: row.id,
    ticketNumber,
    rule: row.rule,
    openedAt: iso(row.openedAt),
    closedAt: isoOrNull(row.closedAt),
    detail,
    acknowledgedAt: isoOrNull(acknowledgement?.at ?? null),
    acknowledgedBy: acknowledgement?.email ?? null,
    handoff,
  };
};

export type FlagWithTicket = { flag: FlagRow; ticketNumber: number };

export async function flagsToWire(rows: FlagWithTicket[]): Promise<Flag[]> {
  const acknowledgements = await firstAcknowledgements(rows.map((row) => row.flag.id));
  return rows.map(({ flag, ticketNumber }) => toFlag(flag, ticketNumber, acknowledgements.get(flag.id)));
}

export async function flagToWire(flag: FlagRow, ticketNumber: number): Promise<Flag> {
  const [wire] = await flagsToWire([{ flag, ticketNumber }]);
  return wire as Flag;
}

const selectFlags = () =>
  db
    .select({ flag: schema.flags, ticketNumber: schema.tickets.number })
    .from(schema.flags)
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.flags.ticketId));

/** Every flag of one ticket, newest first, with the rows they were built from. */
export async function ticketFlags(ticketId: string): Promise<{ rows: FlagWithTicket[]; flags: Flag[] }> {
  const rows = await selectFlags().where(eq(schema.flags.ticketId, ticketId)).orderBy(desc(schema.flags.openedAt));
  return { rows, flags: await flagsToWire(rows) };
}

const FlagCursor = z.object({ openedAt: z.iso.datetime(), id: z.uuid() });

export async function listFlags(query: FlagListQuery): Promise<FlagListResponse> {
  const conditions: (SQL | undefined)[] = [];
  if (query.status === "open") conditions.push(isNull(schema.flags.closedAt));
  if (query.status === "closed") conditions.push(isNotNull(schema.flags.closedAt));
  if (query.ticket !== undefined) conditions.push(eq(schema.tickets.number, query.ticket));
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

/** Records who acknowledged and when. A second acknowledgement by the same person changes nothing. */
export async function acknowledgeFlag(flagId: string, userId: string): Promise<Flag> {
  const [row] = await selectFlags().where(eq(schema.flags.id, flagId)).limit(1);
  if (!row) throw new ApiError("not_found", "There is no flag with that id");
  const inserted = await db
    .insert(schema.acknowledgements)
    .values({ flagId, userId, at: new Date() })
    .onConflictDoNothing()
    .returning();
  const flag = await flagToWire(row.flag, row.ticketNumber);
  if (inserted.length > 0) publish({ type: "flag_acknowledged", flag });
  return flag;
}
