# Proof-to-Pay work log

## Implemented locally, awaiting hosted acceptance
- Private saved agreements: public GitHub PR, explicit acceptance criteria, exact required check names, USD amount.
- Public GitHub API evidence: merged/draft state, pinned head SHA, checks and bounded file patches. No private repo token or arbitrary URL fetch.
- Deterministic gate requires merged, non-draft, exact successful checks on pinned SHA. Truncated/missing/ambiguous evidence blocks a positive recommendation.
- Gemini advisory assessment sees source data as untrusted content, has no tools, returns a bounded structured assessment. AI unavailable means hold.
- Immutable saved assessment evidence and source URL shown for review.
- Payment API implementation scaffold supports AUTHORIZE orders, explicit approval, authorization, fresh evidence before capture, and void with written reason. Execution is OFF by default (`PROOF_PAYMENTS_ENABLED` is not set). This scaffold is not a verified payment flow.

## Safety limits
This is not legal escrow. PayPal authorization is a temporary hold, capture can fail, and CI success is not proof of code quality or trusted CI ownership. Only sandbox endpoints are supported. No automatic capture, refund, live money or claims of uniqueness. Non-owner merchants are not onboarded; multi-merchant processing is future work.

Payment activation requires tests for authorization/capture/void, concurrent proposals, outcome reconciliation after persistence failure, expired authorization and evidence changes, plus inspected hosted confirmation UI. Do not enable the execution flag before those pass.

## Verified source/test example
Read-only evidence was fetched from https://github.com/vercel/next.js/pull/100805 at build time. It was merged; file patches were available. AI supported the stated compressed-response criteria, but the deterministic gate held because the check list exceeded the bounded collection. No payment was associated with this unrelated public PR. It is an evidence-reader test, not a customer deliverable or endorsement.

## Sources
- https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture
- https://developer.paypal.com/docs/checkout/standard/customize/authorization-honor/
- https://developer.paypal.com/api/orders/v2/orders-authorize
- https://developer.paypal.com/api/payments/v2/authorizations-capture
- https://developer.paypal.com/api/payments/v2/authorizations-void
- https://docs.github.com/en/rest/checks/runs
- https://docs.github.com/en/rest/pulls/pulls?apiVersion=latest

## Execution lock (not yet enabled)

Each contract has a database-backed operation lock tied to the exact executing proposal. A second proposal and a retry cannot run while the lock exists. The lock is removed only after provider result and ledger storage finish. Exceptions preserve the lock and require operator reconciliation against PayPal and saved activity. No automatic timeout unlock is used. There is not yet a reconciliation UI or full provider acceptance coverage, so `PROOF_PAYMENTS_ENABLED` remains unset/off.

GitHub reads use up to 100 bounded ETag entries, valid for conditional revalidation for 60 seconds. A conditional 304 from GitHub is required before a cached representation can be used. Rate-limit failures start a bounded cooldown; no stale response fallback is allowed. A dedicated public-read credential may be configured as `GITHUB_PUBLIC_READ_TOKEN`; never use a repository-write token.

Read-only reconciliation is available to the sandbox owner in the next build. It queries PayPal only for IDs already recorded in that owner's contract activity and shows any operation lock. It does not automatically clear locks, replay requests, infer unknown IDs, or treat an absent ledger event as proof of no provider effect. Recovery from unknown IDs still requires direct PayPal/dashboard investigation. This limitation is a reason payment execution remains disabled.
