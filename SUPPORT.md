# Fictional billing-help preview

`/support` creates a one-hour capability link for a fictional USD19 order. The owner can embed `widget.js` with the returned demo token, or open `/help` directly. Customer requests support billing questions, refund-review requests and receipt requests. No refund, charge, email, invoice or merchant account connection is executed.

The database stores only a SHA256 token hash. Public RPCs disclose the fictional order only for a valid unexpired token. A row lock serializes submissions and caps each case at five. Requests are visible only to their owner via RLS. Marking reviewed changes only `pending_review` to `reviewed_no_action`. It does not approve a refund. The public panel strips its token from the displayed URL after loading and sets no-referrer/noindex headers. The initial link remains a bearer capability and must not carry real customer data.

Not built: merchant onboarding, real customer authentication, real order lookup, actual refund processing, automated receipt fulfillment, production-grade abuse control or retention controls. Multi-merchant integration requires a separate permission and account-isolation design.

`/tax` is a USD planning worksheet. It applies only a user-entered percentage to a user-entered net amount using inclusive or exclusive arithmetic. It does not discover tax rates, determine jurisdiction, identify exemptions, calculate income tax or file anything. CSV exports retain the estimate labels.

## Widget configuration preview

Tenant owners can set a plain-text label, short monogram, validated hex accent and up to four plain-text quick prompts. Image logos are not implemented. The customer panel computes contrasting button text. Quick prompts populate the request box; they do not perform an action. A general human-handoff request reaches only the owner's queue, not a live agent connection. An optional contact address is stored only with explicit consent; no message is sent automatically. The demo still asks for fictional details only. Direct database submission of a contact without consent is rejected. All requests share the five-request, one-hour case limits.

The drop-in billing add-on uses its own Shadow DOM to avoid host-page CSS collisions and can sit on the left using `data-side="left"` when another chatbot occupies the right. Its open/closed state persists in this tab's session storage across full page navigation when the same demo token is used. Storage is best-effort and session/token scoped. The iframe is lazy-loaded on first open. This is not a tested compatibility claim for every third-party widget, nor is the script on a separate static CDN: Render cold starts still apply.
