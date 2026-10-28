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
