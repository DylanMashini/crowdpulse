import { type Flag, patientLabel } from "@triagecam/contracts";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { env } from "./env.ts";

type PushReceipt = { status: "ok" | "error"; message?: string; details?: { error?: string } };

const title = (flag: Flag) =>
  `${flag.rule === "overdue" ? "Overdue" : "Trend flag"}: ${patientLabel(flag.patient)}`;

// Advisory lock class for the cool-down, apart from the one that guards a patient's flags
// (FLAG_LOCK in trend/engine.ts), so a push never waits on a sitting being scored.
const PUSH_LOCK = 7402;

/**
 * Takes the patient's push slot for this flag: stamps the flag as notified at `now` and answers
 * true, unless a push for the same patient was already stamped inside the cool-down.
 *
 * Reading the cool-down and then writing it lets two callers both read "nothing recent" and
 * both send. That happens whenever two server processes overlap, which is every deploy, and
 * the flags of one patient are different rows, so a condition on the update alone does not
 * stop it either. The advisory lock on the patient makes the check and the stamp one step: the
 * second caller waits for the first to commit and then sees its stamp.
 */
export async function claimPush(flagId: string, patientId: string, cooldownMin: number, now: Date = new Date()): Promise<boolean> {
  const cooldownStart = new Date(now.getTime() - cooldownMin * 60_000).toISOString();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PUSH_LOCK}, hashtext(${patientId}))`);
    const claimed = await tx
      .update(schema.flags)
      .set({ lastNotifiedAt: now })
      .where(
        and(
          eq(schema.flags.id, flagId),
          sql`not exists (
            select 1 from flags as recent
            where recent.patient_id = ${patientId} and recent.last_notified_at > ${cooldownStart}::timestamptz
          )`,
        ),
      )
      .returning({ id: schema.flags.id });
    return claimed.length > 0;
  });
}

/**
 * One push per flag episode to every nurse device with a token, unless a push for the same
 * patient went out inside the cool-down. Never throws: a failed push is logged, and the flag
 * is in the worklist either way.
 */
export async function notifyFlagOpened(flag: Flag, patientId: string, cooldownMin: number): Promise<void> {
  try {
    const devices = await db
      .select({ id: schema.devices.id, token: schema.devices.expoPushToken })
      .from(schema.devices)
      .where(and(eq(schema.devices.role, "nurse"), isNotNull(schema.devices.expoPushToken)));
    if (devices.length === 0) return;

    if (!(await claimPush(flag.id, patientId, cooldownMin))) return;

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
