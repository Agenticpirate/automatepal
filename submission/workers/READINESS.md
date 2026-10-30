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

| Setup method picker (paste / file / URL paths) | 33ec047 | UI checks PASS |
| In-dashboard playground (test-answer API, no recording) | fb33e0f | 7 playground checks PASS |
| Add-ons hub: 10 integration cards, disabled with needs-lists | 4420ba8 | verify-addons-ui PASS |
| Install check (verify-install API, SSRF guards, origin pre-flight) | e4d590d | verify-install-check + 10 UI checks PASS |
| Setup nudges: unpublished-source nudge + demo expiry countdown | dd5384d | 8 UI checks PASS |
| Empty states on 4 pages | ddcff3b | verify-empty-states PASS |
| Go-live checklist (4 marks, localStorage) | 2ee1597 | 12 UI checks PASS |
| CSV exports (knowledge + unanswered, formula-injection guard) | 7e32126 | verify-exports + 6 UI checks PASS |
| Sample pack + setup step memory | 44323a7 | 6 UI checks PASS |
| Owner insights: weekly strip, unanswered themes, stale-source nudge | bbd97cc | verify-cluster + 8 UI checks PASS |
| Multilingual answers (detect + directive + 7 localized fallbacks), satisfaction strip, escalation quick-filter | a87b21e | verify-multilingual + 4 UI checks PASS |
| Performance: widget.js short cache + SWR, header verification | fd9e812 | verify-cache-headers 4/4 PASS; widget 2,811 B raw / 1,386 B gz, page JS ~28.7 KB |
| Lead capture: unsupported-answer follow-up nudge + owner follow-up count | 6b4bcc8 | 4 UI checks PASS |
| Ticket transcript: consented lead emails in owner timeline | ff72012 | 2 UI checks PASS |
| Health endpoint telemetry: error rate, failed jobs, auto-fix log, dependencyMs | 5d457dc | verify-health-telemetry 4/4 PASS |
| Owner analytics: 7/30-day window toggle | 9b58ce7 | 2 UI checks PASS |
| Bounded public-URL import (SSRF guards, robots.txt, 256 KB cap, review-first) | b6e55c9 | verify-url-import 4/4 + 2 UI checks PASS |

## Full regression sweep 2026-10-30 (final HEAD b6e55c9 plus test-expectation fixes)
- 32/32 Playwright UI suites PASS. Two stale expectations fixed (verify-owner-pages .first() for theme+recent duplicate text; verify-seo sitemap 5->6 after /contact). verify-seo-hosted PASS against live production.
- 27/39 tsx unit/integration scripts PASS. 12 fail on environment only (DATABASE_PASSWORD_FILE / Gemini key absent in sandbox): verify-core, verify-catalog-db, verify-guidance-db, verify-handoff-db, verify-hardening-db, verify-operations-db, verify-owner-alerts-db, verify-populated-isolation-db, verify-readonly-db, verify-service-desk-db, verify-tickets-db, verify-webhook-db. None are product regressions.
- lint + tsc + next build clean (50 pages).


## Backups
Drive folder "AutomatePal candidate backups" (private): archives at 3ffe98b, 3534c15, 0d1fd23, then per-milestone through b6e55c9 (latest: automatepal-candidate-b6e55c9-analytics-url-import.tgz, metadata-verified). GitHub connected access is read-only; no candidate branch push possible.

## Lost in the wipe, not yet rebuilt
- Skeuomorphic anatomy cabinet UI (61-part SVG cabinet) and its review evidence. Owner approval was still pending; rebuild is a multi-hour job.
- Edge-function local source for the deployed candidate transport (the deployed Supabase Edge function itself is unchanged and still live).
- submission/workers evidence JSONs from earlier runs (isolation, restore, quota, rollback, Edge batches). Conclusions were reported to the parent at the time; re-measure before re-claiming.

## Still blocked on owner
- Railway: placeholder PASTE_ANON_KEY_FROM_RENDER in owner-built bundle; waiting for actual public anon key + rebuild.
- Digest go-live and skeuomorphic site promotion need explicit owner approval.
