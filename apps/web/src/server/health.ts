import { Client } from "pg";

import { env } from "./env.ts";

const TIMEOUT_MS = 3000;

/**
 * Whether a new connection to the database can be opened and queried right now.
 *
 * A connection of its own, not one from the pool: a pooled connection that is already open
 * keeps working after the password it was opened with has been rotated, and a busy pool would
 * make a healthy server look dead. Never throws.
 */
export async function databaseReachable(connectionString: string = env().DATABASE_URL): Promise<boolean> {
  const client = new Client({ connectionString, connectionTimeoutMillis: TIMEOUT_MS, query_timeout: TIMEOUT_MS });
  // Without a listener, a connection that drops while idle would be an uncaught exception.
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch (error) {
    console.error("[health] The database is not reachable:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const SHARE_MS = 5000;

/**
 * Shares one check between the requests of `SHARE_MS`. The route is public, and each check is
 * a TLS handshake and a sign-in on the database: without this, anyone could make the server
 * open connections as fast as they can send requests. The load balancer asks every 15
 * seconds, so its checks are always fresh ones.
 */
export function sharedCheck(check: () => Promise<boolean>, now: () => number = Date.now): () => Promise<boolean> {
  let last: { at: number; result: Promise<boolean> } | undefined;
  return () => {
    const at = now();
    if (!last || at - last.at >= SHARE_MS) last = { at, result: check() };
    return last.result;
  };
}

const globalForHealth = globalThis as typeof globalThis & { triagecamHealthCheck?: () => Promise<boolean> };

/** `databaseReachable`, asked at most once every five seconds. */
export function databaseReachableShared(): Promise<boolean> {
  return (globalForHealth.triagecamHealthCheck ??= sharedCheck(() => databaseReachable()))();
}
