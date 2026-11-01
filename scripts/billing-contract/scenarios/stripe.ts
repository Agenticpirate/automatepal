import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
// Fictional key-shaped strings, assembled at runtime so secret scanners do not flag them as real keys.
const key = (...parts: string[]) => parts.join('_');
const RK_TEST = key('rk', 'test', '51FictionalRestrictedKey000000'), RK_LIVE = key('rk', 'live', '51FictionalRestrictedKey000000');
export const scenario: Scenario = {
  provider: 'stripe',
  cred: {apiKey: RK_TEST},
  hosts: {test: 'https://api.stripe.com', live: 'https://api.stripe.com'},
  sameHost: true,
  verify: [
    {ref: 'ch_3AAA111aaa', email: 'Alex.Payer@Example.TEST', expect: 'verified', scopeIds: ['ch_3AAA111aaa'], customerId: 'cus_AAA111'},
    {ref: 'ch_3AAA111aaa', email: B, expect: 'mismatch'},
    {ref: 'ch_3AAA113aaa', email: A, expect: 'verified', customerId: 'cus_AAA111'},
    {ref: 'ch_3BBB221bbb', email: B, expect: 'verified', customerId: 'cus_BBB222'},
    {ref: 'pi_3AAA111aaa', email: A, expect: 'verified', scopeIds: ['pi_3AAA111aaa', 'ch_3AAA111aaa'], customerId: 'cus_AAA111'},
    {ref: 'in_1AAA111aaa', email: A, expect: 'verified', scopeIds: ['in_1AAA111aaa']},
    {ref: 'APINV-0001', email: A, expect: 'verified', scopeIds: ['in_1AAA111aaa']},
    {ref: 'APINV-0003', email: A, expect: 'mismatch'},
    {ref: 'APINV-9999', email: A, expect: 'not_found'},
    {ref: 'ch_3ZZZ999zzz', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: 'ch_3AAA111aaa', email: A, intent: 'order_status', expect: (r) => { const c = one(r, (x) => x.kind === 'charge', 'charge'); assert.equal(c.status, 'succeeded'); assert.equal(c.amountMinor, 4900); assert.equal(c.currency, 'USD'); }},
    {ref: 'pi_3AAA111aaa', email: A, intent: 'order_status', expect: (r) => { assert.equal(one(r, (x) => x.kind === 'payment', 'intent').status, 'succeeded'); assert.equal(r.length, 2); }},
    {ref: 'ch_3AAA111aaa', email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), ['ch_3AAA111aaa', 'ch_3AAA112aaa'])},
    {ref: 'ch_3AAA111aaa', email: A, intent: 'failed_payment', expect: (r) => {
      const inv = one(r, (x) => x.kind === 'invoice', 'open invoice');
      assert.deepEqual(inv.failure, {message: 'invoice payment attempt failed', attemptCount: 2, nextRetryAt: '2026-11-05T00:00:00.000Z'});
      assert.equal(one(r, (x) => x.kind === 'charge', 'failed charge').failure?.message, 'Your card was declined.');
    }},
    {ref: 'ch_3AAA111aaa', email: A, intent: 'invoice', expect: (r) => {
      const i = one(r, (x) => x.displayRef === 'APINV-0001', 'invoice');
      assert.equal(i.hostedUrl, 'https://invoice.stripe.com/i/acct_fictional/test_A1'); assert.equal(i.status, 'paid');
    }},
    {ref: 'APINV-0001', email: A, intent: 'invoice', expect: (r) => assert.equal(r[0].displayRef, 'APINV-0001')},
    {ref: 'ch_3AAA111aaa', email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, new Date(1793923200 * 1000).toISOString())},
    {ref: 'ch_3AAA111aaa', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r[0].refunds.map((f) => [f.id, f.status, f.amountMinor]), [['re_3AAA111aaa', 'succeeded', 1000]])},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: RK_TEST}, ok: true},
    {mode: 'test', cred: {apiKey: key('sk', 'test', '51FictionalSecretKey0000000')}, ok: true},
    {mode: 'live', cred: {apiKey: RK_LIVE}, ok: true},
    {mode: 'live', cred: {apiKey: key('sk', 'live', '51FictionalSecretKey0000000')}, ok: false, code: 'refused_key', message: /Full live secret keys are refused\. Create a restricted key with read permissions\./},
    {mode: 'test', cred: {apiKey: key('sk', 'live', '51FictionalSecretKey0000000')}, ok: false, code: 'refused_key'},
    {mode: 'test', cred: {apiKey: key('pk', 'test', '51FictionalPublishable0000')}, ok: false, code: 'refused_key'},
    {mode: 'live', cred: {apiKey: key('pk', 'live', '51FictionalPublishable0000')}, ok: false, code: 'refused_key'},
    {mode: 'test', cred: {apiKey: RK_LIVE}, ok: false, code: 'mode_mismatch'},
    {mode: 'live', cred: {apiKey: RK_TEST}, ok: false, code: 'mode_mismatch'},
    {mode: 'test', cred: {apiKey: 'not-a-key'}, ok: false, code: 'invalid_credential'},
  ],
  // An rk_live_ key whose data says livemode:false fails the connect check.
  modeMismatch: {mode: 'live', cred: {apiKey: RK_LIVE}},
  writeProbe: {method: 'POST', path: '/v1/refunds', body: 'charge=ch_3AAA111aaa'},
  mixed: {ref: 'ch_3AAA111aaa', email: A, intent: 'payment_history', forbiddenIds: ['ch_3BBB221bbb']},
  extra: async ({mock, adapter}) => {
    const before = mock.requests.length;
    await adapter().testConnection();
    assert.ok(mock.requests.slice(before).every((q) => q.headers['stripe-version'] === '2026-09-30.endive'), 'Stripe-Version pinned to the vendored spec');
    return 1;
  },
};
