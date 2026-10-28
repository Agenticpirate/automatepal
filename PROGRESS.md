# Continuation status - 2026-10-28

Restored repository at e6818e5. Recreated general loaded-knowledge support copy (lost 9855901 was not on remote). Added answer-first concise style checks, preserving existing evidence/grounding gates. Source quotes are expandable rather than crowding the answer.

## Hard limits
Free tiers only, no spend. PAYPAL execution remains OFF. Public/fictional data only. No production-ready, escrow, tax-advice or zero-error claims. Never put repo-write credentials into app or git.

## Build order / pending
Owner guidance type with relevance, applicability, effective dates, conservative conflicts and evals; widget privacy/controls; handoff inbox; signed opt-in webhooks + scoped expiring read-only tokens; read-only sandbox billing cards; FEATURES matrix refresh. Freeze Nov 4, test/fix Nov 4-11, submission artifacts Nov 11-12.

## Current verification
Local gates and live verification are recorded per subsequent update. Remote/deployment state must be rechecked before claiming completion.

## 12:04 IST update
- fd7a3be pushed, Render deploy dep-dbgpdqnb9u1s738uidjg. General-support copy verified live at /support, screenshot inspected.
- Migration 021 applied additively; scripts/verify-guidance-db.ts passed rollback-only metadata/private/capability/validation tests. 022 NOT applied: revoke old wrapper only after new app path acceptance.
- Owner-guidance source form, current UTC date window, separately ranked semantic candidates, applicability/conflict check before answer, note-only generation when applicable. Website text remains for unrelated questions. Conservative fallback if unclear/stale/conflict/provider error. Local gates passed.
- Gemini sandbox use approval pending for measured model eval. Do not bypass it by extracting hosted secrets. scripts/eval-owner-guidance.ts has 9 cases awaiting execution.

## 12:08 IST update
- 19bfd84 deployed to preview (owner-guidance source selector now observed at /knowledge). Model evaluation pending secure Gemini approval; not accepted as production behavior.
- Widget control implementation prepared. Migration 023 applied. Empty external origin list means no external embed; first-party sample remains allowed. Display controls never claimed to protect capability links. Local Playwright lazy-load/navigation checks, origins/path tests, lint/safety/build all passed. Desktop/mobile screenshots inspected for readability.
- /api/widget returns only validated settings, with CORS for permitted exact origins, never page text/query. API checks Origin but it is not a customer authentication boundary.

## 12:10 IST update
- Migration 024 applied: open/attention/taken_over/closed cases, owner-scoped state RPC. Reserve and final completion check case state under row lock, so in-flight model result is held if taken over/closed. No human messaging implemented or claimed.
- scripts/verify-handoff-db.ts passed rollback-only take-over, in-flight completion suppression, release, attention, close, invalid case checks. Lint/safety/build passed. UI mobile screenshot inspected.
- Controls defaults merged when loading old settings to avoid missing-array crash. Setup now explains allowlisting the approved test origin before embedding.

## 12:14 IST update
- Hosted 77c6a4f live. Owner Google sign-in works without phone prompt. Published fictional North Dock corpus via UI; metadata-aware save and embeddings succeeded. Published dated student-plan-only 25-seat note through UI (Oct 28-Nov 4 UTC). Standard 10-seat and CSV export fixture are unchanged.
- Four independent one-hour tester links sent privately to coordinator at 12:12-12:13 IST. 20 answers/case, 100/tenant/day budget, cap 8-10/tester to leave diagnostics headroom. No tester owner account.
- Migration 025 read-only token API applied. Scope-specific metadata-only outputs, hashed storage, max five active, max seven days, revocation. rollback DB tests passed. Mobile settings screenshot inspected with no token value. Full lint/build passed.
- Next: hosted API acceptance and publish features matrix; signed webhook path still pending and must stay labelled not enabled until SSRF/retry/signature acceptance.

## 12:20 IST update
- Two hosted answer smoke cases passed: student seats -> 25 with Owner guidance label; unrelated report format -> CSV with reference corpus only. Screenshots inspected. These are two observations, not full nine-case acceptance.
- Migration 026 applied, webhook queue and manual delivery implementation complete locally. URL/IP/HMAC and rollback DB claims/backoff/stable-ID/stale-attempt tests pass, no external sends. Manual delivery only; no automatic worker. UI inspected mobile, no key shown.
- Read-only API dc08132 deployed; settings visible and screenshot inspected. No token created through hosted UI yet. Tokens should never be printed in trace/screenshots/chat.
- FEATURES.md refreshed to separate hosted previews, measured acceptance limits and roadmap, including manually driven webhook limitations.

## 12:22 IST update
- Hosted API acceptance: scoped 200, wrong-scope 401, revoked 401; temporary token record deleted. No token logged.
- Follow-up: DNS resolution bounded to 1.5s/one try; webhook signature display clarified. Negative-feedback questions now join unanswered questions in Prepare Q&A (nothing auto-published). Migration 027 changes only absent-settings fallback to general Site help, preserving saved owner labels.
- Coordinator confirmed Gemini approval still pending, do not re-ask. Hosted-only tests may proceed. "Premium version" clarification pending privately; do not interpret it as spend authority or paid-plan launch.

## 12:24 IST update
- More hosted checks: Hindi and Telugu student-plan seat questions each answered 25 with owner guidance and short same-language reply.
- Ambiguous eligibility check did NOT meet stricter expectation: "Does the fictional student exception apply to my account?" returned a generic conditional description of student-plan seats rather than abstaining/clarifying. It did not explicitly claim the account qualifies, but stronger guard added for English account/eligibility questions when guidance candidates exist. Need repeat hosted test after deploy. Model applicability prompt also tightened. Multilingual eligibility remains model-dependent/unverified, not a guarantee.

## 12:26 IST update
- Added deterministic eligibility regression cases and public build-status endpoint (release hash and preview/payment-flag boolean only, no secrets). Webhook has a 7-second total deadline in addition to DNS/socket/byte caps.
- Full lint/safety/widget/webhook/build passed again. Versioned hosted smoke record retains the eligibility miss; retest must verify live release before declaring fixed. Earlier 12:25 repeat hit old 1dc262c while be1903f was still deploying, so it was not a valid post-fix test.

## Continuation checkpoint 12:29 IST

- Remote head 573cb25, latest verified live release 9940952370e4 via /api/status. proofPaymentExecution=false. 573cb25 deployment in progress. Small timer setup cleanup follows, no semantics change.
- All migrations 001-027 applied (022 revoked legacy save only after ordinary/note hosted imports succeeded). Do not rerun non-idempotent migrations blindly.
- Repo: /home/sandbox/founderpay-agent. Credentials retrieved only through secure private files, not checked into app. First repo-scope PAT was 403, existing classic PAT pushed successfully. Reacquire vault files for future work, do not copy credentials into app.
- Model suite blocked only on existing Gemini sandbox approval, already sent to Ravi 12:02 and still pending; do not re-ask. Hosted app model calls work, no credential extraction allowed.
- Hosted measured checks recorded in hosted-smoke-2026-10-28.json: English/Hindi/Telugu 25-seat owner override; unrelated CSV unchanged; account eligibility miss kept in record, fixed and confirmed fallback on be1903f. Not full owner-note acceptance.
- Published fictional test corpus: North Dock Standard 10 seats, CSV export steps, weekday 09:00-17:00 UTC support, Android only, display-name steps, India delivery 5-7 business days after dispatch, optional review within 14 days no anchor, no automatic refund. Published student-only 25-seat owner note Oct 28-Nov 4 UTC. Both can be removed after testing. No real merchant/customer data.
- Four distinct anonymous tester links sent privately to coordinator, expire approx 13:12-13:13 IST Oct 28. 20 questions/case, 100 shared/day. At 12:27, 10 used/7 supported. No receivers configured; no webhook external sends. Temporary API acceptance token deleted.
- Signed webhooks are MANUAL delivery only with due times/backoff, not automatic worker. They remain opt-in/off. Do not claim full external receiver acceptance.

### Next steps
1. Verify latest deploy/status and headers; inspect live fallback label after next update. Final report should state actual live commit.
2. When Gemini permission granted, run scripts/eval-owner-guidance.ts using secure key file, plus retrieval eval with rollback fixtures. Keep failures and failure stages.
3. Complete stale/conflict/website-missing note cases and independent tester run; no weakening fail-closed checks to inflate recall.
4. Improve read-only sandbox order cards while keeping all payment execution OFF. Tax worksheet remains input arithmetic only; Proof preview/reconciliation has no live payment flow.
5. Get exact approved hidden-page paths before any foundersprime/ystartups test embed. No site-wide change.
6. Premium intent clarification belongs to coordinator; do not treat it as spend/plan-launch authority. UI polish remains post-submission unless Ravi changes freeze plan explicitly.
7. FEATURE freeze Nov 4, testing/fixes Nov 4-11, Nov 11-12 artifacts/buffer. Incomplete becomes roadmap.

## 12:38 IST update
- Verified c657ca927257 live, payment execution false, /support noindex/no-referrer HTTP headers present.
- Read-only billing card prepared with validated fictional-only USD fixture, demo-only reference, integer-cent total, distinct not-connected/review-only/not-issued/not-calculated statuses. No new schema or provider calls. Missing/invalid fixtures hidden.
- Billing unit checks, Playwright mobile/desktop and hide/invalid fixture checks, lint/safety/build/widget/webhook gates passed. Inspected mobile and corrected overly wide desktop layout, re-rendered and inspected. Hosted deployment and acceptance pending next.

## 12:45 IST closeout
- 7ae020501c98 verified live via /api/status (payment execution false); live billing pixels inspected. No migrations after 027.
- Hosted tests added to versioned smoke record: Hindi/Telugu eligibility safely fell back, expired Oct1-Oct20 student note safely fell back, current 25/35 conflicting notes safely fell back. Original Oct28-Nov4 student note restored and 25-seat answer re-verified after conflicting note made private.
- Website-missing archival XML owner example returned safe fallback, a retained recall failure. Hosted internal failure stage is unknown. Do not call this full owner-guidance acceptance. Need supplied-source model diagnostic eval once secure Gemini approval arrives.
- Corpus now has three sources: original general reference published; original student25 note Oct28-Nov4 published; temporary conflicting35 note private (former archival fixture, b1affa9e). Native confirm-based delete timed out/reset browser; verified source still existed, then used normal edit/save to make it private and verified after reload. No deletion claim.
- Parent confirmed no independent testers yet; fresh links will be needed Nov4-11. Existing links expire about13:12 and need not be renewed now. Independent second-user isolation remains required.
- No webhook receiver configured or contacted; external receiver acceptance still needs explicitly opted-in destination. Gemini approval pending since12:02; no re-ask or bypass. Premium intent pending parent clarification. No new features/UI polish outside existing build priorities.

## 13:07 IST hardening track
- Parent relayed Ravi wants solid/enterprise-grade systems; hardening now takes priority, no enterprise claims or spend.
- Migrations 028 owner metadata audit and 029 owner-confirmed preview-data deletion applied. No real user deletion performed. Tests use synthetic Auth UUIDs rolled back. Do not rerun migrations.
- Local auth-outage fail-closed, bounded rate map, streamed caps for chat/actions/Proof, global headers, metadata-only logs, /status, audit/deletion UI prepared. Full npm audit 0 known advisories.
- Synthetic two-principal DB role checks and typed-confirmation deletion/foreign survival passed. Independent second-browser full workflow remains unverified. Backup/restore not done; source docs/free-tier limitations in HARDENING.md.
- Before commit/deploy: inspect final mobile controls and status pixels; run safety/build/widget/billing/webhook; then verify hosted headers/release/payment OFF and unauthenticated audit endpoint. No destructive live deletion test on owner data.

## 13:09 IST deployment checkpoint
- c8b6e24 pushed and deploying since13:07. DB migration030 adds action-row locking before deletion checks and is already applied, plus028-029. Code differences after c8b6e24 are tests/docs/SQL only.
- Render billing live check: Hobby, no card, $0 month-to-date/projected,24/500 build minutes,4.8/750hours,14MB/5GB. No spend route added.
- DB checks expanded with populated fixture billing event/widget/custom response and running-action refusal. All rollback, no synthetic users retained.

## 13:10 IST verified hardening closeout
- Live c8b6e24c9210 verified, payment flag false; /status pixels inspected; global CSP/permissions/referrer/HSTS/nosniff headers verified on live /api/status. /api/account-data unauth denial checked.
- Remote1ddf7ef adds SQL030/tests/docs only after livec8b6e24; migration030 already applied. All001-030 applied, no rerun.
- Full prior rollback DB suites guidance/handoff/readonly/webhook passed after audit triggers. No receiver contacted. Remaining: independent browser users, comprehensive provider/DB outage/load/restore, Gemini diagnostic suite, retention age purge. Partial scorecard honest in FEATURES/HARDENING.

## 13:15 IST ticket management
- Migration031 applied. Existing support cases are tickets (same UUID; short display label plus full ID), one per fictional case. Status/priority/category/tags/owner assignment/internal notes/first-review timestamps; recorded timeline combines visitor questions/requests/internal events. AI answer bodies not stored, no outbound replies.
- Unanswered completed answer/negative feedback/request triggers auto-escalate, preserve taken-over pause; resolved/closed pause AI. Display cap200 latest tickets,50 bulk IDs,200 internal events/case. Notes owner-only, metadata audit triggers.
- Rollback DB tests passed own metadata/notes, unanswered/negative/refund triggers, taken-over and resolved pause, foreign timeline/write denial, deletion cascade. Prior handoff DB suite passes. Local mobile/desktop inspected, filter/bulk fixture and CSV guards pass. Full gate run/deploy next.
