import { lt } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { syncWaitingPatients } from "./trend/engine.ts";

const OVERDUE_CHECK_MS = 20_000;
const CLEANUP_MS = 60 * 60_000;

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
 * goes overdue because time passes, not because a request arrives) and the removal of
 * expired sessions and verification tokens. Called from the session check, so they start
 * with the first signed-in request.
 */
export function ensureBackgroundJobs(): void {
  if (globalForJobs.triagecamJobs) return;
  globalForJobs.triagecamJobs = [
    setInterval(logged("The overdue check", syncWaitingPatients), OVERDUE_CHECK_MS),
    setInterval(logged("Removing expired sessions", deleteExpired), CLEANUP_MS),
  ];
  for (const timer of globalForJobs.triagecamJobs) timer.unref();
}
