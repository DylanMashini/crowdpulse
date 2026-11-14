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
