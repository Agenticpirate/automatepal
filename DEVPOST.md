# AutomatePal - submission working draft

Not submitted. Replace planned capabilities with verified results before publication.

## Tagline
An AI billing copilot built with the PayPal sandbox for indie founders.

## Problem
Founders need a clear way to turn product ideas into billing setup and understand what their payment data actually says. AutomatePal explores a conversational workflow with explicit separation of API-confirmed facts and fictional demonstrations.

## Verified so far
Gemini calls tools to list PayPal catalog products and plans, and has created a sandbox product followed by a monthly USD plan. OAuth works. Transactional events record actions. Input validation prevents invalid amounts. The invoice API returned 403 insufficient permissions and is disabled. Checkout order creation returned a sandbox approval link, not a completed payment. No real money moves and no customer email is sent.

## Planned demonstration, pending acceptance testing
Hosted public sign-in, cross-user isolation, exact-action confirmation and duplicate-click protection need end-to-end acceptance testing. Checkout approval/capture and subscription activation are not yet implemented as a complete flow. AI-written dunning drafts use only fictional failed-payment scenarios and are not sent.

## Architecture and tools
Next.js/React/TypeScript, PayPal sandbox REST APIs, Google Gemini (`gemini-3.1-flash-lite` tested locally), AG Grid Community, SQLite locally and Supabase Postgres with account-scoped RLS for hosting. The initial app is deployed at https://automatepal.onrender.com/ on Render Free. Public auth setup and hosted acceptance tests remain pending. AI tools used in development and exact deployment details must be filled in from the final build.

## Analytics honesty
Plan creation is not revenue. Fictional seeded subscriptions and failures are never represented as real PayPal activity. Recorded-event analytics are not a full accounting system. Real subscription MRR requires verified active subscription state and reconciliation.

## Submission checklist
- Functional hosted demo or complete reproducible local instructions
- Public source and detected MIT license
- Under-three-minute publicly visible YouTube video of tested functionality
- Accurate AI-tool disclosure and limitations
- Free judge access through the end of judging
- No unrelated third-party trademarks, logos, music or assets in video

## Independence
PayPal is a trademark of PayPal, Inc. AutomatePal is an independent project, not affiliated with or endorsed by PayPal. Use of the API is not a claim of partnership or certification. The name has not received trademark clearance or sponsor approval.
