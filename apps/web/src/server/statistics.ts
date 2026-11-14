import type { Statistics, TicketStatistics, TileState } from "@triagecam/contracts";
import { and, asc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { hasSummary, iso } from "./serialize.ts";
import { AGREEMENT_BPM, agreement, mean, median, type Pair, pairReadings } from "./stats/agreement.ts";
import { syncWaitingTickets } from "./trend/engine.ts";
import { historyState } from "./worklist.ts";

const HOUR_MS = 3_600_000;

function startOfLocalDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Pilot statistics for sittings started in [from, to). Sittings from the JavaScript stub
 * measure nothing and are left out of every number.
 */
export async function statistics(range: { from?: string; to?: string }): Promise<Statistics> {
  const now = new Date();
  const to = range.to ? new Date(range.to) : now;
  const from = range.from ? new Date(range.from) : startOfLocalDay(to);

  const [tickets, sittings, flags, openFlags, histories] = await Promise.all([
    db.select().from(schema.tickets).where(lt(schema.tickets.createdAt, to)),
    db
      .select({ sitting: schema.sittings, ticketNumber: schema.tickets.number })
      .from(schema.sittings)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.sittings.ticketId))
      .where(and(gte(schema.sittings.startedAt, from), lt(schema.sittings.startedAt, to), ne(schema.sittings.source, "stub")))
      .orderBy(asc(schema.sittings.startedAt)),
    db.select().from(schema.flags).where(and(gte(schema.flags.openedAt, from), lt(schema.flags.openedAt, to))),
    db.$count(schema.flags, isNull(schema.flags.closedAt)),
    syncWaitingTickets({ now }),
  ]);

  const sittingIds = sittings.map((row) => row.sitting.id);
  const flagIds = flags.map((flag) => flag.id);
  const [readings, references, acknowledgements] = await Promise.all([
    sittingIds.length === 0
      ? []
      : db
          .select({ sittingId: schema.readings.sittingId, t: schema.readings.t, heartRate: schema.readings.heartRate })
          .from(schema.readings)
          .where(and(inArray(schema.readings.sittingId, sittingIds), eq(schema.readings.state, "valid"))),
    sittingIds.length === 0
      ? []
      : db
          .select({
            sittingId: schema.referenceReadings.sittingId,
            t: schema.referenceReadings.t,
            heartRate: schema.referenceReadings.heartRate,
          })
          .from(schema.referenceReadings)
          .where(inArray(schema.referenceReadings.sittingId, sittingIds)),
    flagIds.length === 0
      ? []
      : db
          .select({ flagId: schema.acknowledgements.flagId, at: schema.acknowledgements.at })
          .from(schema.acknowledgements)
          .where(inArray(schema.acknowledgements.flagId, flagIds))
          .orderBy(asc(schema.acknowledgements.at)),
  ]);

  const samples = (rows: { sittingId: string; t: Date; heartRate: number | null }[], sittingId: string) =>
    rows.flatMap((row) =>
      row.sittingId === sittingId && row.heartRate !== null ? [{ t: row.t.getTime(), heartRate: row.heartRate }] : [],
    );

  const allPairs: Pair[] = [];
  const perTicket = new Map<number, { pairs: Pair[]; sittings: number; coverage: number[] }>();
  const finished = sittings.filter((row) => hasSummary(row.sitting));
  let sittingsWithReference = 0;
  let finishedWithReference = 0;
  let accurate = 0;

  for (const { sitting, ticketNumber } of sittings) {
    const reference = samples(references, sitting.id);
    const pairs = pairReadings(samples(readings, sitting.id), reference);
    allPairs.push(...pairs);

    const ticket = perTicket.get(ticketNumber) ?? { pairs: [], sittings: 0, coverage: [] };
    ticket.pairs.push(...pairs);
    ticket.sittings += 1;
    if (hasSummary(sitting)) ticket.coverage.push(sitting.heartRateCoverage ?? 0);
    perTicket.set(ticketNumber, ticket);

    const referenceMean = mean(reference.map((sample) => sample.heartRate));
    if (referenceMean === null) continue;
    sittingsWithReference += 1;
    if (!hasSummary(sitting)) continue;
    finishedWithReference += 1;
    if (sitting.heartRate !== null && Math.abs(sitting.heartRate - referenceMean) <= AGREEMENT_BPM) accurate += 1;
  }

  const personHours =
    tickets.reduce((sum, ticket) => {
      const start = Math.max(ticket.createdAt.getTime(), from.getTime());
      const end = Math.min((ticket.dischargedAt ?? now).getTime(), to.getTime());
      return sum + Math.max(0, end - start);
    }, 0) / HOUR_MS;

  const firstAcknowledgement = new Map<string, Date>();
  for (const row of acknowledgements) {
    if (!firstAcknowledgement.has(row.flagId)) firstAcknowledgement.set(row.flagId, row.at);
  }
  const minutesToAcknowledge = flags.flatMap((flag) => {
    const at = firstAcknowledgement.get(flag.id);
    return at ? [Math.max(0, at.getTime() - flag.openedAt.getTime()) / 60_000] : [];
  });

  const tileStates: Record<TileState, number> = { observed: 0, flag: 0, overdue: 0, "no-reading": 0 };
  for (const history of histories) tileStates[historyState(history)] += 1;

  const dropouts = finished.map((row) => row.sitting.longestDropoutSeconds ?? 0);

  return {
    generatedAt: iso(now),
    from: iso(from),
    to: iso(to),
    totals: {
      ticketsWaiting: tickets.filter((ticket) => !ticket.dischargedAt || ticket.dischargedAt >= to).length,
      ticketsDischarged: tickets.filter(
        (ticket) => ticket.dischargedAt && ticket.dischargedAt >= from && ticket.dischargedAt < to,
      ).length,
      sittings: sittings.length,
      sittingsWithReference,
      openFlags,
      personHours,
    },
    tileStates,
    heartRate: agreement(allPairs),
    sittings: {
      attempted: finished.length,
      withReading: finished.filter((row) => row.sitting.heartRate !== null).length,
      accurateAcceptedShare: finishedWithReference === 0 ? null : accurate / finishedWithReference,
      meanCoverage: mean(finished.map((row) => row.sitting.heartRateCoverage ?? 0)),
      medianTimeToFirstReadingSeconds: median(
        finished.flatMap((row) => row.sitting.timeToFirstReadingSeconds ?? []),
      ),
      longestDropoutSeconds: dropouts.length === 0 ? null : Math.max(...dropouts),
    },
    flags: {
      episodes: flags.length,
      episodesPerPersonHour: personHours > 0 ? flags.length / personHours : null,
      acknowledged: minutesToAcknowledge.length,
      medianMinutesToAcknowledge: median(minutesToAcknowledge),
    },
    perTicket: [...perTicket.entries()]
      .sort(([a], [b]) => a - b)
      .map(
        ([ticketNumber, ticket]): TicketStatistics => ({
          ticketNumber,
          sittings: ticket.sittings,
          coverage: mean(ticket.coverage),
          ...agreement(ticket.pairs),
        }),
      ),
  };
}
