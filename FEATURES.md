# AutomatePal feature matrix

Updated 2026-10-28. "Hosted preview" means a bounded fictional/sandbox feature is deployed, not ready for real merchants. No parity, certification, legal escrow or zero-error claim. SiteGPT public docs informed behavior, not copied assets or code.

| Capability | State | Evidence and limits |
| --- | --- | --- |
| Google sign-in and private owner workspace | Hosted preview | Owner sign-in checked; independent second-user acceptance still required. |
| Guided knowledge / look / test / script setup | Hosted preview | One-hour fictional demo links, not permanent customer identity. No card. |
| TXT/MD and small text-PDF import | Hosted preview | Local PDF extraction/review, 2 MB / 10 pages; no OCR or crawling. |
| Source edits, deletion, attempt history, quota | Hosted preview | Atomic revision-checked replacement, renewal of processing/publication consent, 30 sources / 360 character-based page units. Existing copies cannot be recalled. |
| Source-grounded general support answers | Hosted preview | Tenant pgvector threshold 0.72, exact quotes, source IDs, independent model grounding, conservative fallback. Small prior retrieval run 10/13; earlier 8/13. Not a statistical error rate. |
| Concise answer-first style | Hosted preview | Usually 1-3 short sentences, no preamble, 700-character ordinary / 1600-character how-to guard. Full required steps take priority; failed style returns fallback rather than ungrounded truncation. |
| Exact owner custom responses | Hosted preview | Separately stored, exact normalized question match, verbatim answer. Not model-verified, fuzzy matching or fine-tuning. |
| Owner examples and exceptions | Hosted preview, limited acceptance | First-class owner guidance with applicability and inclusive UTC effective dates, separate relevance retrieval, applicability/conflict/stale checks before answering. Private/publish-off defaults. Hosted English/Hindi/Telugu 25-seat answers and unrelated CSV passed; expired/conflicting notes and account eligibility safely fell back. Website-missing XML example missed (safe fallback), stage unknown. Full nine-case supplied-source suite pending secure provider access. |
| Branding, prompts, widget controls | Hosted preview | Label, monogram, color, starters, side, auto-open, hide order/contact/quotes, exact HTTPS origins, excluded paths/subtrees. Origin/path rules are display controls, not authentication for link holders. No image logos/arbitrary HTML. |
| Lazy embed and navigation state | Hosted preview | Shadow DOM and lazy iframe, tab session open/closed state; isolated browser tests pass, universal site compatibility not claimed. |
| Abuse budget and extraction refusal | Hosted preview | 20 answer attempts/case, 100/tenant/UTC day persisted before provider calls; refused questions consume slots. 500-character counter; process rate guard not distributed protection. |
| Leads and human review | Hosted preview | Optional fictional email requires consent, owner review queue, no automatic email. |
| Ticket management | Live preview | One ticket per fictional case, statuses/priority/category/tags, owner-only notes, recorded question/request/event timeline, auto escalation on completed unanswered checks/negative feedback/review requests, capped search/filter/sort and bulk status50, single-owner assignment, first-review/age indicators (not response SLA), metadata-only CSV, audit and RLS checks. No outbound replies/email or AI answer-body history. Latest200 tickets,200 internal events/case. |
| Handoff inbox | Hosted preview | Open/attention/taken-over/closed, take over/release/resolve. DB tests verify paused reservations and in-flight answer suppression. No live human reply channel. |
| Feedback / unanswered / CSV | Hosted preview | Up/down, recent question metadata and formula-safe unanswered CSV. Not independently verified model-quality metrics. |
| Scoped read-only API | Hosted preview | Hashed bearer tokens, max 5 active, 1-168 hour expiry, revocation, support/analytics scopes, latest 100 metadata rows. No messages/contacts/source text/payment access. DB scope/revocation tests pass; UI deployed, hosted client acceptance passed: scoped 200, wrong scope/revoked 401; temporary token removed. |
| Signed opt-in webhooks | Manual-delivery preview | HMAC-SHA256 timestamp+raw-body, stable event IDs, metadata only, 3 attempts with 1/5-minute due times. Fresh public IPv4 resolution pinned to TLS, no redirects, size/time bounds. Local/DB tests pass. No external receiver acceptance or always-on worker; delivery requires owner action. |
| Fictional billing order card | Hosted preview | Validated fictional-only USD fixture with demo reference, integer-cent total, payment/refund/invoice/tax status. Missing/invalid fixture is hidden. No lookup or payment execution; review does not imply approval. Mobile/desktop and hide-control tests passed; live release 7ae020501c98 inspected. |
| Proof-to-Pay evidence and reconciliation | Hosted preview | Public GitHub evidence, pinned SHA/checks, fail-closed truncation, known recorded sandbox IDs only. Dedicated public-read token pending. Payment execution OFF. Not escrow. |
| Tax estimate worksheet / CSV | Hosted preview | User-entered USD amounts/rate only. No jurisdiction rules, official rate, tax advice, filing or invoice claim. |

## Still planned within the build window, not complete

- Full repeated versioned eval including owner-note conflict/stale/unrelated, multilingual, injection and style, plus independent testers.
- Negative-feedback and unanswered questions can prepare a reviewed Q&A source; correction still needs owner consent/publication.
- External read-only API client and approved webhook receiver acceptance. No receiver is contacted without owner opt-in.

## Roadmap only

Website scale crawling, sitemap import, OAuth cloud connectors, Slack/WhatsApp/Messenger/Zendesk/Crisp and other helpdesk connectors, iOS app, MCP/CLI/typed SDKs, teams/roles, full history search/export, automatic webhook worker, real merchant onboarding and live payments. No SOC2/HIPAA/GDPR certification, enterprise-ready, zero-hallucination, legal escrow or uniqueness claim.

## Schedule

Feature freeze Nov 4. Nov 4-11 testing/fixes only. Nov 11-12 demo/submission artifacts and buffer. Any unfinished build item at freeze becomes roadmap. Submission target remains subject to owner approval.

## Hardening scorecard - 2026-10-28

"Done" means the stated bounded check passed, not production acceptance. Details in HARDENING.md.

| Track | State | Measured evidence / remaining gap |
| --- | --- | --- |
| Tenant isolation / RLS | Partial | Two synthetic principals in rollback SQL, 15 cross-tenant table denials plus forged write/foreign RPC/secret denial passed. Independent second-browser sign-in and populated full workflow remain pending. |
| Input and abuse guards | Done, bounded | Stream caps on chat/actions/Proof added; existing knowledge caps retained. 6/min process guard bounded to 5000 identities, fail-closed overflow tested. Knowledge 20/case and 100/tenant/day persisted. No distributed general API limiter. |
| Secrets / audit / logs | Partial | Hashed capability tokens, webhook key column denied; metadata-only owner audit max1000, fixed-vocabulary answer gate logs. No external log-retention guarantee or compliance audit. |
| Auth/provider degradation | Partial | Injected auth outage fails closed; source/model gates keep safe fallbacks. DB/model outage does not imply service availability; not full chaos testing. |
| Idempotency | Partial | Existing action CAS, proof locks, revision-safe source saves, exclusive webhook claim tests. General creation still requires checking uncertain provider outcome. |
| Retention / deletion | Partial | Confirmed self-service preview-data deletion; own-data removal and other-user survival tested with rollback fixtures. Auth/provider data/backups/external copies excluded; no age-based purge. |
| Headers / dependency audit | Done, bounded | nosniff/no-referrer/HSTS/limited CSP/permissions policy tested locally; 0 known advisories full npm audit. Full CSP/penetration test not claimed. |
| Status / load sanity | Done, bounded | /status and minimal /api/status, ten concurrent local liveness requests and five unauthenticated route denials pass. No dependency-health or capacity claim. |
| Backup / restore | Partial, unverified | Schema/code in git, not data backup. Free Supabase manual export possible; destination and isolated restore not set up. No restore/RPO/RTO claim. |
| Always-on / managed recovery | Not available under current free deployment | Render free sleeps/restarts; managed Supabase daily backups/PITR require paid tiers. No upgrades, spend, enterprise or SLA claim. |

### Owner intervention overview (live preview)
- `/owner`: private queue snapshot, attention/open/unassigned/taken-over counts, unanswered/negative/refund/handoff cues, recent query text, seven UTC day counts and preview budget. Latest200 tickets/1000 queries/100 requests, explicitly not all-time analytics or an SLA.
- Saved Telegram/email channel preference, minimum priority, reason overrides, quiet hours/timezone and digest preference. Delivery is DB-constrained OFF. A one-per-minute dry run logs eligible ticket counts without customer content or network transport. Latest100 checks retained,20 displayed; owner audit and data deletion cover the new records.
- No external notifications, active worker, provider account, verified sender domain, delivery retries or cross-run delivery dedupe yet. Test-send is disabled. Owner destination/template approval and securely supplied provider credentials are required before delivery. No secret fields are accepted here. Slack/WhatsApp/SMS are roadmap.

### Service-management core (live preview)
- Incident / service request / question, labeled single-owner queues, explicit 3x3 impact/urgency priority matrix with manual override, DB-enforced state transitions. New -> open/pending; open/pending -> each other/resolved; resolved -> open/closed; closed -> open.
- Refund review: request owner review, then record approved/rejected before resolving. Internal metadata only, never payment execution or spending authority. Repeated identical service fields/decisions are no-ops.
- One same-tenant related/potential-duplicate link, no merge or inferred duplicate. Resolved/closed tickets can prepare owner-written Q&A in the same tab. Work notes are never copied automatically; processing/publication still need consent.
- No ServiceNow branding/assets or parity claim. Customer-visible replies/notes, full request catalog, automated knowledge suggestions, target timers/SLA, real teams and automatic duplicate detection are roadmap. Existing owner reporting/audit remains bounded.
- Telegram/email delivery explicitly deferred by owner until readiness review. No token requested or transport built. Draft notification rules remain OFF.

### Minimal dashboard theme
- Shared restrained service-desk navigation, typography, surfaces and spacing across owner overview, tickets and widget studio. Theme selector supports system/light/dark and persists on this browser; widget frame supports its own theme selector too. No paid tier or arbitrary theme scripts.
- Four surfaces checked at390/1280 pixels, light/dark, reload persistence and system preference. Main dark text/muted/link colors on panel exceed4.5:1 by calculation. Not a full accessibility audit; external embeds have their own storage context.

| Operational error logs / health | Hosted preview | Metadata-only instrumented ticket/owner/alert errors, owner view/filter, latest 200/7-day visibility and 500 retained. Explicit health:read token, bounded 24-hour summary; best-effort logs, not uptime/model health. |
| Safe automatic recovery | Hosted preview | Ticket-list transient DB connection/capacity errors only: one 250ms retry with before/after metadata. No automatic writes, provider sends, claim repair, rollback, money, secrets or permission changes. |
