# AutomatePal

An independent AI billing copilot experiment built with the PayPal developer platform (sandbox), Google Gemini and AG Grid. Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## Current status

Development beta, not production-ready. No live payments, no real funds, no automatic customer email. Public hosting and account isolation are still being implemented. Do not supply live credentials or real customer data.

Verified locally:
- Sandbox OAuth and catalog/plan listing.
- Gemini function calling lists existing products and creates a catalog product followed by a USD monthly plan.
- Transactional SQLite events; fictional demo events are separate from PayPal sandbox events.
- Validation rejects negative amounts and real invoice-recipient domains. Invoice tool creates drafts only.
- Production build and TypeScript pass.

Implemented but requiring further acceptance tests: checkout order creation, invoice drafts, failure summaries, and AI-written dunning drafts. Subscription activation, completed checkout capture, verified webhooks and recurring-payment reconciliation are not complete. Creating a plan is not a subscription or revenue.

## Run locally

Node 22 is recommended.

```sh
npm ci
cp .env.example .env
# Fill in sandbox credentials and your Gemini key privately.
npm run dev
```

Open http://localhost:3000 and `/dashboard`.

Get sandbox app credentials at https://developer.paypal.com/dashboard and a Gemini API key at https://aistudio.google.com/apikey. Never commit `.env` or place API secrets in browser code. The tested model is `gemini-3.1-flash-lite`; availability and quotas can vary. Use your own free-tier project and check its limits.

```sh
node --env-file=.env scripts/test-paypal.mjs
node --env-file=.env --import tsx scripts/verify-core.ts
npm run build
```

The verification script reads sandbox data and validates inputs. It does not create purchases or email customers. All demonstration identities must be fictional.

## Data and deployment

SQLite uses `data/automatepal.sqlite` locally. It must not be used as durable storage on an ephemeral free hosting filesystem. Managed Postgres, authenticated workspace isolation, rate limiting and durable audit records are prerequisites for the hosted beta. `render.yaml` is deployment preparation, not evidence of a live deployment. No production-money mode is available.

## Tools and dependencies

- Next.js, React, TypeScript and Tailwind
- PayPal sandbox Catalog, Billing, Checkout Orders and Invoicing APIs
- Google Gemini 3.1 Flash-Lite for function calling and response generation
- AG Grid Community (MIT) for the ledger dashboard
- SQLite for transactional local development
- Render is the intended hosting platform, not yet a verified deployment
- AI-assisted implementation; final submission must list the coding assistants and AI services actually used

## Trademarks and independence

PayPal is a trademark of PayPal, Inc. AutomatePal is an independent project, not affiliated with or endorsed by PayPal. Factual references describe API integration, not a partnership or certification. The app does not use a PayPal logo. The project name has not received trademark clearance or approval from PayPal. Third-party software keeps its own license and trademarks.

## License

MIT for the original project code. Third-party dependencies retain their respective licenses.
