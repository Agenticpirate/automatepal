# Submission working draft - NOT approved to publish

## Proposed title
AutomatePal: evidence-first support with PayPal sandbox plan context

## Short description
A fictional-data support preview that answers from selected sources, reads actual PayPal sandbox plan configuration for price/frequency questions, and routes sensitive requests to an owner without moving money.

## Problem and audience
Small software sellers answer product and billing questions across separate systems. A confident answer can be wrong if it treats a plan configuration as a customer's paid subscription or promises a refund before review. This prototype keeps the evidence and the owner's review distinct.

## What works in the current preview
- Tenant-scoped published knowledge, source quotes, relevant dated owner guidance and conservative fallback.
- A private ticket queue with type, impact/urgency priority, status guards and internal refund review.
- Owner-only PayPal sandbox catalog/plan GETs. A selected-plan question refetches the record, asks Gemini, then checks grounding separately against exact quoted fields. No transaction/customer data.
- Metadata-only diagnostics, scoped expiring health reads, and narrow tested safe retry behavior.

One hosted read returned the existing Hosted Demo Pro plan's regular USD12/month configuration and answered its price/frequency question with an exact JSON quote. This is one measured example, not a correctness rate. ACTIVE plan status is not a paid subscription or revenue. Customer eligibility and transaction/refund questions are refused in this view. Other source questions can still miss relevant answers; recorded failures remain in the evidence.

## Meaningful use of tools
PayPal sandbox supplies the actual selected catalog plan's current price/frequency record. Google Gemini answers from that source and a separate model call checks support; the general knowledge experience also uses Gemini embeddings. Supabase Auth/Postgres/vector handles isolated workspace state and retrieval. Next.js/React/TypeScript/Tailwind provide UI/server routes, AG Grid Community renders the legacy ledger view, Render Free hosts the preview, SQLite is a local-development fallback only. Final submission must name actual coding assistants/AI services used; do not publish a guessed list.

## Limits to show, not bury
No real funds, payment execution OFF, no customer send, no enterprise/SLA/certification claim. Preview quotas and history are bounded. Free hosting may sleep. No independent backup/restore or complete security audit proof. Public marketing specimen is local illustration. Owner-only sandbox credentials are not available to judges; public judge route approval is pending. Own-key self-host instructions are in README, but isolated full-provider setup remains unverified. Organizer eligibility is not confirmed by one working read.

## Links for final review
- Demo: https://automatepal.onrender.com/
- Owner-only measured flow: https://automatepal.onrender.com/sandbox-catalog
- Public MIT repo: https://github.com/Agenticpirate/automatepal
- Video: NOT CREATED / no public URL.

## Approval checklist
Final actual text, tool list, screenshots, rights-safe video, public audience and links need Ravi approval before upload/submission. No submission or upload is authorized by this draft. Do not claim production-ready to accelerate publication.
