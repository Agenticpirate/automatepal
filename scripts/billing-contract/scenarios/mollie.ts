import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const TEST = 'test_FictionalMollieKey00000000000001', LIVE = 'live_FictionalMollieKey00000000000001';
export const scenario: Scenario = {
  provider: 'mollie',
  cred: {apiKey: TEST},
  hosts: {test: 'https://api.mollie.com', live: 'https://api.mollie.com'},
  sameHost: true,
  verify: [
    {ref: 'tr_AAAA1111aa', email: 'Alex.Payer@Example.test', expect: 'verified', scopeIds: ['tr_AAAA1111aa'], customerId: 'cst_AAAA1111aa'},
    {ref: 'tr_AAAA1111aa', email: B, expect: 'mismatch'},
    {ref: 'tr_BBBB2222bb', email: B, expect: 'verified', customerId: 'cst_BBBB2222bb'},
    {ref: 'tr_CCCC3333cc', email: A, expect: 'verified', customerId: null},
    {ref: 'tr_ZZZZ9999zz', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: 'tr_AAAA1111aa', email: A, intent: 'order_status', expect: (r) => { assert.equal(r[0].status, 'paid'); assert.equal(r[0].amountMinor, 4900); assert.equal(r[0].currency, 'EUR'); }},
    {ref: 'tr_AAAA1111aa', email: A, intent: 'payment_history', expect: (r) => { assert.deepEqual(r.map((x) => x.id), ['tr_AAAA1111aa', 'tr_AAAA1112aa', 'tr_AAAA1113aa']); assert.equal(one(r, (x) => x.id === 'tr_AAAA1113aa', 'open').hostedUrl, 'https://www.mollie.com/checkout/select-method/fictionalA3'); }},
    {ref: 'tr_AAAA1111aa', email: A, intent: 'failed_payment', expect: (r) => { assert.equal(one(r, (x) => x.id === 'tr_AAAA1112aa', 'failed').failure?.message, 'insufficient funds'); assert.ok(one(r, (x) => x.id === 'sub_AAAA1112aa', 'suspended').failure); }},
    {ref: 'tr_AAAA1111aa', email: A, intent: 'renewal', expect: (r) => assert.deepEqual(r.map((x) => [x.id, x.renewalAt]), [['sub_AAAA1111aa', '2026-11-20T00:00:00.000Z']])},
    {ref: 'tr_AAAA1111aa', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r[0].refunds.map((f) => [f.id, f.status, f.amountMinor]), [['re_AAAA1111aa', 'refunded', 1000]])},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: TEST}, ok: true},
    {mode: 'live', cred: {apiKey: LIVE}, ok: true},
    {mode: 'live', cred: {apiKey: TEST}, ok: false, code: 'mode_mismatch'},
    {mode: 'test', cred: {apiKey: LIVE}, ok: false, code: 'mode_mismatch'},
    {mode: 'live', cred: {apiKey: 'access_FictionalOrgToken000000000000001'}, ok: false, code: 'refused_key'},
    {mode: 'test', cred: {apiKey: 'nope'}, ok: false, code: 'invalid_credential'},
  ],
  modeMismatch: {mode: 'live', cred: {apiKey: LIVE}},
  writeProbe: {method: 'POST', path: '/v2/payments/tr_AAAA1111aa/refunds', body: '{}'},
  mixed: {ref: 'tr_AAAA1111aa', email: A, intent: 'payment_history', forbiddenIds: ['tr_BBBB2222bb']},
};
