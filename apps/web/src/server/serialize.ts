import type { Device, Estimate, EstimateReason, Sitting, StoredReading, Ticket, User } from "@triagecam/contracts";

import type { schema } from "../db/client.ts";

export type UserRow = typeof schema.users.$inferSelect;
export type DeviceRow = typeof schema.devices.$inferSelect;
export type TicketRow = typeof schema.tickets.$inferSelect;
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

export const toTicket = (row: TicketRow, faceEnrolled: boolean): Ticket => ({
  number: row.number,
  status: row.status,
  createdAt: iso(row.createdAt),
  dischargedAt: isoOrNull(row.dischargedAt),
  faceOptIn: row.faceOptIn,
  faceEnrolled,
});

/** A sitting has a summary once it was finished by the phone; one that was abandoned has none. */
export const hasSummary = (row: SittingRow): boolean => row.durationSeconds !== null;

export const toSitting = (row: SittingRow, ticketNumber: number): Sitting => ({
  id: row.id,
  ticketNumber,
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
