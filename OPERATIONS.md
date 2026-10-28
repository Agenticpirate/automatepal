# Operations and safe recovery

Bounded fictional preview. Free-tier only. Payment execution and notification transport stay OFF.

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
