// Applies the SQL migrations in ./migrations and makes sure the settings row exists.
// Run with `pnpm db:migrate`.
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.local.");
}

const pool = new Pool({ connectionString });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: resolve(import.meta.dirname, "migrations") });
  await pool.query("insert into settings (id) values (1) on conflict (id) do nothing");
  const tables = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  console.log(`Migrated. Tables: ${tables.rows.map((row) => row.tablename).join(", ")}`);
} finally {
  await pool.end();
}
