import type { Device, RegisterDeviceRequest } from "@triagecam/contracts";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { ApiError } from "./http.ts";
import { cameraState, liveAt } from "./live.ts";
import type { DeviceRow } from "./serialize.ts";
import { toDevice } from "./serialize.ts";

const wire = (row: DeviceRow): Device =>
  row.role === "camera" ? toDevice(row, liveAt(row.id), cameraState(row.id)) : toDevice(row, null);

/** Creates a device, or updates the caller's own device when `id` is given. */
export async function registerDevice(userId: string, request: RegisterDeviceRequest): Promise<Device> {
  const { id, role, label, expoPushToken } = request;
  if (!id) {
    const [created] = await db
      .insert(schema.devices)
      .values({ userId, role, label, expoPushToken: expoPushToken ?? null, lastSeenAt: new Date() })
      .returning();
    if (!created) throw new Error("The device was not created");
    return wire(created);
  }
  const [updated] = await db
    .update(schema.devices)
    .set({ role, label, lastSeenAt: new Date(), ...(expoPushToken === undefined ? {} : { expoPushToken }) })
    .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, userId)))
    .returning();
  if (!updated) throw new ApiError("not_found", "There is no device of yours with that id");
  return wire(updated);
}

/** A phone reports several times a second; when it was last heard from is written this often. */
const SEEN_EVERY_MS = 20_000;
const globalForSeen = globalThis as typeof globalThis & { triagecamDeviceSeen?: Map<string, number> };
const seenAt = (globalForSeen.triagecamDeviceSeen ??= new Map());

/**
 * Notes that a camera phone is there, from its state reports, so "last seen" on the check-in
 * page is when it stopped reporting and not when it last registered. Returns at once.
 */
export function noteDeviceSeen(id: string, now = Date.now()): void {
  if (now - (seenAt.get(id) ?? 0) < SEEN_EVERY_MS) return;
  seenAt.set(id, now);
  db.update(schema.devices)
    .set({ lastSeenAt: new Date(now) })
    .where(eq(schema.devices.id, id))
    .catch((error) => console.error("[devices] Could not note that a phone was seen:", error));
}

export async function listDevices(): Promise<Device[]> {
  const rows = await db.select().from(schema.devices).orderBy(desc(schema.devices.lastSeenAt));
  return rows.map(wire);
}

export async function findDevice(id: string): Promise<DeviceRow> {
  const [row] = await db.select().from(schema.devices).where(eq(schema.devices.id, id)).limit(1);
  if (!row) throw new ApiError("not_found", "There is no device with that id");
  return row;
}
