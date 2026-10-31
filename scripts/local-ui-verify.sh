#!/bin/zsh
# Runs the Playwright verify-*.mjs gates locally, one at a time, with exit codes captured directly
# (per docs/KIRO_BRIEF.md: no pipes, kill stray `next start` between runs). Uses the current .next build.
# Skips scripts that need the live site or a different build flag; pass names to run a subset.
cd "$(dirname "$0")/.."
skip=(verify-seo-hosted verify-demo-open verify-team-api verify-team-ui verify-cache-headers)
mkdir -p /tmp/ap-ui-logs; fail=0
scripts=(${@:-scripts/verify-*.mjs})
for s in $scripts; do
  n=$(basename $s .mjs)
  if [[ $# -eq 0 && ${skip[(ie)$n]} -le ${#skip} ]]; then continue; fi
  pkill -f 'next start' 2>/dev/null; sleep 2
  node --import ./scripts/local-playwright-preload.mjs $s > /tmp/ap-ui-logs/$n.log 2>&1; code=$?
  [[ $code -ne 0 ]] && fail=1
  printf "%-30s exit=%s  %s\n" $n $code "$(grep -m1 -E 'PASS|FAIL|Error' /tmp/ap-ui-logs/$n.log | cut -c1-120)"
done
pkill -f 'next start' 2>/dev/null
exit $fail
