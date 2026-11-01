import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const TEST = {keyId: 'rzp_test_FictionalKey01', keySecret: 'FictionalSecret0000000001'};
export const scenario: Scenario = {
  provider: 'razorpay',
  cred: TEST,
  hosts: {test: 'https://api.razorpay.com', live: 'https://api.razorpay.com'},
  sameHost: true,
  verify: [
    {ref: 'pay_AAAA1111aaaa01', email: 'alex.PAYER@example.test', expect: 'verified', scopeIds: ['pay_AAAA1111aaaa01', 'order_AAAA1111aaaa01']},
    {ref: 'pay_AAAA1111aaaa01', email: B, expect: 'mismatch'},
    {ref: 'order_AAAA1111aaaa01', email: A, expect: 'verified', scopeIds: ['order_AAAA1111aaaa01']},
    {ref: 'order_BBBB2222bbbb01', email: A, expect: 'mismatch'},
    {ref: 'order_BBBB2222bbbb01', email: B, expect: 'verified'},
    {ref: 'inv_AAAA1111aaaa01', email: A, expect: 'verified', scopeIds: ['inv_AAAA1111aaaa01', 'pay_AAAA1113aaaa03']},
    {ref: 'sub_AAAA1111aaaa01', email: A, expect: 'verified', scopeIds: ['sub_AAAA1111aaaa01']},
    {ref: 'sub_AAAA1111aaaa01', email: B, expect: 'mismatch'},
    {ref: 'pay_ZZZZ9999zzzz99', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: 'pay_AAAA1111aaaa01', email: A, intent: 'order_status', expect: (r) => { const p = one(r, (x) => x.kind === 'payment', 'payment'); assert.equal(p.status, 'captured'); assert.equal(p.amountMinor, 499900); assert.equal(p.currency, 'INR'); assert.equal(one(r, (x) => x.kind === 'order', 'order').displayRef, 'AP-ORD-1001'); }},
    {ref: 'order_AAAA1111aaaa01', email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), ['pay_AAAA1111aaaa01', 'pay_AAAA1112aaaa02'])},
    {ref: 'order_AAAA1111aaaa01', email: A, intent: 'failed_payment', expect: (r) => assert.equal(one(r, (x) => x.id === 'pay_AAAA1112aaaa02', 'failed').failure?.message, 'Payment failed because the bank declined it')},
    {ref: 'sub_AAAA1111aaaa01', email: A, intent: 'failed_payment', expect: (r) => assert.deepEqual(r[0].failure, {message: 'payment failed, retrying', attemptCount: 2, nextRetryAt: new Date(1792678400 * 1000).toISOString()})},
    {ref: 'inv_AAAA1111aaaa01', email: A, intent: 'invoice', expect: (r) => { assert.equal(r[0].displayRef, 'AP/2026/0007'); assert.equal(r[0].hostedUrl, 'https://rzp.io/i/fictionalA1'); }},
    {ref: 'sub_AAAA1111aaaa01', email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, new Date(1792678400 * 1000).toISOString())},
    {ref: 'pay_AAAA1111aaaa01', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r[0].refunds.map((f) => [f.id, f.status, f.amountMinor]), [['rfnd_AAAA1111aaaa01', 'processed', 100000]])},
  ],
  credentialRules: [
    {mode: 'test', cred: TEST, ok: true},
    {mode: 'live', cred: {keyId: 'rzp_live_FictionalKey01', keySecret: 'FictionalSecret0000000001'}, ok: true},
    {mode: 'live', cred: TEST, ok: false, code: 'mode_mismatch'},
    {mode: 'test', cred: {keyId: 'rzp_live_FictionalKey01', keySecret: 'FictionalSecret0000000001'}, ok: false, code: 'mode_mismatch'},
    {mode: 'test', cred: {keyId: 'key_FictionalKey01', keySecret: 'FictionalSecret0000000001'}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/v1/payments/pay_AAAA1111aaaa01/refund', body: '{"amount":100}'},
  mixed: {ref: 'order_AAAA1111aaaa01', email: A, intent: 'payment_history', forbiddenIds: ['pay_BBBB2222bbbb01']},
};
