# Fictional billing-help preview

`/support` creates a one-hour capability link for a fictional USD19 order. The owner can embed `widget.js` with the returned demo token, or open `/help` directly. Customer requests support billing questions, refund-review requests and receipt requests. No refund, charge, email, invoice or merchant account connection is executed.

The database stores only a SHA256 token hash. Public RPCs disclose the fictional order only for a valid unexpired token. A row lock serializes submissions and caps each case at five. Requests are visible only to their owner via RLS. Marking reviewed changes only `pending_review` to `reviewed_no_action`. It does not approve a refund. The public panel strips its token from the displayed URL after loading and sets no-referrer/noindex headers. The initial link remains a bearer capability and must not carry real customer data.

Not built: merchant onboarding, real customer authentication, real order lookup, actual refund processing, automated receipt fulfillment, production-grade abuse control or retention controls. Multi-merchant integration requires a separate permission and account-isolation design.

`/tax` is a USD planning worksheet. It applies only a user-entered percentage to a user-entered net amount using inclusive or exclusive arithmetic. It does not discover tax rates, determine jurisdiction, identify exemptions, calculate income tax or file anything. CSV exports retain the estimate labels.
