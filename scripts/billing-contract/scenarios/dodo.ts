import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const KEY = 'dodo_test_fictionalKey0000000000000001';
export const scenario: Scenario = {
  provider: 'dodo',
  cred: {apiKey: KEY},
  hosts: {test: 'https://test.dodopayments.com', live: 'https://live.dodopayments.com'},
  verify: [
    {ref: 'pay_AAAA1111aaaa', email: 'ALEX.payer@example.test', expect: 'verified', scopeIds: ['pay_AAAA1111aaaa'], customerId: 'cus_AAAA1111aaaa'},
    {ref: 'pay_AAAA1111aaaa', email: B, expect: 'mismatch'},
    {ref: 'pay_BBBB2222bbbb', email: B, expect: 'verified', customerId: 'cus_BBBB2222bbbb'},
    {ref: 'sub_AAAA1111aaaa', email: A, expect: 'verified', scopeIds: ['sub_AAAA1111aaaa'], customerId: 'cus_AAAA1111aaaa'},
    {ref: 'sub_AAAA1111aaaa', email: B, expect: 'mismatch'},
    {ref: 'pay_ZZZZ9999zzzz', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: 'pay_AAAA1111aaaa', email: A, intent: 'order_status', expect: (r) => { assert.equal(r[0].status, 'succeeded'); assert.equal(r[0].amountMinor, 4900); assert.equal(r[0].currency, 'USD'); }},
    {ref: 'pay_AAAA1111aaaa', email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), ['pay_AAAA1111aaaa', 'pay_AAAA1112aaaa'])},
    {ref: 'pay_AAAA1111aaaa', email: A, intent: 'failed_payment', expect: (r) => assert.deepEqual(one(r, (x) => x.id === 'pay_AAAA1112aaaa', 'failed').failure, {message: 'payment failed', attemptCount: 1, nextRetryAt: '2026-10-23T10:00:00.000Z'})},
    {ref: 'sub_AAAA1111aaaa', email: A, intent: 'failed_payment', expect: (r) => assert.equal(one(r, (x) => x.kind === 'subscription', 'on hold').failure?.message, 'subscription on hold')},
    {ref: 'pay_AAAA1111aaaa', email: A, intent: 'invoice', expect: (r) => assert.deepEqual(r.map((x) => x.hostedUrl), ['https://test.dodopayments.com/invoices/payments/pay_AAAA1111aaaa'])},
    {ref: 'pay_AAAA1111aaaa', email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, '2026-11-20T10:00:00.000Z')},
    {ref: 'pay_AAAA1111aaaa', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r.map((x) => [x.id, x.status, x.amountMinor, x.parentRef]), [['ref_AAAA1111aaaa', 'succeeded', 1000, 'pay_AAAA1111aaaa']])},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: KEY}, ok: true},
    {mode: 'live', cred: {apiKey: KEY}, ok: true},
    {mode: 'test', cred: {apiKey: 'short'}, ok: false, code: 'invalid_credential'},
    {mode: 'live', cred: {apiKey: 'has spaces in the key value 000000'}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/refunds', body: '{"payment_id":"pay_AAAA1111aaaa"}'},
  mixed: {ref: 'pay_AAAA1111aaaa', email: A, intent: 'payment_history', forbiddenIds: ['pay_BBBB2222bbbb']},
  extra: async ({mock, adapter}) => {
    // Refunds for another customer's payment are dropped even if the provider's filter returns them.
    mock.setMode('mixed_customers');
    const a = adapter();
    const v = await a.verifyCustomer('pay_AAAA1111aaaa', A);
    assert.equal(v.status, 'verified');
    if (v.status !== 'verified') return 0;
    const refunds = await a.lookup(v.scope, 'refund_status');
    assert.deepEqual(refunds.map((x) => x.id), ['ref_AAAA1111aaaa']);
    return 1;
  },
};
