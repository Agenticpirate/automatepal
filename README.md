# FounderPay Agent

An AI billing & revenue copilot for indie founders, built on the **PayPal developer platform (sandbox)** and **Google Gemini**.

Tell the agent about your product in plain English. It creates PayPal products, subscription plans, checkout orders and invoices in your sandbox, answers revenue questions (MRR, failed payments), and drafts dunning emails. A live **AG Grid** dashboard shows every subscription, payment and failure.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Nov 2026).

## Features

- **Chat-to-billing**: "I sell a template pack for $19" -> PayPal product + checkout link
- **Subscriptions**: creates catalog products and monthly billing plans
- **Invoices**: creates and sends PayPal invoices to any customer email
- **Revenue Q&A**: MRR, total revenue, active subscribers, failed payments
- **Dunning**: surfaces failed payments and drafts recovery emails
- **Demo seeding**: one command seeds realistic subscriber activity
- **AG Grid dashboard**: sortable/filterable ledger of every billing event

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind
- PayPal sandbox REST APIs: Catalog, Billing Plans/Subscriptions, Checkout Orders, Invoicing
- Google Gemini (function calling) as the agent brain
- AG Grid Community for the revenue dashboard
- Deployed on Render (free tier)

## Run it

```bash
cp .env.example .env   # fill in your keys
npm install
npm run dev
```

Open http://localhost:3000 - chat with the agent, then open `/dashboard`.

You need:
1. A **PayPal developer account** (free): create a sandbox app at https://developer.paypal.com/dashboard to get `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
2. A **Gemini API key** (free tier): https://aistudio.google.com/apikey

## Deploy (Render)

This repo includes `render.yaml`. On Render: New > Blueprint, point at this repo, set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY` in the dashboard, deploy.

## AI tools used

- **Google Gemini 2.5 Flash** - agent reasoning + function calling over PayPal tools
- **AG Grid Community** - revenue dashboard grid
- **Render** - hosting
- Built with AI pair-programming (Instinct agent)

## License

MIT
