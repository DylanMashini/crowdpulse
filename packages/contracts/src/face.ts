import * as z from 'zod';

import { TicketNumber, Unit } from './common.ts';

/** A JPEG of the face only, base64 without a data: prefix. At most 512 px on the long side. */
export const FaceCrop = z.object({
  jpegBase64: z.string().min(1).max(400_000),
});
export type FaceCrop = z.infer<typeof FaceCrop>;

export const EnrolFaceRequest = FaceCrop;
export type EnrolFaceRequest = z.infer<typeof EnrolFaceRequest>;
export const EnrolFaceResponse = z.object({
  ticketNumber: TicketNumber,
  /** Name of the embedding model, for example "sface-2021dec". */
  model: z.string(),
});
export type EnrolFaceResponse = z.infer<typeof EnrolFaceResponse>;

export const MatchFaceRequest = FaceCrop;
export type MatchFaceRequest = z.infer<typeof MatchFaceRequest>;

export const MatchFaceResponse = z.object({
  /**
   * matched: ticketNumber is set and confidence met the threshold.
   * low_confidence: someone resembles the crop but not surely; ask for the ticket number.
   * no_match: nobody enrolled resembles the crop.
   */
  outcome: z.enum(['matched', 'low_confidence', 'no_match']),
  /** Set only when outcome is matched. A low-confidence guess is never disclosed. */
  ticketNumber: TicketNumber.nullable(),
  /** 0 to 1 for the best candidate; null for no_match. */
  confidence: Unit.nullable(),
});
export type MatchFaceResponse = z.infer<typeof MatchFaceResponse>;
