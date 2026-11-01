import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const PA = 'pAyAaaa1111FictionalPaymentA1', PA2 = 'pAyAaaa1112FictionalPaymentA2', PB = 'pAyBbbb2222FictionalPaymentB1', OA = 'oRdAaaa1111FictionalOrderA01', OB = 'oRdBbbb2222FictionalOrderB01';
const SUB = 'aaaa1111-2222-4333-8444-555566667777', INV = 'inv:0-ChCFictionalInvoiceA0001';
const TOKEN = 'EAAAFictionalSandboxAccessToken0000000000000000';
export const scenario: Scenario = {
  provider: 'square',
  cred: {accessToken: TOKEN},
  hosts: {test: 'https://connect.squareupsandbox.com', live: 'https://connect.squareup.com'},
  hostsNotInSpec: ['connect.squareupsandbox.com'],
  verify: [
    {ref: PA, email: 'ALEX.PAYER@example.test', expect: 'verified', scopeIds: [PA, OA]},
    {ref: PA, email: B, expect: 'mismatch'},
    {ref: OA, email: A, expect: 'verified', scopeIds: [OA]},
    {ref: OB, email: A, expect: 'mismatch'},
    {ref: PB, email: B, expect: 'verified'},
    {ref: INV, email: A, expect: 'verified', scopeIds: [INV, OA]},
    {ref: SUB, email: A, expect: 'verified', scopeIds: [SUB]},
    {ref: SUB, email: B, expect: 'mismatch'},
    {ref: 'zzzzZZZZ9999FictionalUnknown01', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: PA, email: A, intent: 'order_status', expect: (r) => { const p = one(r, (x) => x.kind === 'payment', 'payment'); assert.equal(p.status, 'COMPLETED'); assert.equal(p.amountMinor, 4900); assert.equal(one(r, (x) => x.kind === 'order', 'order').status, 'COMPLETED'); }},
    {ref: OA, email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), [PA2, PA])},
    {ref: OA, email: A, intent: 'failed_payment', expect: (r) => assert.deepEqual(r.map((x) => [x.id, x.failure?.message]), [[PA2, 'payment failed']])},
    {ref: INV, email: A, intent: 'invoice', expect: (r) => { assert.equal(r[0].displayRef, '000101'); assert.equal(r[0].hostedUrl, 'https://squareupsandbox.com/pay-invoice/fictional-A1'); }},
    {ref: SUB, email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, '2026-12-01T00:00:00.000Z')},
    {ref: PA, email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r[0].refunds.map((f) => [f.id, f.status, f.amountMinor]), [['rFnAaaa1111FictionalRefundA1', 'COMPLETED', 1000]])},
  ],
  credentialRules: [
    {mode: 'test', cred: {accessToken: TOKEN}, ok: true},
    {mode: 'live', cred: {accessToken: TOKEN}, ok: true},
    {mode: 'test', cred: {accessToken: 'short'}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/v2/refunds', body: '{}'},
  mixed: {ref: OA, email: A, intent: 'payment_history', forbiddenIds: [PB]},
  extra: async ({mock, adapter}) => {
    const before = mock.requests.length;
    await adapter().testConnection();
    assert.ok(mock.requests.slice(before).every((q) => q.headers['square-version'] === '2026-09-16'));
    return 1;
  },
};
