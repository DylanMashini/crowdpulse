import type { Score, TileState } from "@triagecam/contracts";

export type StateInput = {
  /** A score_rise or baseline_shift flag is open. */
  trendFlagOpen: boolean;
  /** The latest finished sitting gave neither rate. */
  latestGaveNoReading: boolean;
  overdueFlagOpen: boolean;
};

/** The one state of a waiting ticket: the first that applies. */
export function tileState(input: StateInput): TileState {
  if (input.trendFlagOpen) return "flag";
  if (input.latestGaveNoReading) return "no-reading";
  if (input.overdueFlagOpen) return "overdue";
  return "observed";
}

export type Rankable = {
  ticketNumber: number;
  state: TileState;
  score: Score | null;
  /** When the earliest open trend flag opened; only read for state flag. */
  flagOpenedAt: Date | null;
  /** The last observation, or ticket creation when there has been none. */
  unobservedSince: Date;
};

const GROUP: Record<TileState, number> = { flag: 0, overdue: 1, "no-reading": 1, observed: 2 };

/**
 * Who to walk to first. Flagged tickets lead, higher score first and then the flag that
 * opened earliest. Overdue and no-reading tickets follow as one group, then observed
 * tickets, each ordered by the longest time without an observation.
 */
export function rankTickets<Item extends Rankable>(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const group = GROUP[a.state] - GROUP[b.state];
    if (group !== 0) return group;
    if (a.state === "flag") {
      const score = (b.score ?? -1) - (a.score ?? -1);
      if (score !== 0) return score;
      const opened = (a.flagOpenedAt?.getTime() ?? Infinity) - (b.flagOpenedAt?.getTime() ?? Infinity);
      if (opened !== 0) return opened;
    }
    return a.unobservedSince.getTime() - b.unobservedSince.getTime() || a.ticketNumber - b.ticketNumber;
  });
}
