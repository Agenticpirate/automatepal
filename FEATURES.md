# AutomatePal implementation checklist

Status as of 2026-10-28. This is a build checklist, not a promise of parity or production readiness. "Hosted preview" means a bounded fictional/sandbox workflow has been checked. It does not mean ready for real merchants. SiteGPT was reviewed for behavior ideas only; no source, assets or branding were copied.

## Hosted previews
- Owner Google login; owner-only shared PayPal sandbox tools; persisted exact review/confirm for money-moving proposals. No live-money mode.
- Fictional billing help panel and owner review queue. Submission/review does not issue a refund or email.
- Widget script tag, Shadow DOM isolation, lazy iframe, left/right positioning and session open/closed persistence. Persistence currently has local browser test evidence, not every third-party website.
- Tenant label, monogram, accent and four plain-text quick prompts. No image-logo or arbitrary-script setting.
- Optional contact email with explicit consent and human-review request.
- Text/TXT/MD knowledge and bounded browser-only text PDF extraction. No OCR. Review before processing/publication; separate consent switches default off.
- Tenant/published-source pgvector retrieval, exact supporting quotes, validated source IDs, secondary grounding check, fallback. English temporal-anchor rejection is a limited extra guard.
- Custom Q&A prepares a regular source for review. It is not yet a separately ranked override store.
- Atomic source edits with revision conflict detection, retained previous source on failed save and renewed processing/publication choice.
- Source count and character-based page units; 30 sources/360 units per owner. Each unit is 2500 stored characters rounded up per source. Not a commercial plan entitlement.
- Persistent question reservation before model calls: 20/case and100/tenant/database-UTC-day. Failures consume slots. Limited demo budgets, not production bot protection.
- Recent1000-question analytics, feedback and unanswered list. Formula-safe CSV export has local browser test evidence; hosted download acceptance remains unverified.
- Proof-to-Pay public GitHub evidence preview, owner read-only reconciliation for known recorded provider IDs, evidence export. Shared unauthenticated GitHub rate limits can block reads; dedicated public-read token remains pending. Payment execution disabled.
- User-input USD tax arithmetic worksheet and CSV. No jurisdiction selection, tax advice, filing or official tax rates.

## Knowledge core next
- Persist ingestion attempts/status, including failed/limit states; source editing is live, background jobs are not.
- Separate exact raw-question custom responses: built and tested locally, rollout acceptance pending. Case/whitespace normalization only, not fuzzy semantic matching.
- Bounded recent-conversation query rewrite with evidence-preserving retrieval and explicit isolation tests.
- Improve answerable recall and measure it without weakening unsupported-answer fallback. Latest13case synthetic run10/13 expected outcomes; earlier8/13. Not a statistical error rate.
- Sitemap/list-of-links import and manual resync, after SSRF, redirect, robots/permission, content-size and source-diff controls. No crawler currently enabled.
- DOCX extraction only after parser/resource/security review. YouTube transcripts optional, not enabled.

## Product work not built
- Named instruction sets/personas, creativity controls, configurable fallback, follow-ups, moderation settings, page-context API and modify-answer workflow.
- Domain allowlist/excluded pages; inline embed; broader appearance/font/avatar/dark/size settings; auto-open, UI translations, RTL, legal consent and disclaimer controls.
- Triggered/custom lead forms; lead management/search/CSV/booking link; email and webhook notifications.
- Working-hours/chat modes, agent takeover/release, tags, important/rename/resolve and conversation export.
- Real conversation/visitor funnel and dated deltas, unanswered clustering and full history search.
- Signed/retried webhooks, scoped expiring API tokens, REST subset, SDK commands/HMAC visitor identity and tracking events.
- Team roles/invites and visitor/lead/conversation retention/deletion tools. Current source deletion cascades chunks; previously viewed/exported answers cannot be recalled.
- Authenticated merchant PayPal onboarding and actual per-merchant read-only order/refund/invoice lookup. Current widget uses fictional cases; the owner sandbox toolset is separate.

## Roadmap only
Slack, WhatsApp, Messenger, Google Chat, helpdesk integrations, native AI email inbox, cloud OAuth content connectors, mobile apps, MCP/CLI/A2A, typed SDKs and compliance programs. No HIPAA/SOC2/GDPR certification claim, HIPAA mode, legal escrow, enterprise-ready or zero-hallucination claim.
