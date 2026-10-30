# Candidate readiness log - rebuilt 2026-10-30

Baseline: GitHub main 0e727c3 (current Render production release). Candidate branch rebuilt after the 2026-10-30 sandbox wipe; earlier unpushed candidate commits and their test evidence were lost and re-done.

## Rebuilt and re-measured 2026-10-30 (all local, candidate-only, nothing deployed)

| Item | Commit | Evidence |
| --- | --- | --- |
| Unanswered-questions digest (7-day grouped, draft handoff, honest caveats) | 3ffe98b | 7 unit + 6 UI checks PASS; /downloads/automatepal-digest-*.png, automatepal-digest-tests.json |
| Contact + abuse-report page, SECURITY.md, footer/sitemap | e224217 | /contact 200 desktop+mobile, no overflow, footer link, sitemap entry; screenshots inspected |
| Owner alerts eligible_now API + matchedReasons | 53e38d5 | type check + existing alert unit tests PASS |
| In-app "Needs review now" surface on /owner | 3534c15 | 4 new matchedReasons assertions + 3 UI checks PASS; automatepal-alerts-*.png inspected |
| Answer quality: transient retry (never 429) + honest outage fallback | 0d1fd23 | scripts/verify-gemini-retry.ts PASS; safety suite 7/7; build clean |

Suites: test:safety 7/7, test:widget 5/5, eslint clean, next build clean on final HEAD 0d1fd23.

## Backups
Drive folder "AutomatePal candidate backups" (private): archives at 3ffe98b, 3534c15, 0d1fd23. GitHub connected access is read-only; no candidate branch push possible.

## Lost in the wipe, not yet rebuilt
- Skeuomorphic anatomy cabinet UI (61-part SVG cabinet) and its review evidence. Owner approval was still pending; rebuild is a multi-hour job.
- Edge-function local source for the deployed candidate transport (the deployed Supabase Edge function itself is unchanged and still live).
- submission/workers evidence JSONs from earlier runs (isolation, restore, quota, rollback, Edge batches). Conclusions were reported to the parent at the time; re-measure before re-claiming.

## Still blocked on owner
- Railway: placeholder PASTE_ANON_KEY_FROM_RENDER in owner-built bundle; waiting for actual public anon key + rebuild.
- Digest go-live and skeuomorphic site promotion need explicit owner approval.
