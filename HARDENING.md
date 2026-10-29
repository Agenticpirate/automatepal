# Preview hardening evidence

2026-10-28. Security/reliability work, not enterprise certification or production acceptance.

## Run locally

- `npm run test:hardening`: bounded 6/min guard, window expiry, max 5000 identities fail-closed, auth outage injection, no third-party load.
- `DATABASE_PASSWORD_FILE=<private file> npx tsx scripts/verify-hardening-db.ts`: two synthetic auth principals under actual authenticated/anon SQL roles; all fixtures roll back. 15 table cross-tenant reads, foreign RPC mutations, forged case/audit inserts, inaccessible webhook signing secret, capability denial, own-data deletion and foreign-data survival. Most tables use zero-row cross-tenant checks; populated end-to-end independent second-browser tests remain required.
- `node scripts/verify-hardening-pages.mjs`: local mobile controls/headers, 10 concurrent local liveness reads, five unauthenticated route denials. Not a capacity benchmark.
- `npm audit`: full dependencies, 0 known advisories at this checkpoint. A scan is not proof of no vulnerabilities.
- Existing safety, widget, billing, webhook and rollback DB suites retain their scope.

## Controls and limits

Owner writes are recorded by DB triggers as IDs, resource type, operation and time only. Last 1000 events per workspace; no raw source/question text, contact, URL, bearer token or webhook key. This is not tamper-proof compliance logging. Knowledge answer failures emit fixed-vocabulary stage logs without input or identity.

Preview-data deletion requires exact typed words, checks ownership through auth.uid(), serializes with knowledge operations and refuses uncertain/executing action records. It deletes preview application data and revokes all demo/read-only capabilities by removal. It does not cancel/refund payments, delete the Supabase Auth identity, provider-held information, external copies or backups. Do not erase unresolved payment records. No automated age purge exists. Account deletion remains manual as the privacy notice states.

Headers include nosniff, no-referrer, HSTS, Permissions-Policy disabling camera/mic/geolocation/payment, and a limited CSP restricting objects/base/form actions. Full script-src CSP is not claimed. Frame restrictions are intentionally absent for the opt-in widget. Response caches are disabled on private API/demo surfaces. Authentication fetch exceptions fail closed; outage may appear as sign-in required rather than a precise dependency diagnosis.

## Recovery and free-tier limits

- Supabase docs recommend free-tier projects export via CLI db dump and keep off-site copies. Managed daily backups are Pro/Team/Enterprise, not assumed on free tier: https://supabase.com/docs/guides/platform/backups
- Render docs say free services are not for production, sleep after 15 minutes and can restart. No persistent disk/scaling. Usage overages can bill when a payment method exists; no upgrade or payment method has been added by this work: https://render.com/docs/free
- Git contains additive schema migrations and application code. This is not a data backup.
- An encrypted off-site backup destination/retention policy and isolated restore target are not established. No dump, restore, RPO or RTO success is claimed. Do not restore into the active preview. Before real data: approve destination, take a compatible logical dump, restore only into an isolated DB and verify schema/RLS/counts/capability revocation without logging row content.
- No keep-alive ping, third-party hammer test, always-on worker or spend was introduced.

## Populated isolation follow-up - October29
`verify-populated-isolation-db.ts` passed three consecutive rollback-only runs, 62 assertions each. Both synthetic tenants have populated cases, published/private knowledge and vectors, attempts, custom answers, question interactions, requests, tokens and audit events. Nine tables check both foreign zero-row denial and own positive controls. Foreign overwrite/update/delete/revoke/forged insert are denied; anonymous capabilities retrieve only their published source/custom response; mismatched API scope is denied; deleting tenant A's synthetic preview leaves tenant B's synthetic case available. No retained test identities or rows. Evidence: submission/populated-isolation.json. This narrows the earlier empty-table test gap, but is not independent second-browser/Auth testing, a model quality result or a backup/restore test.
