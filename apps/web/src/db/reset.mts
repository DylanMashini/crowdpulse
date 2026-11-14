// Drops everything in the database, including the migration history. `pnpm db:reset` runs
// the migrations again straight after. Refuses to touch anything but a local database.
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.local.");
}
const host = new URL(connectionString).hostname;
if (!["localhost", "127.0.0.1", "::1", ""].includes(host)) {
  throw new Error(`Refusing to reset a database on ${host}. db:reset is for the local database only.`);
}

const pool = new Pool({ connectionString });
try {
  await pool.query("drop schema if exists public cascade");
  await pool.query("drop schema if exists drizzle cascade");
  await pool.query("create schema public");
  console.log("Dropped every table.");
} finally {
  await pool.end();
}
