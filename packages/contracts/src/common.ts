import * as z from 'zod';

/** ISO 8601 in UTC with a trailing Z, for example 2026-11-14T03:21:07.512Z. */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** The short, sequential visit number. Addresses a patient in every URL; the name leads on screen. */
export const PatientNumber = z.int().positive();
export type PatientNumber = z.infer<typeof PatientNumber>;

/**
 * Enough of a patient to show who a row is about: the name and the face. Carried by every
 * payload that concerns one patient (worklist items, flags, stream events).
 */
export const PatientRef = z.object({
  number: PatientNumber,
  /** Null until staff have typed it at intake. Show patientLabel() instead of a blank. */
  name: z.string().nullable(),
  /** Null when there is no profile photo: show initials. Otherwise the `v` of the photo route. */
  photoUpdatedAt: Timestamp.nullable(),
});
export type PatientRef = z.infer<typeof PatientRef>;

/** What to call a patient: their name, or "Patient 14" until it has been entered. */
export const patientLabel = (patient: { number: number; name: string | null }): string =>
  patient.name?.trim() || `Patient ${patient.number}`;

/** A share or score from 0 to 1. */
export const Unit = z.number().min(0).max(1);

export const ErrorCode = z.enum([
  'invalid_request',
  'unauthenticated',
  'invalid_credentials',
  'email_not_verified',
  'forbidden',
  'not_found',
  'conflict',
  'email_taken',
  'token_invalid',
  'patient_discharged',
  'sitting_finished',
  'face_not_opted_in',
  'no_face_detected',
  'face_unavailable',
  'payload_too_large',
  'rate_limited',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** HTTP status for each error code. */
export const errorStatus: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  email_not_verified: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  email_taken: 409,
  token_invalid: 410,
  patient_discharged: 409,
  sitting_finished: 409,
  face_not_opted_in: 403,
  no_face_detected: 422,
  /** The face models are not installed on the server. Ask for the patient number instead. */
  face_unavailable: 503,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
};

/** Body of every non-2xx response. */
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    /** One plain sentence, safe to show to staff. */
    message: z.string(),
    /** For invalid_request: the zod issues. */
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Query string of every list route. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque value from a previous page's nextCursor. */
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    /** Null on the last page. */
    nextCursor: z.string().nullable(),
  });

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;
