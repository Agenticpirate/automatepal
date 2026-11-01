#!/bin/zsh
# Read-only logical backup of the HOSTED Supabase database (public and auth schemas) before a migration.
# Uses pg_dump from the official postgres Docker image, so no local Postgres install is needed.
# Output: ~/AutomatePal-backups/hosted-<UTC timestamp>.dump (custom format, chmod 600, outside the repo).
# Usage: DATABASE_PASSWORD_FILE=~/.automatepal/db-password zsh scripts/hosted-db-backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_PASSWORD_FILE:?Set DATABASE_PASSWORD_FILE to a chmod 600 file holding the hosted database password}"
PG_IMAGE=${PG_IMAGE:-postgres:17-alpine}
out_dir="$HOME/AutomatePal-backups"; mkdir -p "$out_dir"; chmod 700 "$out_dir"
name="hosted-$(date -u +%Y%m%dT%H%M%SZ).dump"
envfile=$(mktemp); chmod 600 "$envfile"; trap 'rm -f "$envfile"' EXIT
print -r -- "PGPASSWORD=$(tr -d '\n' < "$DATABASE_PASSWORD_FILE")" > "$envfile"
conn="host=aws-0-us-east-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.sknmlhjaysqmtyeqpfiv sslmode=verify-full sslrootcert=/certs/supabase-ca.crt"
docker run --rm --env-file "$envfile" -v "$out_dir:/out" -v "$PWD/certs:/certs:ro" "$PG_IMAGE" \
  pg_dump "$conn" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file "/out/$name"
chmod 600 "$out_dir/$name"
entries=$(docker run --rm -v "$out_dir:/out:ro" "$PG_IMAGE" pg_restore --list "/out/$name" | grep -c -v '^;')
tables=$(docker run --rm -v "$out_dir:/out:ro" "$PG_IMAGE" pg_restore --list "/out/$name" | grep -c 'TABLE DATA')
print "Backup written: $out_dir/$name ($(du -h "$out_dir/$name" | cut -f1), $entries entries, $tables tables with data)"
