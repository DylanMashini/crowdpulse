import * as z from 'zod';

import { Id, PatientNumber, Timestamp } from './common.ts';
import { CaptureSource } from './signal.ts';
import { Sitting, SittingKind } from './sittings.ts';
import { Flag, FlagRule, Score, TileState } from './worklist.ts';

export const PatientStatus = z.enum(['waiting', 'discharged']);
export type PatientStatus = z.infer<typeof PatientStatus>;

export const PatientSex = z.enum(['female', 'male', 'other']);
export type PatientSex = z.infer<typeof PatientSex>;

/** A calendar date with no time or zone: 1987-03-09. */
export const CalendarDate = z.iso.date();
export type CalendarDate = z.infer<typeof CalendarDate>;

/** The earliest date of birth the intake form takes. */
export const EARLIEST_DATE_OF_BIRTH = '1900-01-01';

/**
 * A date of birth as a request accepts it: not before 1900 and not after today. "Today" allows
 * one day of slack, because the dashboard's calendar day may be ahead of the server's.
 */
export const DateOfBirth = CalendarDate.refine(
  (value) => value >= EARLIEST_DATE_OF_BIRTH && value <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  { error: `The date of birth must be between ${EARLIEST_DATE_OF_BIRTH} and today` },
);

export const INTAKE_LIMITS = { name: 120, reasonForVisit: 280, allergies: 280, notes: 2000 } as const;

/** Free text typed at intake: trimmed, and an empty box is stored as null. */
const intakeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

/**
 * What staff type on the check-in page while the first sitting runs. Every field is nullable:
 * a patient exists from the moment intake starts, before anyone has typed a name.
 */
export const PatientIntake = z.object({
  name: z.string().nullable(),
  dateOfBirth: CalendarDate.nullable(),
  sex: PatientSex.nullable(),
  /** The chief complaint. */
  reasonForVisit: z.string().nullable(),
  /** 0 (none) to 10 (worst imaginable), as the patient reports it. */
  painScore: z.int().min(0).max(10).nullable(),
  allergies: z.string().nullable(),
  /** Symptoms, history, medication: anything else worth knowing. */
  notes: z.string().nullable(),
});
export type PatientIntake = z.infer<typeof PatientIntake>;

/** The intake fields as a request accepts them. */
const IntakeInput = z.object({
  name: intakeText(INTAKE_LIMITS.name),
  dateOfBirth: DateOfBirth.nullable(),
  sex: PatientSex.nullable(),
  reasonForVisit: intakeText(INTAKE_LIMITS.reasonForVisit),
  painScore: z.int().min(0).max(10).nullable(),
  allergies: intakeText(INTAKE_LIMITS.allergies),
  notes: intakeText(INTAKE_LIMITS.notes),
});

export const Patient = PatientIntake.extend({
  /** The short visit number: sequential, never reused. Addresses the patient in every URL. */
  number: PatientNumber,
  status: PatientStatus,
  /** When intake started. */
  createdAt: Timestamp,
  dischargedAt: Timestamp.nullable(),
  /** When staff marked the intake form complete; null while it is still being filled in. */
  intakeCompletedAt: Timestamp.nullable(),
  /**
   * When the profile photo was last stored; null when there is none. Use it as the `v` query
   * of the photo route so a new photo is never served from cache.
   */
  photoUpdatedAt: Timestamp.nullable(),
  /** The patient agreed to face match at check-in. */
  faceOptIn: z.boolean(),
  /** A face embedding is stored for this patient. */
  faceEnrolled: z.boolean(),
});
export type Patient = z.infer<typeof Patient>;

/** Intake may start with nothing: the phone creates the patient, the check-in page names them. */
export const CreatePatientRequest = IntakeInput.partial().extend({ faceOptIn: z.boolean().default(false) });
export type CreatePatientRequest = z.infer<typeof CreatePatientRequest>;

/**
 * Any subset. A field that is left out keeps its value; null clears it. Setting faceOptIn to
 * false deletes the stored embedding. intakeComplete stamps or clears intakeCompletedAt.
 */
export const UpdatePatientRequest = IntakeInput.partial().extend({
  faceOptIn: z.boolean().optional(),
  intakeComplete: z.boolean().optional(),
});
export type UpdatePatientRequest = z.infer<typeof UpdatePatientRequest>;

/** The profile photo as the phone sends it: the face crop from the capture module. */
export const PatientPhotoRequest = z.object({
  /** JPEG, base64 without a data: prefix. */
  jpegBase64: z.string().min(1).max(400_000),
  /**
   * False (the default) only fills a gap: the crop is dropped when the patient already has a
   * photo, or when staff removed it. True replaces whatever is there.
   */
  replace: z.boolean().default(false),
});
export type PatientPhotoRequest = z.infer<typeof PatientPhotoRequest>;

/** Takes the photo from the frame a camera phone is sending to the live view right now. */
export const CapturePatientPhotoRequest = z.object({ deviceId: Id });
export type CapturePatientPhotoRequest = z.infer<typeof CapturePatientPhotoRequest>;

/** Stored photos are square JPEGs of this many pixels a side. */
export const PATIENT_PHOTO_SIZE = 384;

export const PatientResponse = z.object({ patient: Patient });
export type PatientResponse = z.infer<typeof PatientResponse>;

export const PatientListQuery = z.object({
  status: z.enum(['waiting', 'discharged', 'all']).default('waiting'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type PatientListQuery = z.infer<typeof PatientListQuery>;
export const PatientListResponse = z.object({ items: z.array(Patient), nextCursor: z.string().nullable() });
export type PatientListResponse = z.infer<typeof PatientListResponse>;

/** One row of the patient timeline, newest first. */
export const TimelineEntry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created'), at: Timestamp }),
  z.object({
    type: z.literal('sitting'),
    /** When the sitting ended. */
    at: Timestamp,
    sittingId: Id,
    kind: SittingKind,
    source: CaptureSource,
    /** bpm; null is "No reading". */
    heartRate: z.number().nullable(),
    /** Breaths per minute; null is "No reading". */
    breathingRate: z.number().nullable(),
    score: Score.nullable(),
  }),
  /** `alertId` is the flag's (`Flag.alertId`): flags of one alert open in the same instant. */
  z.object({ type: z.literal('flag_opened'), at: Timestamp, flagId: Id, rule: FlagRule, handoff: z.string(), alertId: z.string().min(1) }),
  z.object({ type: z.literal('flag_acknowledged'), at: Timestamp, flagId: Id, by: z.string() }),
  z.object({ type: z.literal('flag_closed'), at: Timestamp, flagId: Id, rule: FlagRule, alertId: z.string().min(1) }),
  z.object({ type: z.literal('discharged'), at: Timestamp }),
]);
export type TimelineEntry = z.infer<typeof TimelineEntry>;

/**
 * The timeline as a nurse reads it: one row for an alert opening and one for it closing, not
 * one per rule. Where flags of one alert opened (or closed) in the same instant, the first of
 * those entries is kept and the rest are left out. Order is unchanged. Flags of an alert that
 * closed at different times keep a row each.
 */
export function timelineByAlert(timeline: TimelineEntry[]): TimelineEntry[] {
  const told = new Set<string>();
  return timeline.filter((entry) => {
    if (entry.type !== 'flag_opened' && entry.type !== 'flag_closed') return true;
    const key = `${entry.type} ${entry.alertId} ${entry.at}`;
    if (told.has(key)) return false;
    told.add(key);
    return true;
  });
}

export const PatientDetailResponse = z.object({
  patient: Patient,
  /** Null once discharged. */
  state: TileState.nullable(),
  /** The check-in sitting, if it has finished. Trends are measured against it. */
  baseline: Sitting.nullable(),
  /** Every sitting, oldest first. */
  sittings: z.array(Sitting),
  /** Open and closed flags, newest first. */
  flags: z.array(Flag),
  timeline: z.array(TimelineEntry),
  /** The templated handoff sentence for the patient as it stands. */
  handoff: z.string(),
});
export type PatientDetailResponse = z.infer<typeof PatientDetailResponse>;
