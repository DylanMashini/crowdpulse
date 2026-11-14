import type { Device, Estimate, EstimateReason, Patient, PatientRef, Sitting, StoredReading, User } from "@triagecam/contracts";

import type { schema } from "../db/client.ts";

export type UserRow = typeof schema.users.$inferSelect;
export type DeviceRow = typeof schema.devices.$inferSelect;
export type PatientRow = typeof schema.patients.$inferSelect;
export type SittingRow = typeof schema.sittings.$inferSelect;
export type ReadingRow = typeof schema.readings.$inferSelect;
export type FlagRow = typeof schema.flags.$inferSelect;

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

export const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  emailVerified: row.emailVerifiedAt !== null,
  createdAt: iso(row.createdAt),
});

export const toDevice = (row: DeviceRow, liveAt: Date | null): Device => ({
  id: row.id,
  role: row.role,
  label: row.label,
  hasPushToken: row.expoPushToken !== null,
  lastSeenAt: iso(row.lastSeenAt),
  liveAt: isoOrNull(liveAt),
});

export const toPatientRef = (row: Pick<PatientRow, "number" | "name" | "photoUpdatedAt">): PatientRef => ({
  number: row.number,
  name: row.name,
  photoUpdatedAt: isoOrNull(row.photoUpdatedAt),
});

export const toPatient = (row: PatientRow, faceEnrolled: boolean): Patient => ({
  number: row.number,
  status: row.status,
  createdAt: iso(row.createdAt),
  dischargedAt: isoOrNull(row.dischargedAt),
  name: row.name,
  dateOfBirth: row.dateOfBirth,
  sex: row.sex,
  reasonForVisit: row.reasonForVisit,
  painScore: row.painScore,
  allergies: row.allergies,
  notes: row.notes,
  intakeCompletedAt: isoOrNull(row.intakeCompletedAt),
  photoUpdatedAt: isoOrNull(row.photoUpdatedAt),
  faceOptIn: row.faceOptIn,
  faceEnrolled,
});

/**
 * Whole years between a YYYY-MM-DD date of birth and now; null when the date is not known, or
 * lies in the future (a row saved before requests were checked).
 */
export function ageInYears(dateOfBirth: string | null, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const hadBirthday = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  const age = now.getFullYear() - year - (hadBirthday ? 0 : 1);
  return age < 0 ? null : age;
}

/** A sitting has a summary once it was finished by the phone; one that was abandoned has none. */
export const hasSummary = (row: SittingRow): boolean => row.durationSeconds !== null;

export const toSitting = (row: SittingRow, patientNumber: number): Sitting => ({
  id: row.id,
  patientNumber,
  deviceId: row.deviceId,
  kind: row.kind,
  source: row.source,
  startedAt: iso(row.startedAt),
  endedAt: isoOrNull(row.endedAt),
  clockOffsetMs: row.clockOffsetMs,
  summary: hasSummary(row)
    ? {
        durationSeconds: row.durationSeconds ?? 0,
        heartRate: { value: row.heartRate, coverage: row.heartRateCoverage ?? 0 },
        breathingRate: { value: row.breathingRate, coverage: row.breathingRateCoverage ?? 0 },
        rmssd: { value: row.rmssd, coverage: row.rmssdCoverage ?? 0 },
        sdnn: { value: row.sdnn, coverage: row.sdnnCoverage ?? 0 },
        timeToFirstReadingSeconds: row.timeToFirstReadingSeconds,
        longestDropoutSeconds: row.longestDropoutSeconds ?? 0,
        frameCount: row.frameCount ?? 0,
        droppedFrames: row.droppedFrames ?? 0,
      }
    : null,
});

const estimate = (
  value: number | null,
  state: Estimate["state"],
  reason: string | null,
  quality: number,
  coverage: number,
  ageMs: number | null,
): Estimate => ({ value, state, reason: reason as EstimateReason | null, quality, coverage, ageMs });

export const toStoredReading = (row: ReadingRow): StoredReading => ({
  t: iso(row.t),
  heartRate: estimate(row.heartRate, row.state, row.reason, row.quality, row.coverage, row.ageMs),
  breathingRate: estimate(
    row.breathingRate,
    row.breathingState,
    row.breathingReason,
    row.breathingQuality,
    row.breathingCoverage,
    row.breathingAgeMs,
  ),
});
