# Operations and safe recovery

Bounded preview (APP_MODE=preview) or production mode. Free-tier only. Payment execution stays OFF in both modes. Email transport is off unless RESEND_API_KEY is set (see Email below).

## What exists

Owner `/operations`, authenticated `/api/operations`, and explicit expiring/revocable `health:read` bearer `/api/v1/health`. A support/analytics token does not authorize health. Hashes only in storage. Never put bearer tokens in URLs, logs, screenshots, source files or chat. Token provisioning to a watcher must use an approved secret store. Maximum five active tokens, seven-day expiry, six requests/minute/process guard. The page does not start a watcher. Main coordinates any hourly watch and credential expiry.

Health returns bounded 24-hour event counts and proof of that database query. No model/provider probe or cost-incurring request. Errors/503 are unknown/degraded, never healthy. Empty logs prove nothing. Event recording is best effort; a DB outage can also lose logs. This is diagnostic telemetry, not an immutable audit trail. Metadata-only checked code/component/severity/request/release/attempt; no arbitrary error body or customer text. Instrumented ticket, overview and alert paths only, not every thrown exception. Browser auth failures and process crashes may precede tenant attribution and are not logged here.

Seven-day owner visibility, latest 200 returned and 500 retained per owner. Physical cleanup occurs on a later event, not a timed erasure guarantee. `health` counts can undercount during bursts due to retention. Owner-confirmed existing preview deletion also deletes these diagnostic rows. No scheduled data deletion was added.

## Known failure -> response

| Code / condition | Automatic action | Next safe action |
| --- | --- | --- |
| SAFE_RETRY_STARTED | Ticket-list read only: allowlisted PG connection/capacity codes08000/08003/08006/53300/57P03 or PostgREST pool connection codesPGRST000/001/002. Log before, wait250ms, retry exactly once. | Wait for recovered/exhausted event for same request. Only reads; no business mutation. |
| SAFE_RETRY_RECOVERED | Log after attempt2. | No claim that other routes recovered. |
| SAFE_RETRY_EXHAUSTED / TICKET_READ_FAILED | Safe error, request ID; no stale list presented as current. | Check DB/service state. Reproduce with synthetic fixture; do not continuously hammer dependency. |
| TICKET_WRITE_FAILED | Do not retry. Guard/invalid request or unknown outcome. | Refresh ticket and inspect timeline before choosing any retry; obey status/refund guard. Never replay notes blindly. |
| OWNER_SNAPSHOT_FAILED | No partial overview or stale operational view. | Check DB and session. Refresh only when ready. |
| ALERT_RULE_FAILED | No send; draft/dry-run operation rejected. | Check fields, one/minute dry-run limit and owner session. Delivery remains DB-disabled. |
| Summary503 / no event | Unknown, not healthy. No model call. | Check status, release and DB; report missing coverage. |
| Auth/token expiry | No auto renewal or widened scope. | Owner-approved fresh health token through secret storage. |
| Payment/claim uncertain | No clearing locks, requeue, retry, refund or money action. | Escalate and reconcile from supported read-only source. |

## Agent-assisted code repair

1. Read current release, original request and restrictions. Recover request ID/code and synthetic reproduction, not customer content.
2. Patch the smallest proven defect. No automatic spends, payment enablement, deletion of user data, wider permissions, secrets or external sends.
3. Run lint/build, safety/hardening/widget/tickets/billing/webhook tests and affected DB/UI suites. SQL fixtures in rollback transactions. Inspect actual desktop/mobile light/dark pixels for UI changes.
4. Commit, push, deploy only within owner authority; confirm current free tier and no paid action. Verify exact `/api/status` release and payment flag plus signed-in affected flow. Log evidence/limits in PROGRESS.
5. If acceptance fails, stop new actions, inspect rollback eligibility and restore the previous application release through Render's supported controls. Additive migrations stay unless a reviewed safe forward fix is needed. Never replay non-idempotent migrations.

Automatic deployment rollback is NOT implemented or tested. Current rollback is agent-assisted. Stale jobs/claim repair, background sends, expired-token cleanup, service watchdog, agent failover and all-route coverage remain roadmap. Do not describe the system as self-healing or fully autonomous.
## Server error monitoring (Phase 6.5)
- `instrumentation.ts` exports Next.js `onRequestError`. Every server error in a page render, route handler, server action or proxy goes to `lib/server-errors.ts`, which records **metadata only**: the route template (for example `/api/support` or `/tickets`, never the concrete URL or its query), the router context, the method, the release (`RENDER_GIT_COMMIT`, first 12 characters, or `local`) and a request id. The error message, headers and request or response bodies are never recorded, because they can carry visitor text or tokens.
- Each error is one JSON line in the server log (`{"event":"server_error",...}`) and, when `SUPABASE_SERVICE_ROLE_KEY` is set, one `SERVER_ERROR` row in `operational_events` (db/048) with `user_id` NULL and `component='server'`. Workspace members never see these rows (RLS compares `user_id`). The latest 2000 are kept for 14 days. Read them with the service-only `server_error_summary(p_minutes)` RPC.
- `proxy.ts` gives every request an `x-request-id` (a valid incoming one is kept), so a log line can be matched to a report.
- Optional `ALERT_WEBHOOK_URL` (https only, for example a Slack or Discord incoming webhook): one POST with a short text when 5 server errors happen within 5 minutes, then at most one more per 15 minutes. Counters are per server process. The POST contains the count, the window, the release and the latest route template, nothing else.
## Uptime check
- `.github/workflows/uptime.yml` calls `GET /api/status` every 10 minutes from GitHub Actions (repository secret `APP_URL`). The job fails, and GitHub notifies the repository's watchers, when the status is not 200, `release` is not a 12-character hex commit (or `local`), or `mode` is not `preview` or `production`. A sleeping free Render instance gets two retries and a 90-second timeout. GitHub may delay scheduled runs; this is a coarse check, not a monitoring service with an SLA.
## Scheduled jobs (Phases 6.2-6.4)
- Since Phase 0 (Nov 9) the hourly run is a Cloudflare Cron Trigger: `wrangler.jsonc` `triggers.crons` (prod :17, staging :47) and `custom-worker.ts`, whose `scheduled` handler sends the same bearer-authenticated POST straight into the Worker's own fetch handler and logs one `cron_run` JSON line with the counts. Test locally with `npx wrangler dev --test-scheduled` and `/__scheduled`. `.github/workflows/scheduled-refresh.yml` is now manual-only (fallback).
- Previously `.github/workflows/scheduled-refresh.yml` called `POST /api/cron/refresh` hourly with `Authorization: Bearer $CRON_SECRET` (repository secrets `APP_URL`, `CRON_SECRET`). The server compares the token in constant time and needs `CRON_SECRET` (32+ characters) and `SUPABASE_SERVICE_ROLE_KEY`; without them it answers 401 or 503 and does nothing.
- One call does a bounded amount of work in about 50 seconds: transcript retention purge (up to 200 conversations), website refresh for up to 2 due workspaces (up to 15 saved pages and 5 new pages each, into the owner's review queue; nothing is published). Saved pages rotate, least recently re-checked first, so every saved page is re-checked in turn. The first successful sitemap read is remembered as a baseline; later runs propose only sitemap pages not seen before, and never one the owner dismissed. Changing the sitemap URL starts a new baseline (db/052). A saved page is proposed for removal only when it answers 404/410 or a fully read sitemap no longer lists it (only for pages on the sitemap's own host; pages on other hosts are removed only on a 404/410); after a partial sitemap read (a nested file failed, or a file, URL or time cap was hit) the summary says `sitemap: partial` and no removal comes from the sitemap. A dismissed removal is not proposed again until the page has been seen live since (db/053). The same call also runs AI labels for up to 10 conversations (stops at half of `LLM_DAILY_USD_CAP`), and weekly digests for up to 10 workspaces. The response holds counts only. HTTP 207 means at least one job reported a failure; the others still ran.
- Run once by hand: Actions > Scheduled refresh > Run workflow.
## Email (Phase 6.1)
- Transport is Resend over plain HTTPS, on only when `RESEND_API_KEY` and a valid `EMAIL_FROM` are set. Otherwise every email is recorded as a `dry_run` row and nothing is sent. Every send is reserved first in `email_log` (type, sha256 of the recipient, status, provider id; never the address or text), with per-workspace daily caps.
- If emails fail: check the Resend dashboard for the domain's DNS status, then the `email_log` statuses for the workspace. Do not resend by hand from logs; the log holds no content.
## Rate limits (Phase 0, db/054)
- `allowRequest(key, now, max)` in `lib/rate-limit.ts` checks the in-process window first, then `rate_limit_hit` (service role, sha256 key, fixed 60 s window, UNLOGGED table) so a limit holds across Workers isolates and processes. No service key, a DB error or a call over 1.5 s falls back to the in-process result: the limiter never blocks traffic because the counter store is down. Tests: `test:hardening`, `verify-owner-replies` (local guard), `verify-rate-limit-db` (15 checks).
## CI and backups (Phase 0)
- `.github/workflows/ci.yml`: on every PR and push to main, `npm ci`, `npm audit` (high), lint, `tsc`, build, the offline unit and browser suites, and every `verify-*-db.ts` against a disposable Supabase started in the runner (`local-db-apply.mjs` + `local-db-seed.mjs` + `local-db-verify.sh`). No secrets.
- `.github/workflows/db-backup.yml`: nightly 02:00 IST `pg_dump` (public + auth, same options as `scripts/hosted-db-backup.sh`), table count check, `age` encryption, upload to a private R2 bucket. Needs secrets `SUPABASE_DB_URL`, `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Restore: download, `age -d -i <offline key>`, `pg_restore` into STAGING only, then run the DB suites and compare row counts.
- Staging: `wrangler.jsonc` `env.staging` (Worker `automatepal-web-staging`, staging.automatepal.com), `npm run cf:deploy:staging`.
