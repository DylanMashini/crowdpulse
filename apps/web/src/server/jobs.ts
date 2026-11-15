import { lt } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { closeStraySittings } from "./sittings.ts";
import { syncWaitingPatients } from "./trend/engine.ts";

const OVERDUE_CHECK_MS = 20_000;
const CLEANUP_MS = 60 * 60_000;
const STRAY_CHECK_MS = 5000;

const globalForJobs = globalThis as typeof globalThis & { triagecamJobs?: NodeJS.Timeout[] };

const logged = (name: string, job: () => Promise<unknown>) => () => {
  job().catch((error) => console.error(`[jobs] ${name} failed:`, error));
};

async function deleteExpired(): Promise<void> {
  const now = new Date();
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
  await db.delete(schema.emailVerificationTokens).where(lt(schema.emailVerificationTokens.expiresAt, now));
}

/**
 * Starts the timers the server relies on, once per process: the overdue check (a patient
 * goes overdue because time passes, not because a request arrives), the removal of expired
 * sessions and verification tokens, and the closing of sittings whose phone has gone. Called from the session check, so they start
 * with the first signed-in request.
 */
export function ensureBackgroundJobs(): void {
  if (globalForJobs.triagecamJobs) return;
  globalForJobs.triagecamJobs = [
    setInterval(logged("The overdue check", syncWaitingPatients), OVERDUE_CHECK_MS),
    setInterval(logged("Removing expired sessions", deleteExpired), CLEANUP_MS),
    setInterval(logged("Closing sittings whose phone has gone", () => closeStraySittings()), STRAY_CHECK_MS),
  ];
  for (const timer of globalForJobs.triagecamJobs) timer.unref();
}
