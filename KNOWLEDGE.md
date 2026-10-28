# Knowledge core preview (not deployed)

Owner text/TXT/MD sources are limited to30KB /30 documents. Separate processing consent allows sending text to Gemini; publish opt-in controls exposure to holders of the owner's valid demo capabilities. Supabase RLS isolates documents and chunks. A secret-pattern guard is limited and does not guarantee removal of all secrets.

Text is split into1200-character overlapping chunks with1050-character stride. Gemini Embedding2 generates768-dimensional vectors. The retrieval RPC joins the capability's tenant, published source and chunk ownership, uses cosine similarity >=0.72, and returns at most4 chunks. This threshold is provisional and has not been calibrated on real customer data. Existing pre-vector documents have no chunks and cannot answer until re-imported.

The answer model receives only the question and retrieved excerpts, no tools or credentials. It must cite known source IDs and exact supporting quotations. Quotes must occur verbatim in cited excerpts. A separate model pass checks every factual claim against those excerpts. Missing evidence, invalid citation, model timeout/error, invalid JSON or failed grounding produces a human-review fallback. This is risk reduction, not a zero-hallucination guarantee. Billing status cannot be inferred from knowledge text; the customer panel remains a fictional demo.

Current measured supplied-source smoke tests: initial run6/8 expected outcomes; quote-gated revision7/8; latest modality-preserving revision8/8. A manual review caught one intermediate output changing "can" into "required" even though the initial loose scorer passed it. The test now rejects that obligation drift and the generator/verifier explicitly preserve modality. In the7/8 run, five unanswerable/unsafe cases abstained, two answerable cases returned source-cited answers, and one answerable no-automatic-refund question abstained. No unsupported affirmative answer was observed in these eight synthetic cases, but that is not statistical assurance or end-to-end retrieval evaluation. See knowledge-eval.json for actual outputs. Coverage remains imperfect and deployment is held for diagnosis and retrieval acceptance.

One real fixture pipeline passed embedding -> tenant pgvector RPC (similarity0.830) -> cited answer -> grounding check, with fixtures rolled back. Custom Q&A preparation is implemented as an approved text source, not model fine-tuning.

Not yet implemented: PDF parsing, feedback/history/analytics, calibrated multilingual retrieval, production abuse limits/retention, verified cross-tenant browser test, real merchant billing linkage. The knowledge surface remains a preview; hosted acceptance is the next gate.

Provider references: https://ai.google.dev/gemini-api/docs/embeddings and https://ai.google.dev/gemini-api/docs/pricing . The free API tier may use submitted content to improve Google products. Do not ingest private customer content in this preview.

## Analytics work in progress

Local-only next change logs questions, supported/unanswered flag and source count against a case, with up/down feedback. Owner RLS restricts analytics; public feedback requires the same valid case capability. A case can record up to20 questions. Owner view loads the most recent1000 rows, explicitly not all-time totals, and exports unanswered CSV. This still needs hosted acceptance. Questions must remain fictional/public and the customer panel discloses storage and Gemini processing.

CSV export prefixes formula-leading cells to avoid spreadsheet formula execution. Analytics are recorded demo interactions, not independently verified model quality metrics. The public feedback/logging RPC is capability-scoped, so a holder can submit demo feedback; no anti-fraud claim is made.

## PDF import local preview

PDF.js6.4.299 parses a selected PDF in the browser worker, only from provided bytes. No URL input, attachment opening or document action execution is exposed. Limits:2MB,10 pages,30KB extracted text; a15-second load timeout destroys the task. Page markers help review; tables/layout may be lost. Empty/scanned, invalid-signature and11-page fixtures are rejected. A one-page text fixture imports expected words and leaves processing/publication consent unchecked. File parsing is not an assertion that the text is safe or correct. Review before publishing; secret checks and untrusted-source answer gates still apply. Not deployed yet.

## Persistent question budget next change

Before an embedding/model call, a capability-scoped RPC reserves an interaction under a per-tenant advisory transaction lock. Caps are20 per case and100 per tenant per UTC database day. Failure/timeout consumes the reserved slot and stays unanswered; no automatic refund/retry of the slot. This is a demo abuse bound, not a billing entitlement or complete bot defense.
