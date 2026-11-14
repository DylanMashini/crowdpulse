// Builds DATABASE_URL from its parts, for the container (scripts/container-entrypoint.sh).
// In production the password comes from the secret that RDS manages and rotates, so the task
// is given the parts (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD) and not one string.
//
//   node scripts/database-url.mjs    prints the URL for the DB_* variables in the environment
import { pathToFileURL } from 'node:url';

/**
 * `sslmode` defaults to verify-full: the certificate must chain to a trusted root and name the host.
 * @param {{ [name: string]: string | undefined }} parts
 */
export function databaseUrl({ DB_HOST, DB_PORT = '5432', DB_NAME, DB_USER, DB_PASSWORD, DB_SSLMODE = 'verify-full' }) {
  const missing = Object.entries({ DB_HOST, DB_NAME, DB_USER, DB_PASSWORD })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new Error(`Cannot build DATABASE_URL: ${missing.join(', ')} not set`);
  const credentials = `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}`;
  return `postgres://${credentials}@${DB_HOST}:${DB_PORT}/${encodeURIComponent(DB_NAME)}?sslmode=${encodeURIComponent(DB_SSLMODE)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(databaseUrl(process.env));
}
