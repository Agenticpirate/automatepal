# AutomatePal

Source-backed support and owner review, with a read-only PayPal sandbox plan-evidence flow. Built with Next.js, Supabase, Google Gemini and the PayPal developer sandbox for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## Status and safety

Hosted fictional preview, not production/enterprise-ready: https://automatepal.onrender.com/ . See [FEATURES.md](FEATURES.md), [HARDENING.md](HARDENING.md), [OPERATIONS.md](OPERATIONS.md) and [PROGRESS.md](PROGRESS.md) for measured tests, failures and remaining gates. The marketing interaction is local illustration, not a functioning AI demonstration.

Free tiers only. No real customer data, live credentials or funds. Payment execution stays OFF. Do not turn it on to run the demo. Refund review is internal metadata, never refund execution. Catalog plan configuration is not a paid subscription, revenue or customer eligibility. No automatic customer email/Telegram transport or production-money mode. Free Render services can sleep and delay startup; no SLA, independent security certification or backup/restore proof.

## Judge / tester paths

- `/login`: Google OAuth sign-in to a private owner workspace, then `/setup` for guided fictional source/brand/test steps and `/support` for the widget studio. Email link delivery is limited to approved addresses; use Google for the hosted preview. One-hour demo capabilities are not permanent judge links. Fresh-session independent acceptance is still required.
- `/knowledge`: explicitly consent to processing and separately publish fictional text before using it for support. Private/unpublished is the default. Ordinary tenant budget100 answer attempts/UTC day and20/case; unsupported attempts count. Quotas and model availability can change.
- `/tickets` and `/owner`: single-owner fictional review queue and bounded reporting. No customer reply transport.
- `/sandbox-catalog`: owner-only live sandbox catalog/plan reads, no business writes. Visitors cannot use the project's owner sandbox; self-host with your own app/owner account below. Selected-plan AI explanation needs explicit per-question consent and uses10 attempts/owner/UTC day; refusals/errors remain visible. Current hosted acceptance is in PROGRESS, not assumed from this route's existence.
- `/operations`: metadata-only scoped diagnostics, not uptime or all-route error proof. Health bearer scope is separately explicit and expiring. Never publish a bearer token.

## Fresh self-host setup

Node22 and npm are recommended. Use your own free-tier projects and check their current limits. These instructions do not provide keys, hosted database content or a one-click production deployment.

```sh
npm ci
cp .env.example .env
# Set keys privately in .env, never in source or NEXT_PUBLIC secret variables.
```

1. Create a Supabase project with Auth and Postgres/vector extension support. Record its project URL and public anon key in `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. These public client identifiers are not service-role credentials. Never put a service-role key into browser configuration.
2. Apply `db/001_*.sql` through `db/042_*.sql` in numeric order to this NEW isolated project using a trusted SQL connection/editor. Review each migration first. Many migrations are non-idempotent: do not replay the whole directory on an existing database. This is schema setup, not a backup/restore procedure. Scripts with `DATABASE_PASSWORD_FILE` need a privately stored password and correct target configuration; existing DB test scripts name the development project's host and must be adapted for your isolated project before use.
3. Configure Supabase Google OAuth and your own Google OAuth app. Allow the Supabase callback shown by its dashboard, then add your local `http://localhost:3000/workspace` and any approved deployment redirect in Supabase Auth URL settings. Do not paste OAuth secrets into the repo. Sign-in/provider verification and any free-account limits are part of your own setup. Default email SMTP is limited.
4. Create your own PayPal sandbox app at https://developer.paypal.com/dashboard . Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and the fixed `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com`. Never use live credentials. `APP_OWNER_EMAIL` must exactly match your intended signed-in Google account email. Read-only catalog view requires existing fictional sandbox catalog/plan configuration; it will not seed or create any automatically. An empty account yields empty lists, not an invented demo.
5. Obtain your own free-tier Gemini API key at https://aistudio.google.com/apikey and set `GEMINI_API_KEY`. Current code defaults `GEMINI_MODEL=gemini-3.1-flash-lite`, embeddings `gemini-embedding-2` at768 dimensions. Check model availability, terms and quota in your own project; do not authorize a paid upgrade. Missing/limited provider access gives an explicit safe fallback, not proof of a working answer.
6. Keep `PROOF_PAYMENTS_ENABLED=false`. No live payment mode exists. This flag governs the proof execution path; legacy studio actions have separate review gates and must not be used as part of the read-only catalog demonstration. Do not confirm any creation/payment proposal to run this demo.

```sh
npm run dev
# Open http://localhost:3000/login, sign in, then visit /setup or /sandbox-catalog.
```

Authenticated application data uses tenant-scoped Supabase tables/RPCs. SQLite `data/automatepal.sqlite` is only an unauthenticated local-development ledger fallback; production requests refuse that fallback. Ephemeral disk is not durable data storage. You need your own DB and configured auth for the functioning multi-user application.

## Reproducible local checks

```sh
npm run lint
npm run build
npm run test:safety
npm run test:hardening
npm run test:widget
npm run test:tickets
npm run test:billing
npm run test:webhook
npx tsx scripts/verify-sandbox-catalog.ts
npx tsx scripts/verify-health-deadline.ts
node scripts/verify-catalog-pages.mjs
node scripts/verify-operations-pages.mjs
```

Playwright page suites use synthetic intercepted API responses and launch a local production server. Install the Playwright Chromium dependency in your own environment if absent. They prove UI/guards, not actual PayPal/model integration. SQL suites use transactions/rollback and synthetic identities but must target an approved isolated DB; do not run against real customer data. `scripts/test-paypal.mjs` performs sandbox reads with your own keys. Provider tests require network/credentials and can consume free quotas. Do not present skipped credential-dependent tests as passed.

## Deployment

Existing preview uses Render Free and Supabase; `render.yaml` is a starting template, not complete auth/DB provisioning. Configure all `.env.example` values privately, authorized redirect URLs and migrations in your own isolated environment. Use `npm ci && npm run build` then `npm start`. Recheck exact `/api/status` release and execution flag and sign-in/affected flow after every deploy. Versioned code/migrations are not a data backup. No production recovery/RPO/RTO claim.

## Tools, licenses and independence

Next.js/React/TypeScript/Tailwind UI; Supabase Auth/Postgres/vector; PayPal sandbox REST catalog/plan reads; Google Gemini generation, separate grounding checks and embeddings; AG Grid Community ledger view; SQLite local-development fallback; Render preview hosting. List actual coding assistants and AI services used in the final submission. Do not claim an unused sponsor integration.

PayPal is a trademark of PayPal, Inc. This independent project is not affiliated with or endorsed by PayPal and uses no PayPal logo. Product name not trademark-cleared. MIT for original project code, root [LICENSE](LICENSE); dependencies retain their licenses. No public submission/video upload is approved by this README.
