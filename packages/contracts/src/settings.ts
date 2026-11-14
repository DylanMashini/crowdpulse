import * as z from 'zod';

import { Timestamp, Unit } from './common.ts';

export const Settings = z.object({
  /** A waiting patient is overdue after this many minutes without a valid observation. */
  recheckIntervalMin: z.number().min(1).max(240),
  /** Flag when pulse moves this many bpm from check-in on two consecutive observations. */
  pulseDeltaBpm: z.number().min(1).max(100),
  /** Flag when breathing moves this many breaths per minute from check-in, likewise. */
  breathingDeltaPerMin: z.number().min(1).max(30),
  scoreRiseEnabled: z.boolean(),
  baselineShiftEnabled: z.boolean(),
  overdueEnabled: z.boolean(),
  /** Minimum minutes between two push notifications for the same patient. */
  notifyCooldownMin: z.number().min(0).max(240),
  /** A face match below this confidence asks for the patient number instead. */
  faceMatchMinConfidence: Unit,
});
export type Settings = z.infer<typeof Settings>;

export const defaultSettings: Settings = {
  recheckIntervalMin: 30,
  pulseDeltaBpm: 20,
  breathingDeltaPerMin: 6,
  scoreRiseEnabled: true,
  baselineShiftEnabled: true,
  overdueEnabled: true,
  notifyCooldownMin: 10,
  faceMatchMinConfidence: 0.8,
};

export const UpdateSettingsRequest = Settings.partial();
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

export const SettingsResponse = z.object({ settings: Settings, updatedAt: Timestamp });
export type SettingsResponse = z.infer<typeof SettingsResponse>;
