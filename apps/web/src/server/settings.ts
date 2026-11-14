import type { Settings, SettingsResponse, UpdateSettingsRequest } from "@triagecam/contracts";
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.ts";

type SettingsRow = typeof schema.settings.$inferSelect;

const toSettings = (row: SettingsRow): Settings => ({
  recheckIntervalMin: row.recheckIntervalMin,
  pulseDeltaBpm: row.pulseDeltaBpm,
  breathingDeltaPerMin: row.breathingDeltaPerMin,
  scoreRiseEnabled: row.scoreRiseEnabled,
  baselineShiftEnabled: row.baselineShiftEnabled,
  overdueEnabled: row.overdueEnabled,
  notifyCooldownMin: row.notifyCooldownMin,
  faceMatchMinConfidence: row.faceMatchMinConfidence,
});

async function settingsRow(): Promise<SettingsRow> {
  const [existing] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  if (existing) return existing;
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  if (!created) throw new Error("The settings row is missing");
  return created;
}

export const getSettings = async (): Promise<Settings> => toSettings(await settingsRow());

export async function readSettings(): Promise<SettingsResponse> {
  const row = await settingsRow();
  return { settings: toSettings(row), updatedAt: row.updatedAt.toISOString() };
}

export async function updateSettings(changes: UpdateSettingsRequest): Promise<SettingsResponse> {
  await settingsRow();
  const [row] = await db
    .update(schema.settings)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(schema.settings.id, 1))
    .returning();
  if (!row) throw new Error("The settings row is missing");
  return { settings: toSettings(row), updatedAt: row.updatedAt.toISOString() };
}
