import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "../server/env.ts";
import * as schema from "./schema.ts";

// One pool per process. Stored on globalThis so dev-server reloads reuse it.
const globalForDb = globalThis as typeof globalThis & { triagecamPool?: Pool };

function pool(): Pool {
  globalForDb.triagecamPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  return globalForDb.triagecamPool;
}

export const db = drizzle({ client: pool(), schema });
export type Db = typeof db;
export { schema };
