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
