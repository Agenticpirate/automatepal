# Own-site trial (Phase 6, local): how the bot does on our own website

Run on 2026-11-10 against a local app and the local database with real model and embedding calls
(`scripts/own-site-trial.ts`). Nothing here touched the hosted site or database.

## What was set up

- A test "AutomatePal Support" workspace on the Growth plan, created the way a customer would: sources saved through
  the Knowledge API with consent and publish, widget look and a proactive message saved through Widget studio's API,
  an install key from Setup.
- Knowledge: the text of our nine public pages (`/`, `/pricing`, `/docs`, `/security`, `/privacy`, `/terms`,
  `/contact`, `/integrations`, `/legal/subprocessors`), 66,000 characters. The crawler refuses local addresses, so
  the trial read each page from the local app and saved its text; the crawl itself was not exercised.
- The widget on our own marketing pages (`app/components/SupportWidget.tsx`, off until `SUPPORT_BOT_KEY` is set).
- 40 visitor questions through the widget's answer path: 29 a visitor could reasonably expect answered, 11 that a
  good bot declines (off-topic, made-up premises, a prompt-injection attempt, an angry refund demand).

## Results

| Run | Change before the run | Answered of 40 |
| --- | --- | --- |
| 1 | none (as built) | 11 |
| 2 | retrieval floor 0.72 to 0.62 with 6 passages, paragraph passages, secret check fixed | 14 |
| 3 | keyword matching beside similarity, answer format accepts a few extra quotes | 19 |
| 4 | very short quotes dropped instead of refusing the answer | 19 |
| 5 | short source ids for the model, inexact quotes dropped when an exact one remains | 21 |

Final run, by what should have happened:

- **26 questions our pages can answer:** 20 answered. Every answer I read matched the page it cited (prices, plan
  contents, WordPress and Tag Manager installs, the JavaScript API, providers, subprocessors, retention, contact).
  I found no wrong answer in any run. The 6 misses were each answered in at least one other run: the second-model
  grounding check rejected them this time.
- **3 questions our pages do not answer:** correctly declined. The gaps are in our content: how many bots each
  plan includes, which languages the chat supports, and whether conversations are used to train AI models.
- **11 questions to decline:** all declined or refused. "Are you SOC 2 certified?" got a correct sourced "No".
  The prompt-injection attempt was refused before any model call.
- **Speed:** median 3.4 seconds per answer, slowest 5.0 (two model calls in sequence, no streaming).
- **Languages:** the Spanish question was answered in Spanish; the Hindi one was answered in run 1 and declined
  (in Hindi) later.

## What was wrong and is fixed in this branch

1. **Retrieval threw away the right passage.** Similarity scores sit in a narrow band: answerable questions scored
   0.70 to 0.72 against the passage that answers them, unrelated ones 0.61 to 0.71. The 0.72 cut-off refused most
   answerable questions and did not separate the two groups. Text sources now pass at 0.62, up to 6 passages
   (`db/066`); the answer model, exact-quote check and grounding check decide. Owner guidance keeps 0.72.
2. **Rare words missed.** "WordPress" or "contact" did not pull the passage containing the word. Retrieval now adds
   up to 2 passages that share question words (`db/066`, three-argument `support_knowledge_vectors`).
3. **Our Docs page could not be imported.** The secret detector matched the sentence "An API key: test_ for test".
   A value now has to look like a credential (a digit, or 16+ characters).
4. **Passages were cut mid-sentence** at fixed 1,050-character steps. They are now packed by paragraph and carry
   their section heading. Sources saved before this keep their old passages until they are saved again.
5. **Good answers were discarded on format.** More than 4 quotes, more than 3 sources, a quote under 10 characters
   or one miscopied 36-character source id refused the whole answer. The model now gets short ids (S1, S2, ...),
   extra or inexact quotes are dropped, and at least one exact quote must remain.
6. **Knowledge page capped paid plans at 30 sources** (a hard-coded check in front of the plan limit).
7. **Docs showed the one-hour demo snippet** as the install method. It now shows the permanent key and names the
   platform guides.

## Still open (not changed here)

- **Strict grounding costs about 1 in 5 answerable questions.** The checker is told to reject when unsure. Options:
  retry once with a shorter answer when it rejects, or run the check on the deeper model. This trades the
  "no source, no answer" promise against coverage, so it is a product decision.
- **The fallback is a dead end.** "I do not have enough published information... ask a person to review" is shown
  for an off-topic question and for "I was charged twice, I need a refund now" alike. A billing or upset message
  should offer the person handoff directly.
- **The chat panel is a form, not a conversation.** One answer at a time replaces the last, the question box sits
  above the answer, and a "What do you need?" selector comes first. No streaming.
- **Content gaps on our own pages:** bots per plan, chat languages, a plain statement on AI training.
- **Knowledge at scale:** the Knowledge list reads 31 sources; saves are limited to 6 a minute (nine pages took
  almost 3 minutes); a source holds 30,000 characters and 30 passages.
- **Single-page apps:** `widget.js` reads the address once. Starter questions, proactive messages and excluded
  paths do not follow client-side navigation. Our own site works around it in `SupportWidget.tsx`.
- **Install options not built:** an npm package or React component, a Shopify app, a Webflow or Wix app listing.

## How installing looks today

Setup gives an install key and step lists for plain HTML, WordPress (a downloadable plugin), Shopify, Google Tag
Manager (a ready Custom HTML block with the key in the address), Webflow, Wix, Squarespace and Next.js, plus a check
that fetches the live page and looks for the script. The key is public and works only on the origins allowed in
Widget studio. For most sites the install is one pasted line.

## To put it on the live site

1. Merge the open PRs and apply migrations through 066 to the hosted database.
2. Create the real "AutomatePal Support" workspace, crawl `automatepal.com` with daily refresh, publish.
3. Create its install key and set `SUPPORT_BOT_KEY` on the Worker.
4. Review transcripts weekly; add exact answers for the content gaps above.

## Run it again

```bash
E2E_APP=http://localhost:3100 SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=… SERVICE_ROLE_KEY=… \
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx tsx scripts/own-site-trial.ts
```

It makes about 40 answer calls and 100 embedding calls (a few cents). `--keep` leaves the workspace and prints the
key; `--ask-only=<key>` re-asks the questions against an existing workspace.
