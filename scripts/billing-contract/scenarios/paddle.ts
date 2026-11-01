import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const SANDBOX = 'pdl_sdbx_apikey_01fictional0000000000000000_abc', LIVE = 'pdl_live_apikey_01fictional0000000000000000_abc';
const CA = 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa';
const TA1 = 'txn_01aaaaaaaaaaaaaaaaaaaaaaa1', TA2 = 'txn_01aaaaaaaaaaaaaaaaaaaaaaa2', TB1 = 'txn_01bbbbbbbbbbbbbbbbbbbbbbb1', SA = 'sub_01aaaaaaaaaaaaaaaaaaaaaaa1';
export const scenario: Scenario = {
  provider: 'paddle',
  cred: {apiKey: SANDBOX},
  hosts: {test: 'https://sandbox-api.paddle.com', live: 'https://api.paddle.com'},
  verify: [
    {ref: TA1, email: 'Alex.Payer@example.test', expect: 'verified', scopeIds: [TA1], customerId: CA},
    {ref: TA1, email: B, expect: 'mismatch'},
    {ref: '325-10001', email: A, expect: 'verified', scopeIds: [TA1], customerId: CA},
    {ref: '325-10003', email: A, expect: 'mismatch'},
    {ref: TB1, email: B, expect: 'verified'},
    {ref: SA, email: A, expect: 'verified', scopeIds: [SA], customerId: CA},
    {ref: 'txn_01zzzzzzzzzzzzzzzzzzzzzzz9', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: TA1, email: A, intent: 'order_status', expect: (r) => { assert.equal(r[0].status, 'completed'); assert.equal(r[0].amountMinor, 4900); assert.equal(r[0].displayRef, '325-10001'); }},
    {ref: TA1, email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), [TA1, TA2])},
    {ref: TA1, email: A, intent: 'failed_payment', expect: (r) => { assert.ok(one(r, (x) => x.kind === 'subscription', 'past due sub').failure); assert.equal(one(r, (x) => x.id === TA2, 'past due txn').status, 'past_due'); }},
    {ref: TA1, email: A, intent: 'invoice', expect: (r) => assert.equal(one(r, (x) => x.id === TA1, 'invoice').hostedUrl, 'https://paddle-sandbox-invoice-service-pdfs.s3.amazonaws.com/invoices/fictional/invoice_325-10001.pdf')},
    {ref: SA, email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, '2026-11-20T10:00:00.000Z')},
    {ref: TA1, email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r.map((x) => [x.id, x.status, x.amountMinor, x.parentRef]), [['adj_01aaaaaaaaaaaaaaaaaaaaaaa1', 'approved', 1000, TA1]])},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: SANDBOX}, ok: true},
    {mode: 'live', cred: {apiKey: LIVE}, ok: true},
    {mode: 'test', cred: {apiKey: LIVE}, ok: false, code: 'mode_mismatch'},
    {mode: 'live', cred: {apiKey: SANDBOX}, ok: false, code: 'mode_mismatch'},
    {mode: 'test', cred: {apiKey: 'not_a_paddle_key_000000000000'}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/adjustments', body: '{"action":"refund"}'},
  mixed: {ref: TA1, email: A, intent: 'payment_history', forbiddenIds: [TB1]},
  extra: async ({mock, adapter}) => {
    mock.setMode('mixed_customers');
    const a = adapter();
    const v = await a.verifyCustomer(TA1, A);
    if (v.status !== 'verified') throw Error('setup');
    assert.deepEqual((await a.lookup(v.scope, 'refund_status')).map((x) => x.id), ['adj_01aaaaaaaaaaaaaaaaaaaaaaa1'], "another customer's adjustment is dropped");
    return 1;
  },
};
