# AutomatePal production plan

Written 2026-11-09. SiteGPT's side was re-checked live today (sitegpt.ai/features and /pricing).

**Rule for this plan: extend and harden what exists, don't rebuild.** Every item below names the files it changes. New tables are added only where nothing existing can carry the data, and always as additive migrations after `db/053`.

**Goal:** a merchant signs up, pays through PayPal (sandbox for now), adds content, and pastes one script tag on any website. The first production customer is automatepal.com.

---

## 1. What we already have and keep

| Built | Where it lives | Production work needed |
| --- | --- | --- |
| Visitor conversation with a hashed token, expiry, handoff, owner replies | `support_cases` (`db/006`, `024`, `045`), `app/help`, `app/api/support/route.ts` | Make cases come from a permanent key instead of a one-hour owner link (Phase 1) |
| Widget loader, Shadow DOM, lazy iframe, JS SDK, events | `public/widget.js`, `lib/widget.ts`, `app/api/widget/route.ts` | Accept a bot key alongside the demo token (Phase 1) |
| Widget settings and controls (branding, origins, paths, working hours, follow-ups) | `widget_settings` (`db/008`, `023`, `027`), `lib/widget.ts` zod schema | Origins become enforced for keys (Phase 1) |
| Install guide per platform and install checker | `app/setup/page.tsx`, `app/api/setup/verify-install`, `lib/install-check.ts` | Switch the snippet to the key; add plugin downloads (Phase 1) |
| Knowledge: files, URL, crawler, refresh, Q&A, custom answers | `lib/knowledge.ts`, `lib/crawl.ts`, `lib/refresh.ts`, `lib/url-import.ts`, `db/009–022`, `050–053` | Plan limits and larger caps (Phase 2) |
| Answering with quotes and grounding, injection guard, model access | `app/api/chat`, `lib/llm.ts`, `lib/gemini-retry.ts`, `lib/prompt-guard.ts` | Per-plan budget, model choice (Phases 2–3) |
| PayPal client with subscriptions and orders | `lib/paypal.ts` (`createSubscription`, `getSubscription`, plans, orders), sandbox plans from `app/sandbox-catalog` | Reuse for our own checkout (Phase 2) |
| Billing support for merchants' customers across 10 providers | `lib/billing/**`, `db/044`, `app/billing` | Real test accounts per provider (Phase 4) |
| Teams and roles | `workspace_members`, `workspace_invites` (`db/043`), `app/team` | Seat limits from plan (Phase 2) |
| Email (Resend) with dry run, caps and log | `lib/email.ts`, `db/048` | Dunning and receipt templates (Phase 2) |
| Cron entry point | `app/api/cron/refresh/route.ts`, `lib/cron.ts` | Call it from a Cloudflare Cron Trigger instead of GitHub Actions (Phase 0) |
| Webhooks out | `lib/webhook.ts`, `db/026` | Automatic delivery from the cron or queue (Phase 3) |
| Rate limiting | `lib/rate-limit.ts` `allowRequest()`, used by 26 routes; `lib/mcp/http.ts` | Swap the implementation, not the call sites (Phase 0) |
| Error capture, CSP, legal pages, `APP_MODE` | `instrumentation.ts`, `lib/server-errors.ts`, `proxy.ts`, `lib/csp.ts`, `lib/legal.ts`, `lib/app-mode.ts` | Fill company details, switch to production (Phase 5) |
| Test suites | `scripts/verify-*.ts/.mjs`, `npm run test:*` | Run them in CI (Phase 0) |

### The real gaps

1. **The install doesn't last.** `create_demo` in `app/api/support/route.ts:113` makes a `support_cases` row that expires after one hour, and `widget.js` needs that token. There's no long-lived key.
2. **Nobody can pay us.** `lib/paypal.ts` can create subscriptions, but nothing records who subscribed, receives PayPal webhooks, or limits usage by plan.
3. **Free-tier infrastructure:** no backups, no staging, and in-process limits that don't work across Cloudflare isolates. Hosted DB migrations 044–053 haven't been applied, and four production secrets are missing.
4. **Global $1/day model cap** (`LLM_DAILY_USD_CAP`). Also confirm the Gemini key is on a paid tier, since free-tier data may be used for training.

> Hackathon deadline is **Fri Nov 13, 01:30 IST.** Tag the current build (`submission-2026-11`) before Phase 1 merges.

---

## 2. Phases

### Phase 0: Make what exists deployable (≈ 3 days)

- **Staging:** add an `env.staging` block to `wrangler.jsonc` and create a second Supabase project. Apply `db/001–053` in order to staging and run the existing `verify-*-db` suites. Then apply `043–053` to prod.
- **Secrets:** set `BILLING_ENCRYPTION_KEYS`, `BILLING_RPC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` with `wrangler secret put`, and add them to `.env.example` docs (names only).
- **CI:** one workflow that runs the existing `npm run lint`, `build` and `test:*` scripts on every PR. Deploy to staging on merge and to prod on tag. No new tests are needed to start.
- **Rate limiting:** keep `allowRequest(key, now, max)` and back it with a small Postgres table plus an RPC (`db/054_rate_limits.sql`) in place of the `Map`. The function becomes async, so the 26 call sites gain an `await`, which is a mechanical change. Do the same in `lib/mcp/http.ts`.
- **Cron:** add a `triggers.crons` entry in `wrangler.jsonc` that calls the existing `/api/cron/refresh` handler. Keep the GitHub workflow as a fallback, and keep `uptime.yml`.
- **Backups:** Supabase Pro (needs your OK), plus a nightly `pg_dump` from a GitHub Action to an encrypted R2 bucket, with one restore into staging.

**Gate:** staging deploys from CI, all existing suites are green in CI, and the restore works.

### Phase 1: Permanent install (≈ 1 week). *Biggest gap*

> **Status 2026-11-09:** core built on branch `phase-1-install` (stacked on `phase-0-foundation`): db/055 keys, `/api/widget` key mode, `/api/widget/session`, `widget.js` `data-bot`, signed `frame-ancestors` grant, per-conversation cap, Setup step 4 card, tests (DB 29, frame 20, end-to-end 14). Still open in this phase: WordPress plugin, Shopify app embed, GTM recipe, `@automatepal/react`, logo upload, widget string translations, per-page starters. Needs `WIDGET_FRAME_SECRET` and migration 055 before deploy.

This reuses the case model instead of replacing it:

- **Bot key** (`db/055`): add `public_key` (text, unique, `pk_live_…` / `pk_test_…`), `key_rotated_at` and `active` to `widget_settings`. One widget config per workspace is the bot for now.
- **`widget.js`:** accept `data-bot="pk_…"` *or* the existing `data-demo-token`. With a key, the loader calls a new `POST /api/widget/session`. That endpoint checks the key and the `Origin` against the bot's allowed origins, then creates a `support_cases` row exactly as `create_demo` does today: a 24-hour expiry, a per-visitor case and the same hash. It returns the case token. From there everything (`/help`, chat, handoff, owner replies, billing lookups) runs unchanged. The token is kept in the visitor's `localStorage` and renewed when it expires.
- **Origins become enforced for keys:** `widgetPageAllowed()` in `lib/widget.ts` is already called in `app/api/widget/route.ts`. Call it in `/api/widget/session` too, and add the bot's origins to `frame-ancestors` for `/help` in `lib/csp.ts`. Demo tokens keep today's behaviour.
- **Abuse limits:** per-key and per-IP limits on session creation using the Phase 0 limiter. Add an owner setting "max messages per conversation" to the existing controls schema in `lib/widget.ts` (SiteGPT's "Rate Limiting"), enforced where `/api/support` already counts attempts. Add Cloudflare Turnstile only if session creation spikes.
- **Dashboard:** in `app/setup/page.tsx`, step 4 shows the permanent snippet with copy, rotate and disable buttons. The one-hour demo stays as a "Try it first" option. `verify-install` already parses the page, so extend it to match `data-bot`.
- **More install paths** (thin wrappers around the same script tag): the existing per-platform steps, plus a GTM recipe, a tiny WordPress plugin (one settings field), a Shopify theme app embed, and an `@automatepal/react` component.
- **Tests:** extend `verify-widget-sdk`, `verify-widget-pages` and `verify-csp` to cover the key path, a wrong origin, a revoked key and an expired-then-renewed session.

**Gate:** a fresh staging account installs on a static page, WordPress, a Shopify dev store and a Next.js app. A wrong origin and a revoked key are refused.

### Phase 2: Our own subscriptions on PayPal sandbox (≈ 1 week)

- **Plans:** activate the six `CREATED` sandbox plans already recorded via `app/sandbox-catalog`, and map their ids in a config file.
- **Checkout:** a PayPal JS SDK subscription button on the existing `app/pricing/page.tsx` and in a dashboard "Plan" card. Approval returns the subscription id to a new `POST /api/billing/subscribe`, which verifies it with the existing `getSubscription()` in `lib/paypal.ts` before saving.
- **State** (`db/056`): one `workspace_subscriptions` table (workspace, PayPal subscription id, plan key, status, period end) and `paypal_webhook_events` (event id, for idempotency).
- **Webhooks:** `POST /api/paypal/webhook`. Add `verifyWebhookSignature()` to `lib/paypal.ts` (a POST to `/v1/notifications/verify-webhook-signature`) and handle the `BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.*` events.
- **Limits:** one `lib/plans.ts` table (bots, messages per month, pages, seats, refresh frequency, features). Enforce it at points that already count things:
  - the knowledge quota in `lib/knowledge.ts`
  - the answer budget in `/api/support`
  - the seat cap in `db/043`'s invite RPC (today a fixed 25)
  - refresh frequency in `lib/refresh.ts`
  - feature gates on `/integrations`, `/mcp` and `/billing`
- **Model budget:** replace the single `LLM_DAILY_USD_CAP` check in `lib/llm.ts` with a per-workspace monthly allowance from the plan, and keep the global cap as a safety net.
- **Lifecycle emails** (renewal, payment failed, cancelled): use new templates in the existing `lib/email.ts`. Keep a 7-day grace period, then read-only.
- `PROOF_PAYMENTS_ENABLED` stays `false`. It belongs to the Proof feature, not to checkout.

**Gate:** in the sandbox, subscribe, renew (webhook simulator), fail, recover, upgrade and cancel all work, and the limits block correctly.

### Phase 3: Close the SiteGPT gaps on top of existing modules (≈ 2–3 weeks)

| SiteGPT feature | Build on | Change |
| --- | --- | --- |
| Fast / deep model choice | `lib/llm.ts` (already has Gemini plus `ANTHROPIC_MODEL`) | A per-bot setting in the controls schema; deep messages count 10× against quota |
| Multiple chatbots | `widget_settings` + knowledge tables | Add `bot_id` (defaulting to the existing row) once Phase 1 and 2 are stable; the plan limit decides how many |
| YouTube, GitHub, DOCX, Drive, Notion import | `lib/crawl.ts` / `lib/url-import.ts` feed the same review-and-consent path | New source adapters only; the save path is unchanged |
| 95+ languages in the widget UI | `app/help` strings | Pull strings into a dictionary and pick by `navigator.language` |
| Fix answers from history | `app/history`, `app/api/knowledge/custom` | A "Write an answer" button on a transcript, using the same flow the insights page already links to |
| Real-time webhooks | `lib/webhook.ts`, cron handler | Deliver due events in each cron run instead of manually |
| Public chat / refresh API | `app/api/v1`, `readonly_tokens` scopes | New scopes `chat:write` and `sources:refresh` on the same token table |
| Slack, Zendesk, WhatsApp handoff | Ticket events + `lib/email.ts` alert hooks | A notifier interface beside email; Slack first |
| Mobile inbox | `app/tickets` | Add PWA support (`app/manifest.ts` exists) plus Web Push for "person requested" |
| GDPR / DPA | `app/legal/*`, `lib/legal.ts` | Complete the subprocessor list and company details. No certification claims. |

### Phase 4: Lead with what SiteGPT doesn't have

Billing support for 10 providers (`lib/billing`), the service desk with refund review, quoted answers with a grounding check, and the MCP server. The production work is to test each billing provider against a real test account. Until then, label it **Beta** in `app/components/home/billing-providers.ts`.

Candidate add-ons, each reusing an existing module. Pick which ones:
1. Shopify / WooCommerce order tracking, as a new adapter under `lib/billing/providers`, with the same verify-then-read flow.
2. Pause or cancel requests that go to the refund-review style approval in Tickets.
3. CSAT after a conversation, extending the existing up/down feedback.
4. Proactive messages, a new `widget.js` trigger driven by controls.
5. White-label and agency (remove "Powered by", custom domain).

### Phase 5: Hardening (≈ 1 week)

- An external penetration test of the widget key path, `/api/support`, `/mcp` and the PayPal webhook. Fix every high or critical finding.
- Grow the existing `knowledge-eval.json` / `eval:knowledge` set to 200+ cases and run it in CI on prompt or model changes.
- Load test with `scripts/load-check.mjs` pointed at staging, extended to the session and chat endpoints.
- Fill the `lib/legal.ts` company details, get a legal review, and set `APP_MODE=production`.

### Phase 6: Our own site first, then live payments

1. Create a prod workspace "AutomatePal Support". Crawl `/docs`, `/pricing`, the FAQ and the legal pages with daily refresh (existing crawler).
2. Connect our PayPal sandbox in `/billing` so subscribers can ask about renewals and invoices.
3. Turn on handoff, working hours (IST) and email alerts.
4. Put the `data-bot` snippet in `app/layout.tsx` for marketing routes, with dashboard routes in excluded paths.
5. Run it for 1–2 weeks and review transcripts weekly.
6. **Your call:** switch to live PayPal credentials and plans, then run one real purchase and refund.

---

## 3. Decisions needed from you

1. Spend: Supabase Pro (+PITR), Workers Paid, paid Gemini/Anthropic budget, pentest.
2. Trial: keep $1 / 3 days, or 7 days with a card like SiteGPT.
3. Which Phase 4 add-ons.
4. Company legal details.
5. When to switch PayPal to live.
