// End to end for AutomatePal's own plans (Phase 2) against a LOCAL app, the LOCAL Supabase (real auth users)
// and a mock PayPal on 127.0.0.1:8790 started here. Start the app first with:
//   PAYPAL_API_BASE=http://127.0.0.1:8790 PAYPAL_CLIENT_ID=mock-client PAYPAL_CLIENT_SECRET=mock PAYPAL_WEBHOOK_ID=WH-TEST \
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service> \
//   npx next dev -p 3100
// then: E2E_APP=http://localhost:3100 SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=… SERVICE_ROLE_KEY=… \
//       LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/verify-plan-e2e.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const {E2E_APP: APP, SUPABASE_URL: SB, ANON_KEY: ANON, SERVICE_ROLE_KEY: SERVICE, LOCAL_DATABASE_URL: DB} = process.env;
if (!APP || !SB || !ANON || !SERVICE || !DB) { console.error('Set E2E_APP, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, LOCAL_DATABASE_URL.'); process.exit(1); }
for (const u of [APP, SB, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Local hosts only.'); process.exit(1); }
const PLAN = {growth_month: 'P-2UP80051DE392742BNLRMB7Q', scale_year: 'P-2N903235F14990207NLRMCAA'};
let n = 0;
const ok = () => { n++; };
// ---- mock PayPal ----
const subs = new Map(), seen = [];
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const send = (code, json) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(json === undefined ? '' : JSON.stringify(json)); };
  seen.push(`${req.method} ${req.url}`);
  if (req.url === '/v1/oauth2/token') return send(200, {access_token: 'mock-token', expires_in: 3600});
  if (req.url === '/v1/notifications/verify-webhook-signature') { const b = JSON.parse(body); return send(200, {verification_status: b.transmission_sig === 'good' && b.webhook_id === 'WH-TEST' ? 'SUCCESS' : 'FAILURE'}); }
  const m = /^\/v1\/billing\/subscriptions\/(I-[A-Z0-9]+)(\/(cancel|revise))?$/.exec(req.url);
  if (!m || !subs.has(m[1])) return send(404, {message: 'not found'});
  const s = subs.get(m[1]);
  if (!m[3]) return send(200, s);
  if (m[3] === 'cancel') { s.status = 'CANCELLED'; delete s.billing_info.next_billing_time; return send(204); }
  return send(200, {plan_id: JSON.parse(body).plan_id, links: [{rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions/update?ba_token=BA-MOCK'}]});
});
await new Promise(r => mock.listen(8790, '127.0.0.1', r));
const db = new pg.Client({connectionString: DB});
await db.connect();
// ---- real local auth users ----
async function user(email) {
  const r = await fetch(`${SB}/auth/v1/admin/users`, {method: 'POST', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123', email_confirm: true})});
  const u = await r.json(); assert.ok(u.id, JSON.stringify(u));
  const t = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: ANON, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123'})})).json();
  assert.ok(t.access_token); return {id: u.id, token: t.access_token};
}
const tag = randomUUID().slice(0, 8);
const owner = await user(`owner-${tag}@plan-e2e.example.test`), other = await user(`other-${tag}@plan-e2e.example.test`), agent = await user(`agent-${tag}@plan-e2e.example.test`);
await db.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')", [owner.id, agent.id]);
const api = (who, method, body, ws) => fetch(`${APP}/api/billing/plan`, {method, headers: {Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json', ...(ws ? {'x-workspace-id': ws} : {})}, body: body ? JSON.stringify(body) : undefined}).then(async r => ({status: r.status, body: await r.json()}));
const hook = (event, sig = 'good') => fetch(`${APP}/api/paypal/webhook`, {method: 'POST', headers: {'Content-Type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1', 'paypal-transmission-id': randomUUID(), 'paypal-transmission-sig': sig, 'paypal-transmission-time': new Date().toISOString()}, body: JSON.stringify(event)}).then(async r => ({status: r.status, body: await r.json()}));
const later = new Date(Date.now() + 30 * 86400e3).toISOString();
try {
  // 1. Free by default; checkout config present.
  let r = await api(owner, 'GET');
  assert.equal(r.status, 200); assert.equal(r.body.plan, 'free'); assert.equal(r.body.canManage, true); assert.equal(r.body.workspace, owner.id); assert.equal(r.body.checkout.clientId, 'mock-client'); assert.equal(r.body.catalog.length, 3); ok();
  // 2. Activate a subscription PayPal says belongs to this workspace.
  subs.set('I-OWNERSUB0001', {id: 'I-OWNERSUB0001', plan_id: PLAN.growth_month, status: 'ACTIVE', custom_id: owner.id, billing_info: {next_billing_time: later}});
  r = await api(owner, 'POST', {action: 'activate', subscriptionId: 'I-OWNERSUB0001'});
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.plan, 'growth'); ok();
  r = await api(owner, 'GET'); assert.equal(r.body.plan, 'growth'); assert.equal(r.body.limits.messages, 10000); assert.equal(r.body.subscription.status, 'active'); ok();
  // 3. Someone else's subscription, an unknown one, and a non-owner are refused.
  subs.set('I-OTHERSUB0001', {id: 'I-OTHERSUB0001', plan_id: PLAN.scale_year, status: 'ACTIVE', custom_id: other.id, billing_info: {next_billing_time: later}});
  r = await api(owner, 'POST', {action: 'activate', subscriptionId: 'I-OTHERSUB0001'}); assert.equal(r.status, 403); ok();
  r = await api(owner, 'POST', {action: 'activate', subscriptionId: 'I-NOSUCHSUB001'}); assert.equal(r.status, 502); ok();
  r = await api(agent, 'POST', {action: 'refresh'}, owner.id); assert.equal(r.status, 403); assert.match(r.body.error, /owner/); ok();
  r = await api(agent, 'GET', undefined, owner.id); assert.equal(r.body.plan, 'growth'); assert.equal(r.body.canManage, false); ok();
  // 4. Webhooks: bad signature refused; payment failure suspends with grace and sends a billing notice; duplicates ignored.
  r = await hook({id: 'WH-BADSIG0001', event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', resource: {id: 'I-OWNERSUB0001'}}, 'bad'); assert.equal(r.status, 401); ok();
  subs.get('I-OWNERSUB0001').status = 'SUSPENDED';
  const evt = {id: 'WH-PAYFAIL' + tag.toUpperCase().replace(/[^A-Z0-9]/g, ''), event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', resource: {id: 'I-OWNERSUB0001'}};
  r = await hook(evt); assert.equal(r.status, 200); assert.equal(r.body.outcome, 'synced'); ok();
  r = await api(owner, 'GET'); assert.equal(r.body.subscription.status, 'suspended'); assert.ok(r.body.subscription.graceUntil); assert.equal(r.body.plan, 'growth', 'grace keeps the plan'); ok();
  const mail = await db.query("select status from email_log where user_id=$1 and email_type='billing_notice'", [owner.id]);
  assert.equal(mail.rowCount, 1); assert.equal(mail.rows[0].status, 'dry_run', 'billing notice recorded (dry run without Resend)'); ok();
  r = await hook(evt); assert.equal(r.body.outcome, 'duplicate'); ok();
  r = await hook({id: 'WH-OTHER' + tag.replace(/[^A-Za-z0-9]/g, ''), event_type: 'CHECKOUT.ORDER.APPROVED', resource: {id: 'O-1'}}); assert.equal(r.body.outcome, 'ignored'); ok();
  // 5. Recovery, plan change (PayPal approval link), cancel keeps access to period end.
  subs.get('I-OWNERSUB0001').status = 'ACTIVE';
  r = await api(owner, 'POST', {action: 'refresh'}); assert.equal(r.body.status, 'active'); ok();
  r = await api(owner, 'POST', {action: 'change', plan: 'scale', interval: 'year'}); assert.equal(r.status, 200); assert.match(r.body.approveUrl, /^https:\/\/www\.sandbox\.paypal\.com\//); assert.ok(seen.includes('POST /v1/billing/subscriptions/I-OWNERSUB0001/revise')); ok();
  r = await api(owner, 'POST', {action: 'cancel'}); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'cancelled'); assert.equal(r.body.plan, 'growth', 'kept until the paid period ends'); ok();
  r = await api(owner, 'POST', {action: 'cancel'}); assert.equal(r.status, 400); ok();
  // 6. Plan gates follow the plan: API tokens need Growth+, so after the period ends (Free) they are refused.
  await db.query("update workspace_subscriptions set current_period_end=now()-interval '1 minute' where workspace_id=$1", [owner.id]);
  r = await api(owner, 'GET'); assert.equal(r.body.plan, 'free'); ok();
  const tok = await fetch(`${APP}/api/integrations`, {method: 'POST', headers: {Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({label: 'e2e', scope: 'support:read', hours: 1, consent: true})});
  assert.equal(tok.status, 402); assert.match((await tok.json()).error, /API access is not included in your plan/); ok();
  console.log(`PASS plan end to end: ${n} checks; real local auth users and app, mock PayPal: free by default, activate after approval, other workspace / unknown / non-owner refused, signed webhooks (bad signature refused, payment failure to grace plus billing notice, duplicates and other events), refresh, plan change approval link, cancel to period end, plan gate after expiry.`);
} finally {
  await db.query("delete from paypal_webhook_events where subscription_id='I-OWNERSUB0001' or event_id like 'WH-OTHER%' or event_id like 'WH-PAYFAIL%'").catch(() => {});
  for (const u of [owner, other, agent]) await fetch(`${SB}/auth/v1/admin/users/${u.id}`, {method: 'DELETE', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`}}).catch(() => {});
  await db.end(); mock.close();
}
