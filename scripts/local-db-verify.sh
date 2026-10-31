#!/bin/zsh
# Runs every scripts/verify-*-db.ts against the LOCAL disposable database (rollback-only scripts).
cd "$(dirname "$0")/.."
export LOCAL_DATABASE_URL=${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres} DATABASE_PASSWORD_FILE=/dev/null
mkdir -p /tmp/ap-db-logs; fail=0
for s in scripts/verify-*-db.ts; do
  n=$(basename $s .ts)
  node --import ./scripts/local-pg-preload.mjs --import tsx $s > /tmp/ap-db-logs/$n.log 2>&1; code=$?
  [[ $code -ne 0 ]] && fail=1
  printf "%-34s exit=%s  %s\n" $n $code "$(head -c 140 /tmp/ap-db-logs/$n.log | tr '\n' ' ')"
done
exit $fail
