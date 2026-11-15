import * as z from 'zod';

import { Id, Timestamp } from './common.ts';
import { CameraState } from './live.ts';

export const DeviceRole = z.enum(['camera', 'nurse']);
export type DeviceRole = z.infer<typeof DeviceRole>;

export const Device = z.object({
  id: Id,
  role: DeviceRole,
  label: z.string(),
  hasPushToken: z.boolean(),
  lastSeenAt: Timestamp,
  /** When this camera device last posted a live-view frame, if within the last 5 seconds. */
  liveAt: Timestamp.nullable(),
  /**
   * What a camera phone last said about itself, if within the last 4 seconds. Null for a nurse
   * device, a phone that is not in the camera role right now, and an app from before the field.
   */
  camera: CameraState.nullable().default(null),
});
export type Device = z.infer<typeof Device>;

/** Creates a device, or updates the caller's own device when `id` is given. */
export const RegisterDeviceRequest = z.object({
  id: Id.optional(),
  role: DeviceRole,
  /** Shown on the dashboard, for example "Front desk phone". */
  label: z.string().trim().min(1).max(60),
  /** ExponentPushToken[...]; null clears it. */
  expoPushToken: z.string().max(200).nullable().optional(),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;
export const DeviceResponse = z.object({ device: Device });
export type DeviceResponse = z.infer<typeof DeviceResponse>;

export const DeviceListResponse = z.object({ devices: z.array(Device) });
export type DeviceListResponse = z.infer<typeof DeviceListResponse>;
