# AutomatePal - build brief for Kiro

Last updated: 2026-10-31, commit e7f88bc on `main`.
Live preview: https://automatepal.onrender.com (Render free tier; can sleep on first hit).
Custom domain automatepal.com is registered but DNS is not yet pointed (pending owner action at Spaceship).

This document is the complete handoff: what exists, how it is wired, and the rules for changing it. It names environment variables but contains NO secret values. The repo is PUBLIC - never commit secrets, tokens, or real customer data.

---

## 1. What it is

AutomatePal is a source-backed customer-support and owner-review app, built as a candidate for the PayPal AI Hackathon. A store owner publishes fictional knowledge sources; a website widget answers visitor questions with exact source quotes; anything uncertain becomes a review ticket instead of a guessed reply. Everything is a bounded fictional/sandbox preview: no real customers, no live payments, no automatic outbound messages.

Honesty rails that apply to every change: no fake testimonials, numbers, notifications, or logos; fictional data is labelled fictional; payment execution stays OFF; gauges and charts show real loaded rows or are labelled.

## 2. Stack

- Next.js 16.4.3 (App Router, static prerender where possible), React 19.3, TypeScript strict
- Supabase: Auth (Google OAuth) + Postgres with pgvector (tenant knowledge embeddings)
- Google Gemini via `@google/genai` (support answers, agent, grounding checks)
- PayPal developer sandbox REST (read-only catalog/plan evidence + recorded fictional activity)
- better-sqlite3 (local sandbox ledger for the payments dashboard), `pg` for direct SQL test scripts
- Tailwind 4 (some internal pages) + hand-written CSS design system (public + dash)
- Zod for input validation; Playwright for the 71 verify scripts
- Hosting: Render free web service; DNS: Spaceship (pending); CI: none (local gates)

## 3. Repo layout

```
app/                    Next.js routes (pages + api/)
  page.tsx              Homepage: "video-style" brand hero + specimen section + landing tail
  preview/video/        Origin of the homepage design (video.css is imported by app/page.tsx)
  pricing/ login/ status/ privacy/ terms/ contact/ help/ support/ tax/
  owner/                Owner overview (+ charts.tsx local bars/donut, alerts.tsx)
  tickets/              Ticket workspace
  knowledge/            Sources workspace
  setup/                Guided setup
  support/              Widget studio (page name is support)
  operations/           Metadata-only diagnostics + event flow chart
  dashboard/            PayPal sandbox activity (ag-grid) + volume chart
  integrations/         Read-only API tokens, audit/data controls, webhooks, add-ons
  workspace/            AI studio (agent chat for sandbox provisioning)
  sandbox-catalog/      Owner-only PayPal sandbox catalog/plan evidence
  merchant-demo/ proof/ Public proof + merchant demo surfaces
  components/           DeskShell (top bar/theme), DashShell (dash nav), DemoBanner,
                        charts.tsx (NEW in-house chart primitives), Gauge, dash.css
  api/                  19 route groups (see section 7)
lib/                    Server logic: session/auth, knowledge+embeddings, tickets,
                        agent, paypal, store (sqlite), proof, webhooks, owner-alerts,
                        operations/health telemetry, demo-open (demo fixtures), etc.
db/                     042 SQL migrations, apply in order to a NEW project only
scripts/                71 verify-* gates (Playwright + tsx DB/unit), eval-* harnesses
docs/                   This brief + FEATURES.md (feature matrix with measured limits),
                        HARDENING.md, OPERATIONS.md, PROGRESS.md, MASTER_PLAN.md,
                        SITE_REDESIGN_PLAN.md, DEVPOST.md, SECURITY.md, SEO.md ...
```

## 4. Features (what exists today)

### Public site
- Homepage in the "video design": deep-blue aurora background, pixel-style headline, floating white nav pill, pink CTA, stats row, specimen section (interactive fictional Q&A demo), workflow/boundaries/footer. Dark-first with System/Light/Dark selector.
- `/pricing`: fictional plan picker (Starter/Growth/Scale, monthly/annual math, "$1 for 3 days then plan" preview terms, "Demo only - no checkout"). Prices are arithmetic at 50% of a competitor's listed prices, labelled as such.
- `/login` (Google OAuth; email links limited to approved addresses), `/status` (honest "renders, no uptime promise" page), `/privacy`, `/terms`, `/contact`, `/tax` (user-entered worksheet only), `/help` (one-hour fictional demo case view).

### Support widget (the customer-facing product)
- Lazy Shadow-DOM embed with iframe, brand settings (label, monogram initials, color, starter prompts, side, auto-open, hide order/contact/quotes), exact-origin and excluded-path display controls, tab-session open state.
- Answers come only from published tenant sources: pgvector retrieval (threshold 0.72), exact quotes with source IDs, independent grounding check, conservative fallback to review. Style: 1-3 short sentences, 700-char ordinary / 1600-char how-to guard.
- Exact-match owner custom responses (verbatim, not model-verified), owner guidance/examples with applicability + effective-date windows and stale/conflict checks.
- Multilingual: hosted English/Hindi/Telugu answer checks passed (25-seat fixture).
- Abuse budget: 20 attempts/case, 100/tenant/UTC day, persisted before provider calls; refusals consume slots. 500-char question cap.
- Lead capture: optional fictional email with explicit consent; creates owner review items. Nothing is emailed.

### Knowledge workspace (`/knowledge`)
- TXT/MD/small-PDF text import (2 MB / 10 pages, local extraction), URL import of public pages, CSV extraction with review-before-save; private/unpublished by default; explicit processing + publication consent; atomic revision-checked saves; 30 sources / 360 page units; attempt history; stale-source (90+ days) nudge.

### Tickets (`/tickets`)
- One ticket per fictional case; status/priority/category/tags; owner-only internal notes; recorded timeline (questions, requests, internal events); auto-escalation on unanswered/negative/review signals; capped search/filter/sort; bulk status (max 50); single-owner assignment; first-review and age indicators (no SLA); metadata-only CSV export; formula-safe cells.
- Handoff inbox states: open / attention / taken_over / closed (take over pauses AI for that case).
- Service-management core: incident/service-request/question types, 3x3 impact/urgency priority matrix with manual override, DB-enforced state transitions, refund-review decisions recorded as internal metadata (never refund execution), related-ticket link (no merge).

### Owner overview (`/owner`)
- KPI cards (Needs intervention, Open/new, Unanswered, Negative feedback, Refund reviews, Human handoffs, Taken over, Unassigned), 7/30-day toggle, weekly strip (answered/unanswered/review counts, % answered, % helpful), needs-intervention list with deep links, unanswered themes (word clustering), preview budget (answer/source/page-unit usage), unanswered CSV export, owner notification rules (dry-run only), recent queries.
- Charts (all in-house SVG, brand palette, CSS-animated, reduced-motion safe; no chart library, no copied code): KPI sparklines (daily rows), trend bars with unanswered cap, stacked "Daily mix" bars, "Answered flow" line/area, radial usage rings, split donut. Chart primitives live in `app/components/charts.tsx`; the older bar/donut in `app/owner/charts.tsx`.

### Notifications, digest, alerts
- Saved draft rules (Telegram/email channel, minimum priority, reason overrides, quiet hours, timezone, digest preference). Delivery is DB-constrained OFF; dry run logs eligible counts only. Unanswered-question digest builder (7-day window, grouped). No external sends exist anywhere.

### Operations, status, health
- `/operations`: metadata-only operational events (no text/contacts/secrets), filters, safe-retry record, event-flow line/area chart. Best-effort logs; empty logs are not proof of health.
- `/api/status`: minimal machine status (release = `RENDER_GIT_COMMIT` prefix, mode, paymentExecution flag).
- `/api/v1/health`: scoped bearer API (`health:read` hashed tokens, 1-168h expiry, max 5 active, revocable) returning bounded 24h aggregates + telemetry: events/errors/error rate, failed jobs, dependency probe ms, autoFix counters. Never exposes request IDs or text.
- Safe automatic recovery ("auto-fixer"): ticket-list transient DB connection/capacity errors get ONE retry after 250 ms, recorded with before/after metadata (`SAFE_RETRY_RECOVERED`). No automatic writes, sends, rollbacks, money, secrets, or permission changes.

### Open demo-preview mode (NEW - flag `NEXT_PUBLIC_DEMO_OPEN`, default ON)
- Unauthenticated visitors can VIEW every app surface (`/owner`, `/tickets`, `/knowledge`, `/support`, `/setup`, `/operations`, `/dashboard`, `/integrations`, `/sandbox-catalog`, `/proof`) with in-repo fictional fixtures (`lib/demo-open.ts`): no DB rows, no secrets, no provider calls.
- Every write and the AI chat return read-only 403 in demo mode. Signed-in path is byte-for-byte untouched.
- Pink "Open demo preview" banner (`app/components/DemoBanner.tsx`). SEO split: public pages stay crawlable (robots.txt allows `/`, disallows `/api/`; root layout `index, follow`); all app surfaces + APIs carry `X-Robots-Tag: noindex, nofollow` headers via `next.config.ts`, so demo fixtures stay out of search.
- RE-LOCK BEFORE LAUNCH: set `NEXT_PUBLIC_DEMO_OPEN=false` in Render env and redeploy.

### AI studio (`/workspace`)
- Agent chat that can PROPOSE sandbox actions (create product/plan/order, simulate subscribers). Proposals are explicit pending actions the owner confirms; idempotency via action CAS. Requires Gemini + PayPal sandbox keys; locked (403) in demo mode.

### Proof (`/proof`, `/api/proof`)
- Proof-to-Pay evidence contracts: public GitHub evidence pinned to SHA/checks, fail-closed truncation, reconciliation against recorded sandbox IDs only. Not escrow; payment execution OFF.

## 5. PayPal sandbox integration (the "sandbox thing")

- Server-only client `lib/paypal.ts`: OAuth client-credentials against `https://api-m.sandbox.paypal.com` ONLY (any other base URL throws at module load). Token cached with 30 s early expiry.
- What's wired: live sandbox product/plan GETs for `/sandbox-catalog` (owner-only, first 20 each, validated plan pricing/frequency); recorded fictional events (orders, invoices, subscriptions, payments) written to a local sqlite ledger (`lib/store.ts`) and shown on `/dashboard` (ag-grid + volume line/area); proof reconciliation against known recorded sandbox IDs.
- Plans/trial on `/pricing`: fictional preview terms "$1 for 3 days, then plan" - a UI arithmetic preview. Starter $29.50/mo or $234/yr, Growth $64.50/mo or $474/yr, Scale $214.50/mo or $1,554/yr (labelled "50% of SiteGPT listed prices, arithmetic only"). No checkout exists.
- What is fictional: every customer, order, subscription, and payment; the demo seed actions; all amounts.
- What is OFF (hard, do not enable): payment execution (`PROOF_PAYMENTS_ENABLED=false` on Render), order capture, refunds, payouts, live-mode endpoints, automatic billing. Refund "review" is internal metadata only.

## 6. Design system

- Palette: Deep Blue `#09318D`, White `#FFFFFF`, Bubblegum Pink `#FD91CC`, Navy `#041A52` (text/depth), light surfaces `#E8EDF8`/`#DCE4F5`, muted `#7A88A6`.
- Type: Geist (UI) + Instrument Serif (accents) via next/font; pixel-style headline font on the homepage hero; neo-brutalism x morphism look (hard borders, offset shadows on auth cards, soft glass nav).
- Motion: CSS-only. Reveal system (`.ap-m-line`/`.ap-m-up` staged masks, `.ap-rv` scroll reveal), chart animations (`ap-chart-grow`, `ap-chart-sweep`, `ap-line-draw` stroke draw-in, fade-ins with stagger), beam CTA, aurora background drift. Easing tokens `--ap-e-quint/quart/expo`. Everything is `@media(prefers-reduced-motion:reduce)`-gated.
- CSS architecture: `app/globals.css` (tokens + public landing, loads FIRST), `app/preview/video/video.css` (homepage vp-* design), `app/components/dash.css` (all dashboard surfaces + charts), page-local styles for pricing (`ap-cx`). Landing is dark-first; dash surfaces are pinned light with explicit `color-scheme` and high-specificity control selectors.
- Specificity traps to remember: `.ap-public h1` (0,1,1) beats `.vp-headline` (0,1,0) - scope vp overrides under `.ap-public .vp-*`; `.vp{position:fixed}` needs the `.vp.vp-static` override; globals.css loads before route CSS so equal-specificity overrides lose. Dash form controls need (0,4,0) selectors against `.desk-ui :is(input,select,textarea)`.
- React rules in this repo (react-compiler lint): no `Date.now()`/impure calls during render (thread `nowTs`/anchor through state); no synchronous `setState` in `useEffect` (wrap in `Promise.resolve().then` / `setTimeout 0`).

## 7. Routes and APIs

Public pages: `/` `/pricing` `/login` `/status` `/privacy` `/terms` `/contact` `/help` `/tax` `/merchant-demo` `/proof` (and `/preview/*` design previews).
App surfaces (demo-viewable): `/owner` `/tickets` `/knowledge` `/setup` `/support` `/operations` `/dashboard` `/integrations` `/workspace` `/sandbox-catalog`.

API routes (`app/api/`): `owner-overview`, `owner-alerts`, `tickets` (GET list/detail, POST updates), `knowledge` (+`/custom`, `/analytics`, `/import-url`, `/test-answer`), `support` (widget settings + demo case token view), `operations`, `dashboard`, `integrations` (read-only tokens), `webhooks` (signed opt-in, HMAC-SHA256, 3 attempts), `account-data` (audit), `sandbox-catalog` (PayPal reads), `proof`, `actions` (pending agent proposals), `chat` (AI studio), `demo` (seed simulation proposal), `setup/verify-install` (fetches the owner's own test page), `widget` (public embed runtime), `status`, `v1/health` + `v1/demo` (scoped bearer).

Auth pattern: `authenticate(req)` in `lib/session.ts` (Supabase bearer, email-confirmed required) -> 401. Demo mode interposes `demoGate(req, key)`: GET -> fictional fixture; non-GET -> read-only 403. All routes enforce origin checks, body-size caps, rate guards, and zod parsing. Fail-closed everywhere: a dependency error returns an explicit unavailable message, never partial or stale data.

## 8. Environment variables (NAMES ONLY - values live in the vault/Render env)

Public/build: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable anon key, never service-role), `NEXT_PUBLIC_APP_ORIGIN`, `NEXT_PUBLIC_DEMO_OPEN`.
Server-only: `GEMINI_API_KEY`, `GEMINI_MODEL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE` (sandbox only), `APP_OWNER_EMAIL`, `APP_URL`, `DATABASE_PASSWORD_FILE`, `DATA_DIR`, `GITHUB_PUBLIC_READ_TOKEN`, `INSTALL_CHECK_ALLOW_HOSTS`, `PROOF_PAYMENTS_ENABLED` (keep `false`), `RENDER_GIT_COMMIT`/`RENDER_EXTERNAL_URL` (Render-provided), plus test-only `PENDING_*`/`TEST_PENDING_*` gates.

## 9. Guardrails (non-negotiable)

1. Payment execution OFF. Never enable `PROOF_PAYMENTS_ENABLED`, never call live PayPal, never capture/refund.
2. Fictional data only; label it. No real customer data, no real sends (email/Telegram/webhook delivery are opt-in drafts or off).
3. The repo is PUBLIC: no secrets in code, tests, fixtures, docs, or git history. Vault/Render env only.
4. Asset licenses: in-house rebuilds only for referenced designs. Magic UI/HyperUI (MIT), Aceternity free, Lucide (ISC), Geist/Instrument Serif (OFL) are allowed; mebius.design, Aura, OnlineWebFonts, stranger CloudFront are reference-only (license bars embedding) - the chart types were rebuilt from scratch for this reason.
5. No schema/permission changes on the live Supabase without the owner's explicit go.
6. Verify contracts (`scripts/verify-*.mjs`) are the spec: fix the page, never the expected strings. Existing scripts pin `NEXT_PUBLIC_DEMO_OPEN=false` to test the LOCKED behavior; `scripts/verify-demo-open.mjs` tests the OPEN behavior.
7. Free tiers only; no spend.
8. Fail closed: no partial data on dependency errors; disclaimers stay verbatim.

## 10. Run and verify

```sh
npm ci
cp .env.example .env        # fill privately; never commit
npx tsc --noEmit            # gate 1
npx eslint app lib          # gate 2
npm run build               # gate 3
node scripts/verify-landing.mjs        # plus the verify-* scripts for any page you touch
node scripts/verify-demo-open.mjs      # demo-mode contract
```

- 71 `scripts/verify-*` gates: Playwright UI contracts (they boot `npm run start`, intercept `/api/**`, assert exact strings, screenshots, no mutations, no overflow at 1280/390, light+dark) and tsx DB/unit checks. Run each with its exit code captured directly (piping masks it) and `pkill -f 'next start'; sleep 2` between runs (port races cause false failures).
- Eval harnesses: `scripts/eval-knowledge*.ts`, `eval-owner-guidance.ts`.
- DB: apply `db/001..042` in order to a NEW isolated project only; migrations are mostly non-idempotent.

## 11. Deploy

- Render free web service (`automatepal`), region/config in dashboard; build `npm run build`, start `npm run start`. Health: `/api/status` must show the deployed commit prefix.
- Auto-deploy "On Commit" is configured but does NOT reliably fire on push - deploy manually: dashboard -> Manual Deploy -> "Clear build cache & deploy".
- GOTCHA: Render's build cache can serve a STALE CSS bundle after a normal deploy (HTML new, stylesheet old). After every deploy, verify the SERVED css chunk contains the brand palette (`09318d`), not just the commit hash. If stale: Clear build cache & deploy.
- After DNS is pointed (owner action): add/verify custom domains in Render, wait for certs, then re-check `https://automatepal.com`.
- Drive backups: `git archive` tarballs per milestone live in the owner's Drive folder.

## 12. Known gaps and roadmap

- DNS for automatepal.com not yet pointed (owner passkey step at Spaceship).
- Second-user/independent acceptance, full versioned eval suite, external webhook receiver acceptance pending.
- Render free tier sleeps (cold starts); no SLA; backups are schema/code only.
- Notification delivery, customer reply transport, live payments: OFF by design until owner readiness review.
- Logo refresh: two candidate marks proposed, owner pick pending.
- Schedule: feature freeze Nov 4, testing Nov 4-11, submission artifacts Nov 11-12, final Nov 13 01:30 IST. Unfinished items at freeze become roadmap (connectors, crawling, teams, iOS, MCP/SDK, real onboarding).

## 13. If you only remember five things

1. Payments and external sends stay OFF; fictional data is labelled fictional.
2. `NEXT_PUBLIC_DEMO_OPEN=false` + redeploy re-locks every app surface before launch.
3. Fix pages to pass the verify scripts; never edit their expected strings.
4. After deploying, check the SERVED bundle (CSS chunk + /api/status), not the commit alone.
5. Secrets never touch this repo - it is public.
