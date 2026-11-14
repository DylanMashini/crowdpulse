import type { Flag, FlagRule, Settings } from "@triagecam/contracts";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { publish, worklistChanged } from "../events.ts";
import { flagToWire } from "../flags.ts";
import { notifyFlagOpened } from "../push.ts";
import type { FlagRow, SittingRow, TicketRow } from "../serialize.ts";
import { hasSummary } from "../serialize.ts";
import { getSettings } from "../settings.ts";
import { handoffSentence } from "./handoff.ts";
import { type SittingFacts, snapshotTicket, type TicketSnapshot } from "./rules.ts";

/** Trend rules first: this is also the order flags are listed in. */
const RULES: FlagRule[] = ["score_rise", "baseline_shift", "overdue"];

export type TicketHistory = {
  ticket: TicketRow;
  /** Oldest first. */
  sittings: SittingRow[];
  snapshot: TicketSnapshot;
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

/** The handoff sentence for a ticket as it stands: check-in against the latest observation. */
export const ticketHandoff = (ticketNumber: number, snapshot: TicketSnapshot): string =>
  handoffSentence({
    ticketNumber,
    pulse: snapshot.flagDetail.pulse,
    breathing: snapshot.flagDetail.breathing,
    minutesLater: snapshot.minutesToLatestObservation,
    minutesSinceObserved: snapshot.minutesSinceObserved,
    minutesWaiting: snapshot.minutesWaiting,
    latestGaveNoReading: snapshot.latestGaveNoReading,
  });

async function loadHistories(tickets: TicketRow[], settings: Settings, now: Date): Promise<TicketHistory[]> {
  if (tickets.length === 0) return [];
  const ticketIds = tickets.map((ticket) => ticket.id);
  const [sittings, openFlags] = await Promise.all([
    db
      .select()
      .from(schema.sittings)
      .where(inArray(schema.sittings.ticketId, ticketIds))
      .orderBy(asc(schema.sittings.startedAt)),
    db
      .select()
      .from(schema.flags)
      .where(and(inArray(schema.flags.ticketId, ticketIds), isNull(schema.flags.closedAt))),
  ]);
  return tickets.map((ticket) => {
    const own = sittings.filter((sitting) => sitting.ticketId === ticket.id);
    return {
      ticket,
      sittings: own,
      snapshot: snapshotTicket(own.map(sittingFacts), ticket.createdAt, settings, now),
      openFlags: openFlags
        .filter((flag) => flag.ticketId === ticket.id)
        .sort((a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule)),
    };
  });
}

/** Opens and closes one ticket's flags to match its rules. Returns the flags that opened. */
async function applyRules(history: TicketHistory, now: Date): Promise<{ opened: Flag[]; changed: boolean }> {
  const { ticket, snapshot } = history;
  const opened: Flag[] = [];
  let changed = false;

  for (const rule of RULES) {
    const status = snapshot.rules[rule];
    const open = history.openFlags.find((flag) => flag.rule === rule);

    if (!open && status.met) {
      // The partial unique index allows one open flag per ticket and rule, so a concurrent
      // request that got there first makes this insert a no-op.
      const [row] = await db
        .insert(schema.flags)
        .values({
          ticketId: ticket.id,
          rule,
          openedAt: now,
          detail: { ...snapshot.flagDetail, handoff: ticketHandoff(ticket.number, snapshot) },
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      history.openFlags.push(row);
      const flag = await flagToWire(row, ticket.number);
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
      publish({ type: "flag_closed", flag: await flagToWire(row, ticket.number) });
      changed = true;
    }
  }
  history.openFlags.sort((a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
  return { opened, changed };
}

/** One after another, so the cool-down sees the push that went out just before. */
async function notifyInOrder(flags: Flag[], ticketId: string, cooldownMin: number): Promise<void> {
  for (const flag of flags) await notifyFlagOpened(flag, ticketId, cooldownMin);
}

/**
 * Runs the trend rules for the given waiting tickets, opens and closes flags to match, and
 * returns each ticket's history with its flags as they now stand.
 */
export async function syncTickets(tickets: TicketRow[], options: SyncOptions = {}): Promise<TicketHistory[]> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const histories = await loadHistories(tickets, settings, now);
  let changed = false;
  for (const history of histories) {
    if (history.ticket.status !== "waiting") continue;
    const result = await applyRules(history, now);
    changed ||= result.changed;
    if (options.notify !== false && result.opened.length > 0) {
      // Not awaited: a slow or failed push must not hold up or fail the request.
      void notifyInOrder(result.opened, history.ticket.id, settings.notifyCooldownMin);
    }
  }
  if (changed) worklistChanged();
  return histories;
}

export async function syncWaitingTickets(options: SyncOptions = {}): Promise<TicketHistory[]> {
  const tickets = await db.select().from(schema.tickets).where(eq(schema.tickets.status, "waiting"));
  return syncTickets(tickets, options);
}

export async function syncTicket(ticket: TicketRow, options: SyncOptions = {}): Promise<TicketHistory> {
  const [history] = await syncTickets([ticket], options);
  return history as TicketHistory;
}
