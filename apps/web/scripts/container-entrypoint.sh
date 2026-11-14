#!/bin/sh
# Entry point of the production image (apps/web/Dockerfile). Builds DATABASE_URL from the DB_*
# variables when it is not given whole, then becomes the command, so signals reach it directly.
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
  DATABASE_URL="$(node "$(dirname "$0")/database-url.mjs")"
  export DATABASE_URL
fi

exec "$@"
