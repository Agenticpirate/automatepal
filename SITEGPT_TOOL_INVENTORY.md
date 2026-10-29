# SiteGPT tool coverage and build order - October29,2026

Current official features and complete docs index fetched09:33IST. This covers the named feature families in that index, not every historical setting/changelog entry. Built means bounded AutomatePal preview already measured, never equivalent capacity or service. No SiteGPT code/assets/brand copied. No current broad parity.

| Public SiteGPT tool/feature family | AutomatePal status | Free-only action / blocker |
| --- | --- | --- |
| Website crawl, sitemap, multiple URLs, manual/scheduled refresh | Missing | Bounded public URL import feasible but SSRF/redirect/DNS/size/consent/HTML-cleaning/security tests mandatory; start single URL, not broad crawler. Scheduled sync needs worker and changed-content review. |
| YouTube transcripts/playlists/channels | Missing | Transcript availability/rights/provider access unverified; no scraping workaround. Roadmap. |
| Notion/Drive/Dropbox/OneDrive/Box, GitHub content | Missing | Own-key/public GitHub narrow path possible later; OAuth/app accounts/scopes/consent required for private connectors, no account enrollment now. |
| File/raw-text import | Partial | TXT/MD/small textPDF built; CSV/DOCX feasible locally next, no OCR; no500kpage claim. |
| Q&A corrections/custom responses/text snippets | Partial/built | Exact normalized response, owner-written reviewed Q&A and notes built; no fuzzy guarantee/fine-tuning. Repeat eval first. |
| Instructions/persona/topic guards | Partial | Fixed safety/concise style, relevance/date/conflict-gated owner notes built; arbitrary instructions/persona not a safety override. Small safe tone setting possible, test unrelated answers. |
| Model choice/quota split | Missing | Current Gemini model only. OpenAI4.1/mini not available free on existing stack; no provider enrollment/spend. Configurable tested free-model adapter requires secure key/quota tests. |
| Embed/hosted chat/widgetSDK/events | Partial | Lazy embed/onehour link/open-state built. Public JS controls/event SDK missing, feasible bounded no-PII contract. Not general SiteGPT SDK parity. |
| Branding/icon/color/position/welcome/tooltip/autoopen | Partial | Monogram/color/side/starters/autoopen controls built, no uploaded logo/full tooltip customization. Feasible safe controls, no HTML injection. |
| Page-targeted starters/followups/widget translations | Partial/missing | Starters/global origin/path controls built; per-starter targeting, deterministic followup editor and fixed-text translations feasible.95languages not validated. |
| Disclaimer/visitor consent | Partial | Demo disclosure and owner source/AI consent built; configurable visitor terms assent requires actual approved text, legal drafts unpublished. |
| Chat history/filter/tag/export | Partial | Bounded question metadata/ticket timeline/filter/export built; full AI answer-body/search/export missing. New storage changes privacy/retention scope, review before storing histories. |
| Human escalation/takeover/release/close | Partial | Queue/state/inflight suppression built; actual human replies missing. Email/Telegram explicitly deferred. Local fictional visitor reply path possible only with clear scope/privacy tests, not external send. |
| Working hours/away mode/visitor chooses AI-human | Missing | Free deterministic schedule/mode UI feasible; do not promise staffed response/SLA. |
| Notifications/email digest/iPhone | Partial/missing | Preferences/dryrun deliveryOFF built. In-app digest feasible; email/Telegram deferred. iPhone native/push needs separate distribution/services, roadmap. |
| Lead collect/manage/delete/export/forward | Partial | Fictional optional consented email and preview deletion built; dedicated lead UI/metadata export feasible, no real CRM export/send. |
| Analytics/funnel/topics/gaps/digest | Partial |7day bounded cues/unanswered/feedback CSV built; funnel/top-topic/outcome analysis missing. Deterministic in-app trends/digest feasible; no measured deflection/accuracy inference. |
| Channel integrations | Missing | Slack/Messenger/WhatsApp/email/GoogleChat/Crisp/Freshdesk/Zoho/Zendesk require owned apps/accounts, permissions, external send review and often paid vendor plan. Existing deferred transport applies. Do not add fake connect buttons. |
| Teams/roles/multiple chatbots/transfer | Missing | Single-owner tenant built. Real member lifecycle/RLS/invites and ownership transfer high-risk migration; needs scoped authority/testing, notNov1 shortcut. |
| Profile/signin/delete account | Partial | Google/emailAuth and preview-data delete built; Auth account delete/manual process separate. No claim full self-service erasure. |
| Billing/trial/addons/cancel/payments | Sandbox only | SixCREATED trial plans/local choice built. No checkout,live billing, real entitlements or cancellation. PaymentsOFF, no spend. |
| API/tokens/scopes | Partial | Hashed expiring/revocable metadata read scopes built; broad write/chat/contentAPI absent. Extend narrow reads/CLI first, no general write tools. |
| Webhooks | Partial | Signed metadata/manual retries tests built; no external receiver acceptance/worker. Requires approved receiver, no secret/customer disclosure. |
| CLI/TS/Python/GoSDK/MCP/Convex/A2A | Missing | Read-only metadataCLI/client examples feasible with existing token contract; package publishing/MCP remote auth/agent actions need separate design/test. SiteGPT's support-agentA2A isn't a general capability we can claim. |
| Security/encryption/RBAC/privacy/DPA/HIPAA/SOC2 | Partial/blocked | Auth/RLS/hash/headers/audit tests built, no production assurances. Legal drafts unpublished. Free stack blocksPHI; attestation absent. Vendor certifications not inherited. |
| SEO/accessibility/performance | Partial | Existing privacy route noindex headers; generic stale billing meta, no sitemap/robots/canonical/social cards. SEO pass is next, private surfaces remain noindex. No ranking/accessibility-score guarantee. |

## Build order proposed, execution only within existing free/fictional limits
1. Immediate SEO correctness: accurate per-public-route metadata/canonical/social preview, sitemap/robots with private/capability exclusion, truthful software structured data without offers/reviews; measure head/HTTP and desktop/mobile, no indexing submission.
2. Repeated correctness/isolation gate before more integrations: pinned retrieval/guidance tests, populated independent user, restore/setup/recording. This protects every new tool. Blocked parts need owner/tester/secure provider access, continue independent work.
3. Bounded low-risk feature increments: CSV/DOCX text import with review/caps; public widget open/close/reset plus metadata events; deterministic in-app7day digest/trends and editable suggested questions. Build/test each separately and report actual acceptance. No full history storage by stealth.
4. Single publicURL import after SSRF/DNS/privateIP/redirect/text/consent regression harness; sitemap small allowlisted batch only after that passes. No background resync without durable scheduler and review semantics.
5. Human-support enhancements/workinghours, teamRLS, account deletion, broadAPI/SDKs after privacy/authority/data model and isolation tests. Real reply transport remains deferred until explicit user change.
6. Channels/nativeapp/paid models/certifications/livecommerce remain blocked/roadmap. No blanket all-tools completion byNov1. SundayNov1 is internal evidence gate; Nov4freeze remains fallback, incomplete work goes roadmap.

Sources: https://sitegpt.ai/features ; https://sitegpt.ai/docs/llms.txt ; fetched detailed https://sitegpt.ai/docs/guides/content/add-website.md , https://sitegpt.ai/docs/guides/widget/follow-up-suggestions.md , https://sitegpt.ai/docs/guides/human-support/set-up-human-support.md , https://sitegpt.ai/docs/developers/overview.md , https://sitegpt.ai/docs/guides/monitor/analytics.md . Existing internal evidenceFEATURES.md/HARDENING.md/scripts and release5e32dbd. Index is vendor's current inventory, not proof of actual service quality. Broader comparison inSITEGPT_COMPARISON.md.
