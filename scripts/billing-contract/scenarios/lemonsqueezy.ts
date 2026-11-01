import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const KEY = 'eyJ0eXAiOiJKV1QiFictionalLemonSqueezyKey.000000000000000000000001';
export const scenario: Scenario = {
  provider: 'lemonsqueezy',
  cred: {apiKey: KEY},
  hosts: {test: 'https://api.lemonsqueezy.com', live: 'https://api.lemonsqueezy.com'},
  sameHost: true,
  verify: [
    {ref: '101', email: 'ALEX.payer@example.test', expect: 'verified', scopeIds: ['101'], customerId: '11'},
    {ref: '101', email: B, expect: 'mismatch'},
    {ref: '202', email: B, expect: 'verified', customerId: '22'},
    {ref: '501', email: A, expect: 'verified', scopeIds: ['501'], customerId: '11'},
    {ref: '303', email: A, expect: 'not_found'},
    {ref: '999', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: '101', email: A, intent: 'order_status', expect: (r) => { assert.equal(r[0].status, 'partial_refund'); assert.equal(r[0].displayRef, '#1101'); assert.equal(r[0].amountMinor, 4900); }},
    {ref: '501', email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), ['9001', '9002', '9003'])},
    {ref: '501', email: A, intent: 'failed_payment', expect: (r) => { assert.equal(one(r, (x) => x.kind === 'subscription', 'past due').failure?.nextRetryAt, '2026-11-20T10:00:00.000Z'); assert.ok(one(r, (x) => x.id === '9003', 'pending invoice').failure); }},
    {ref: '501', email: A, intent: 'invoice', expect: (r) => assert.equal(one(r, (x) => x.id === '9001', 'invoice').hostedUrl, 'https://app.lemonsqueezy.com/my-orders/fictional/subscription-invoice/9001')},
    {ref: '101', email: A, intent: 'invoice', expect: (r) => assert.equal(r[0].hostedUrl, 'https://app.lemonsqueezy.com/my-orders/fictional-101')},
    {ref: '501', email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, '2026-11-20T10:00:00.000Z')},
    {ref: '101', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r[0].refunds.map((f) => [f.status, f.amountMinor]), [['refunded', 1000]])},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: KEY}, ok: true},
    {mode: 'live', cred: {apiKey: KEY}, ok: true},
    {mode: 'test', cred: {apiKey: 'short'}, ok: false, code: 'invalid_credential'},
  ],
  // The fixtures are test-mode data, so a LIVE connection fails the connect check.
  modeMismatch: {mode: 'live', cred: {apiKey: KEY}},
  writeProbe: {method: 'POST', path: '/v1/orders/101/refund', body: '{}'},
  mixed: {ref: '501', email: A, intent: 'payment_history', forbiddenIds: ['9900']},
  extra: async ({mock, adapter}) => {
    const before = mock.requests.length;
    await adapter().testConnection();
    assert.ok(mock.requests.slice(before).every((q) => q.headers.accept === 'application/vnd.api+json'), 'JSON:API Accept header');
    return 1;
  },
};
