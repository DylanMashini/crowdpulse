import type {
  Ticket,
  TicketDetailResponse,
  TicketListQuery,
  TicketListResponse,
  TimelineEntry,
} from "@triagecam/contracts";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import * as z from "zod";

import { db, schema } from "../db/client.ts";
import { publish, ticketChanged, worklistChanged } from "./events.ts";
import { flagsToWire, ticketFlags } from "./flags.ts";
import { ApiError } from "./http.ts";
import { decodeCursor, encodeCursor, takePage } from "./pagination.ts";
import type { TicketRow } from "./serialize.ts";
import { hasSummary, iso, toSitting, toTicket } from "./serialize.ts";
import { syncTicket, ticketHandoff } from "./trend/engine.ts";
import { partialScore } from "./trend/rules.ts";
import { historyState } from "./worklist.ts";

async function enrolledTicketIds(ticketIds: string[]): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ ticketId: schema.faceEmbeddings.ticketId })
    .from(schema.faceEmbeddings)
    .where(inArray(schema.faceEmbeddings.ticketId, ticketIds));
  return new Set(rows.map((row) => row.ticketId));
}

export async function ticketToWire(row: TicketRow): Promise<Ticket> {
  return toTicket(row, (await enrolledTicketIds([row.id])).has(row.id));
}

export async function findTicket(number: number): Promise<TicketRow> {
  const [row] = await db.select().from(schema.tickets).where(eq(schema.tickets.number, number)).limit(1);
  if (!row) throw new ApiError("not_found", `There is no ticket ${number}`);
  return row;
}

/** The ticket, refused with ticket_discharged unless it is still waiting. */
export async function findWaitingTicket(number: number): Promise<TicketRow> {
  const row = await findTicket(number);
  if (row.status !== "waiting") throw new ApiError("ticket_discharged", `Ticket ${number} has been discharged`);
  return row;
}

export async function createTicket(faceOptIn: boolean): Promise<Ticket> {
  const [row] = await db.insert(schema.tickets).values({ faceOptIn }).returning();
  if (!row) throw new Error("The ticket was not created");
  ticketChanged(row.number);
  worklistChanged();
  return toTicket(row, false);
}

export async function listTickets(query: TicketListQuery): Promise<TicketListResponse> {
  const conditions: (SQL | undefined)[] = [];
  if (query.status !== "all") conditions.push(eq(schema.tickets.status, query.status));
  if (query.cursor) {
    const before = z.int().positive().safeParse(decodeCursor(query.cursor));
    if (!before.success) throw new ApiError("invalid_request", "The cursor is not valid");
    conditions.push(lt(schema.tickets.number, before.data));
  }
  const rows = await db
    .select()
    .from(schema.tickets)
    .where(and(...conditions))
    .orderBy(desc(schema.tickets.number))
    .limit(query.limit + 1);
  const { items, last } = takePage(rows, query.limit);
  const enrolled = await enrolledTicketIds(items.map((row) => row.id));
  return {
    items: items.map((row) => toTicket(row, enrolled.has(row.id))),
    nextCursor: last ? encodeCursor(last.number) : null,
  };
}

export async function deleteFaceEmbeddings(ticketId: string): Promise<void> {
  await db.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.ticketId, ticketId));
}

/** Withdrawing the opt-in deletes the stored embedding. */
export async function updateTicket(number: number, faceOptIn: boolean): Promise<Ticket> {
  const ticket = await findWaitingTicket(number);
  const [row] = await db.update(schema.tickets).set({ faceOptIn }).where(eq(schema.tickets.id, ticket.id)).returning();
  if (!row) throw new Error("The ticket was not updated");
  if (!faceOptIn) await deleteFaceEmbeddings(ticket.id);
  ticketChanged(number);
  return ticketToWire(row);
}

/** Sets the status, closes open flags and deletes face embeddings. Safe to call twice. */
export async function dischargeTicket(number: number): Promise<Ticket> {
  const ticket = await findTicket(number);
  if (ticket.status === "discharged") return toTicket(ticket, false);

  const now = new Date();
  const { row, closed } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tickets)
      .set({ status: "discharged", dischargedAt: now })
      .where(eq(schema.tickets.id, ticket.id))
      .returning();
    const closedFlags = await tx
      .update(schema.flags)
      .set({ closedAt: now })
      .where(and(eq(schema.flags.ticketId, ticket.id), isNull(schema.flags.closedAt)))
      .returning();
    await tx
      .update(schema.sittings)
      .set({ endedAt: now })
      .where(and(eq(schema.sittings.ticketId, ticket.id), isNull(schema.sittings.endedAt)));
    await tx.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.ticketId, ticket.id));
    return { row: updated, closed: closedFlags };
  });
  if (!row) throw new Error("The ticket was not discharged");

  for (const flag of await flagsToWire(closed.map((flag) => ({ flag, ticketNumber: number })))) {
    publish({ type: "flag_closed", flag });
  }
  ticketChanged(number);
  worklistChanged();
  return toTicket(row, false);
}

export async function ticketDetail(number: number): Promise<TicketDetailResponse> {
  const ticket = await findTicket(number);
  const history = await syncTicket(ticket);
  const { snapshot } = history;
  const { rows: flagRows, flags } = await ticketFlags(ticket.id);
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

  const timeline: TimelineEntry[] = [{ type: "created", at: iso(ticket.createdAt) }];
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
    timeline.push({ type: "flag_opened", at: flag.openedAt, flagId: flag.id, rule: flag.rule, handoff: flag.handoff });
    if (flag.closedAt) timeline.push({ type: "flag_closed", at: flag.closedAt, flagId: flag.id, rule: flag.rule });
  }
  for (const acknowledgement of acknowledgements) {
    timeline.push({
      type: "flag_acknowledged",
      at: iso(acknowledgement.at),
      flagId: acknowledgement.flagId,
      by: acknowledgement.by,
    });
  }
  if (ticket.dischargedAt) timeline.push({ type: "discharged", at: iso(ticket.dischargedAt) });
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  const baseline = history.sittings.find((sitting) => sitting.id === snapshot.baseline?.id);
  return {
    ticket: await ticketToWire(ticket),
    state: ticket.status === "waiting" ? historyState(history) : null,
    baseline: baseline ? toSitting(baseline, number) : null,
    sittings: history.sittings.map((sitting) => toSitting(sitting, number)),
    flags,
    timeline,
    handoff: ticketHandoff(number, snapshot),
  };
}
