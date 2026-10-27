# Devpost submission draft - AutomatePal

## Tagline
An AI billing & revenue copilot for indie founders - describe your product in chat, get live PayPal billing.

## Inspiration
Indie founders ship products fast but stall on billing: PayPal's APIs are powerful yet take days to wire up - products, plans, checkout, invoices, dunning. Most founders just want to say "I sell X for $12/month" and start charging. We asked: what if an AI agent did the whole setup, and then stayed on as your revenue analyst?

## What it does
AutomatePal is a chat-first billing copilot:
- Turns a plain-English product description into real PayPal catalog products, subscription plans, checkout orders and invoices (sandbox)
- Creates shareable checkout/subscribe links on the spot
- Answers revenue questions - MRR, total revenue, active subscribers, failed payments - grounded in a live billing ledger
- Detects failed payments and drafts personalized dunning emails per customer
- Seeds realistic demo subscribers so judges see a living dashboard in one click
- Every event lands in an AG Grid revenue dashboard - sortable, filterable, with MRR/revenue/failure cards

## How we built it
- Next.js 16 + React 19 + Tailwind, deployed on Render
- PayPal sandbox REST APIs: Catalog (products), Billing (plans, subscriptions), Checkout Orders, Invoicing, authenticated via OAuth client credentials
- Google Gemini 2.5 Flash with function calling: 9 typed tools wrap the PayPal APIs and the ledger; the model plans multi-step actions (e.g. create product -> create plan -> return subscribe link)
- AG Grid Community powers the revenue dashboard
- A local JSON ledger keeps every billing event consistent for stats and dunning

## Challenges
Sandbox reporting APIs are sparse for subscription analytics, so we designed the ledger to capture every agent action as a queryable event stream - which also made dunning detection reliable (latest payment state per customer).

## What we learned
Function calling turns "billing setup" from a week of integration work into a conversation. Keeping tool schemas tight (9 verbs) made the agent far more reliable than free-form API access.

## What's next
Webhook-driven live payment events, Braintree support, YStartups verified-revenue badges for startups using AutomatePal, and multi-currency MRR.

## AI tools used
- Google Gemini 2.5 Flash - agent reasoning + function calling
- AG Grid Community - revenue dashboard
- Render - hosting
- Built with AI pair-programming

## Sponsor prizes targeted
Best Use of AG Grid, Best Use of Render

## Trademark & endorsement note
PayPal is a trademark of PayPal, Inc. AutomatePal is not affiliated with, sponsored by, or endorsed by PayPal - it is an independent project that uses the public PayPal developer platform (sandbox). No PayPal logos or brand assets are used in the app, repo, or video.
