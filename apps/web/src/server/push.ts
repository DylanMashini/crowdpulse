import { type Flag, patientLabel } from "@triagecam/contracts";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { env } from "./env.ts";

type PushReceipt = { status: "ok" | "error"; message?: string; details?: { error?: string } };

const title = (flag: Flag) =>
  `${flag.rule === "overdue" ? "Overdue" : "Trend flag"}: ${patientLabel(flag.patient)}`;

/**
 * One push per flag episode to every nurse device with a token, unless a push for the same
 * patient went out inside the cool-down. Never throws: a failed push is logged, and the flag
 * is in the worklist either way.
 */
export async function notifyFlagOpened(flag: Flag, patientId: string, cooldownMin: number): Promise<void> {
  try {
    const now = new Date();
    const cooldownStart = new Date(now.getTime() - cooldownMin * 60_000);
    const [recent] = await db
      .select({ id: schema.flags.id })
      .from(schema.flags)
      .where(and(eq(schema.flags.patientId, patientId), gt(schema.flags.lastNotifiedAt, cooldownStart)))
      .limit(1);
    if (recent) return;

    const devices = await db
      .select({ id: schema.devices.id, token: schema.devices.expoPushToken })
      .from(schema.devices)
      .where(and(eq(schema.devices.role, "nurse"), isNotNull(schema.devices.expoPushToken)));
    if (devices.length === 0) return;

    await db.update(schema.flags).set({ lastNotifiedAt: now }).where(eq(schema.flags.id, flag.id));

    const { EXPO_PUSH_URL, EXPO_ACCESS_TOKEN } = env();
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(
        devices.map((device) => ({
          to: device.token,
          title: title(flag),
          body: flag.handoff,
          data: { flagId: flag.id, patientNumber: flag.patientNumber },
          sound: "default",
        })),
      ),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[push] Expo refused the push for flag ${flag.id}: HTTP ${response.status}`);
      return;
    }

    const { data } = (await response.json()) as { data?: PushReceipt[] };
    const unregistered: string[] = [];
    (data ?? []).forEach((receipt, index) => {
      if (receipt.status === "ok") return;
      console.error(`[push] Flag ${flag.id} was not delivered to a device: ${receipt.message ?? "unknown error"}`);
      const device = devices[index];
      if (receipt.details?.error === "DeviceNotRegistered" && device) unregistered.push(device.id);
    });
    if (unregistered.length > 0) {
      await db.update(schema.devices).set({ expoPushToken: null }).where(inArray(schema.devices.id, unregistered));
    }
  } catch (error) {
    console.error(`[push] The push for flag ${flag.id} failed:`, error);
  }
}
