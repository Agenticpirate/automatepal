#!/bin/zsh
# Rebuilds the LOCAL disposable Supabase database: reset, apply db/001..N, seed two synthetic users.
# Local only (scripts refuse non-local hosts). Never run against the hosted project.
set -e
cd "$(dirname "$0")/.."
export LOCAL_DATABASE_URL=${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
[[ -z "$DOCKER_HOST" && -S "$HOME/.colima/default/docker.sock" ]] && export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
npx -y supabase@latest db reset --local --workdir .supabase-local >/dev/null 2>&1
for i in {1..30}; do node -e "const pg=require('pg');const c=new pg.Client({connectionString:process.env.LOCAL_DATABASE_URL});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))" && break; sleep 1; done
node scripts/local-db-apply.mjs | tail -1
node scripts/local-db-seed.mjs
