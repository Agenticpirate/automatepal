// lib/plans.ts and lib/subscriptions.ts without network or database: PayPal plan id mapping and override,
// subscription to row (status mapping, unknown plan, missing workspace), webhook event parsing, sync with a
// fake PayPal and a fake database (workspace mismatch, invalid id), and the billing notice email text.
import assert from 'node:assert/strict';
import {paypalPlanIds, planForPaypalId, PLANS, PAID_PLANS, hasFeature, planWith} from '../lib/plans';
import {subscriptionRow, eventSubscription, syncSubscription, SubscriptionError} from '../lib/subscriptions';
import {billingNoticeEmail} from '../lib/email';
import type {SupabaseClient} from '@supabase/supabase-js';
let n = 0;
const ok = () => { n++; };
async function main() {
  const ids = paypalPlanIds(undefined);
  assert.equal(Object.keys(ids).length, 6); assert.deepEqual(planForPaypalId(ids.growth_year), {plan: 'growth', interval: 'year'}); assert.equal(planForPaypalId('P-NOTOURS0000000000000000'), null); ok();
  const custom = JSON.stringify(Object.fromEntries(Object.keys(ids).map((k, i) => [k, 'P-LIVE' + String(i).repeat(20)])));
  assert.equal(paypalPlanIds(custom).scale_month, 'P-LIVE' + '4'.repeat(20)); ok();
  assert.throws(() => paypalPlanIds('{"starter_month":"P-X"}')); assert.throws(() => paypalPlanIds('not json')); ok();
  assert.ok(PAID_PLANS.every(p => PLANS[p].price!.year < PLANS[p].price!.month * 12), 'yearly is cheaper'); ok();
  assert.ok(!hasFeature('starter', 'api') && hasFeature('growth', 'api') && hasFeature('scale', 'mcp') && !hasFeature('growth', 'mcp')); assert.equal(planWith('mcp'), 'scale'); assert.equal(planWith('webhooks'), 'growth'); ok();

  const ws = '11111111-2222-4333-8444-555555555555';
  const sub = (o: Record<string, unknown> = {}) => ({id: 'I-ABCDEF123456', plan_id: ids.scale_month, status: 'ACTIVE', custom_id: ws, billing_info: {next_billing_time: '2026-12-09T10:00:00Z'}, ...o});
  assert.deepEqual(subscriptionRow(sub(), ids), {workspace: ws, subscription: 'I-ABCDEF123456', plan: 'scale', interval: 'month', status: 'active', periodEnd: '2026-12-09T10:00:00Z'}); ok();
  for (const [ps, ours] of [['APPROVAL_PENDING', 'approval_pending'], ['APPROVED', 'approval_pending'], ['SUSPENDED', 'suspended'], ['CANCELLED', 'cancelled'], ['EXPIRED', 'expired']]) assert.equal(subscriptionRow(sub({status: ps}), ids).status, ours);
  ok();
  assert.throws(() => subscriptionRow(sub({plan_id: 'P-SOMEONEELSE00000000000'}), ids), /not for an AutomatePal plan/);
  assert.throws(() => subscriptionRow(sub({custom_id: undefined}), ids), /not linked to a workspace/);
  assert.throws(() => subscriptionRow(sub({status: 'WEIRD'}), ids), /cannot read/);
  assert.throws(() => subscriptionRow(sub({id: 'not-an-id'}), ids), /cannot read/); ok();

  assert.deepEqual(eventSubscription({id: 'WH-1A2B3C', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: {id: 'I-ABCDEF123456'}}), {id: 'WH-1A2B3C', type: 'BILLING.SUBSCRIPTION.CANCELLED', subscription: 'I-ABCDEF123456'});
  assert.equal(eventSubscription({id: 'WH-1A2B3C', event_type: 'PAYMENT.SALE.COMPLETED', resource: {id: 'SALE1', billing_agreement_id: 'I-ABCDEF123456'}})?.subscription, 'I-ABCDEF123456');
  assert.equal(eventSubscription({id: 'WH-1A2B3C', event_type: 'CHECKOUT.ORDER.APPROVED', resource: {id: 'I-ABCDEF123456'}})?.subscription, null, 'other events are not acted on');
  assert.equal(eventSubscription({id: 'WH-1A2B3C', event_type: 'PAYMENT.SALE.COMPLETED', resource: {billing_agreement_id: "I-X'; drop"}})?.subscription, null);
  assert.equal(eventSubscription({event_type: 'X'}), null); assert.equal(eventSubscription('nope'), null); ok();

  // Sync with fakes: the workspace must match; the RPC gets exactly the row.
  const calls: unknown[] = [];
  const db = {rpc: async (name: string, args: unknown) => { calls.push([name, args]); return {data: {plan: 'scale', status: 'active'}, error: null}; }} as unknown as SupabaseClient;
  const paypal = {get: async () => sub(), cancel: async () => ({})};
  const r = await syncSubscription(db, paypal, 'I-ABCDEF123456', {workspace: ws, ids});
  assert.equal(r.plan, 'scale'); assert.deepEqual(calls[0], ['sync_paypal_subscription', {p_ws: ws, p_subscription: 'I-ABCDEF123456', p_plan: 'scale', p_interval: 'month', p_status: 'active', p_period_end: '2026-12-09T10:00:00Z'}]); ok();
  await assert.rejects(syncSubscription(db, paypal, 'I-ABCDEF123456', {workspace: '99999999-2222-4333-8444-555555555555', ids}), (e: unknown) => e instanceof SubscriptionError && e.status === 403);
  await assert.rejects(syncSubscription(db, paypal, 'bad', {ids}), /Invalid subscription id/);
  assert.equal(calls.length, 1, 'no database write on mismatch'); ok();
  const failing = {rpc: async () => ({data: null, error: {message: 'x'}})} as unknown as SupabaseClient;
  await assert.rejects(syncSubscription(failing, paypal, 'I-ABCDEF123456', {ids}), (e: unknown) => e instanceof SubscriptionError && e.status === 503); ok();

  const m = billingNoticeEmail('owner@example.test', 'payment_failed', 'Growth', '2026-11-16T00:00:00Z', 'https://automatepal.com');
  assert.equal(m.type, 'billing_notice'); assert.match(m.subject, /Payment failed/); assert.match(m.text, /stays active until Mon, 16 Nov 2026/); assert.match(m.text, /https:\/\/automatepal\.com\/plan/); assert.ok(!/turn these emails off/i.test(m.text)); ok();
  assert.match(billingNoticeEmail('o@e.test', 'cancelled', 'Scale', null).text, /Nothing is deleted/); ok();
  console.log(`PASS subscriptions: ${n} checks; plan ids and override, plan features, PayPal status mapping, unknown plan / missing workspace refused, webhook event parsing, sync writes exactly the row and refuses another workspace, billing notices.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
