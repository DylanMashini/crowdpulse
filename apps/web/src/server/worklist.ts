import type { WorklistItem, WorklistResponse } from "@triagecam/contracts";

import { flagsToWire } from "./flags.ts";
import { iso, isoOrNull } from "./serialize.ts";
import { getSettings } from "./settings.ts";
import { syncWaitingTickets, ticketHandoff, type TicketHistory } from "./trend/engine.ts";
import { rankTickets, tileState } from "./trend/rank.ts";

export const historyState = (history: TicketHistory) =>
  tileState({
    trendFlagOpen: history.openFlags.some((flag) => flag.rule !== "overdue"),
    latestGaveNoReading: history.snapshot.latestGaveNoReading,
    overdueFlagOpen: history.openFlags.some((flag) => flag.rule === "overdue"),
  });

/** Every waiting ticket once, in rank order. Brings the overdue flags up to date first. */
export async function buildWorklist(now = new Date()): Promise<WorklistResponse> {
  const [histories, settings] = await Promise.all([syncWaitingTickets({ now }), getSettings()]);
  const flags = await flagsToWire(
    histories.flatMap((history) => history.openFlags.map((flag) => ({ flag, ticketNumber: history.ticket.number }))),
  );

  const ranked = rankTickets(
    histories.map((history) => {
      const { ticket, snapshot } = history;
      const firstTrendFlag = history.openFlags
        .filter((flag) => flag.rule !== "overdue")
        .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())[0];
      return {
        ticketNumber: ticket.number,
        state: historyState(history),
        score: snapshot.score,
        flagOpenedAt: firstTrendFlag?.openedAt ?? null,
        unobservedSince: snapshot.lastObservedAt ?? ticket.createdAt,
        history,
      };
    }),
  );

  const items = ranked.map(({ history, state }, index): WorklistItem => {
    const { ticket, snapshot } = history;
    const openIds = new Set(history.openFlags.map((flag) => flag.id));
    return {
      rank: index + 1,
      ticketNumber: ticket.number,
      state,
      waitingSince: iso(ticket.createdAt),
      lastObservedAt: isoOrNull(snapshot.lastObservedAt),
      minutesSinceObserved: snapshot.minutesSinceObserved,
      pulse: snapshot.pulse,
      breathing: snapshot.breathing,
      score: snapshot.score,
      scoreAtCheckIn: snapshot.scoreAtCheckIn,
      parametersMeasured: snapshot.parametersMeasured,
      source: snapshot.source,
      flags: flags.filter((flag) => openIds.has(flag.id)),
      handoff: ticketHandoff(ticket.number, snapshot),
      sittingInProgress: snapshot.sittingInProgress,
    };
  });

  return { generatedAt: iso(now), recheckIntervalMin: settings.recheckIntervalMin, items };
}
