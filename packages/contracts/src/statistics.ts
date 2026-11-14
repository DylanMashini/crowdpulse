import * as z from 'zod';

import { TicketNumber, Timestamp, Unit } from './common.ts';
import { TileState } from './worklist.ts';

export const StatisticsQuery = z.object({
  /** Inclusive start; default is the start of the server's local day. */
  from: Timestamp.optional(),
  /** Exclusive end; default is now. */
  to: Timestamp.optional(),
});
export type StatisticsQuery = z.infer<typeof StatisticsQuery>;

/** Agreement between the camera estimate and the reference device. Null when nothing was paired. */
export const Agreement = z.object({
  /** Valid heart-rate readings with a reference sample within 1.5 s after clock correction. */
  pairedReadings: z.int().nonnegative(),
  meanAbsoluteErrorBpm: z.number().nonnegative().nullable(),
  /** Mean of estimate minus reference, in bpm. */
  biasBpm: z.number().nullable(),
  within5BpmShare: Unit.nullable(),
});
export type Agreement = z.infer<typeof Agreement>;

export const TicketStatistics = Agreement.extend({
  ticketNumber: TicketNumber,
  sittings: z.int().nonnegative(),
  /** Mean heart-rate coverage across the ticket's finished sittings. */
  coverage: Unit.nullable(),
});
export type TicketStatistics = z.infer<typeof TicketStatistics>;

export const Statistics = z.object({
  generatedAt: Timestamp,
  from: Timestamp,
  to: Timestamp,
  totals: z.object({
    ticketsWaiting: z.int().nonnegative(),
    ticketsDischarged: z.int().nonnegative(),
    sittings: z.int().nonnegative(),
    sittingsWithReference: z.int().nonnegative(),
    openFlags: z.int().nonnegative(),
    /** Sum over tickets of time spent waiting inside the range, in hours. */
    personHours: z.number().nonnegative(),
  }),
  /** Waiting tickets in each tile state at generatedAt. Not limited to the range. */
  tileStates: z.record(TileState, z.int().nonnegative()).optional(),
  heartRate: Agreement,
  sittings: z.object({
    /** Finished sittings in the range. */
    attempted: z.int().nonnegative(),
    /** Those whose summary has a heart rate. */
    withReading: z.int().nonnegative(),
    /** Of attempted sittings that have a reference: share whose summary heart rate is within
     *  5 bpm of the reference mean. A sitting with no reading counts as a miss. */
    accurateAcceptedShare: Unit.nullable(),
    meanCoverage: Unit.nullable(),
    medianTimeToFirstReadingSeconds: z.number().nonnegative().nullable(),
    longestDropoutSeconds: z.number().nonnegative().nullable(),
  }),
  flags: z.object({
    /** Flag episodes opened in the range. */
    episodes: z.int().nonnegative(),
    episodesPerPersonHour: z.number().nonnegative().nullable(),
    acknowledged: z.int().nonnegative(),
    medianMinutesToAcknowledge: z.number().nonnegative().nullable(),
  }),
  perTicket: z.array(TicketStatistics),
});
export type Statistics = z.infer<typeof Statistics>;
