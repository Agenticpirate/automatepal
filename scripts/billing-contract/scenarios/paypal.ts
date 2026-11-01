import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
export const scenario: Scenario = {
  provider: 'paypal',
  cred: {clientId: 'AYfictionalClientId00000000001', clientSecret: 'EFfictionalClientSecret0000000001'},
  hosts: {test: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com'},
  verify: [
    {ref: '7AB12345CD678901E', email: ' ALEX.PAYER@EXAMPLE.TEST ', expect: 'verified', scopeIds: ['7AB12345CD678901E']},
    {ref: '#7ab12345cd678901e', email: A, expect: 'verified', scopeIds: ['7AB12345CD678901E']},
    {ref: '7AB12345CD678901E', email: B, expect: 'mismatch'},
    {ref: '9XY98765ZW432109V', email: B, expect: 'verified', scopeIds: ['9XY98765ZW432109V']},
    {ref: '9XY98765ZW432109V', email: A, expect: 'mismatch'},
    {ref: 'INV2-AAAA-BBBB-CCCC-DDDD', email: A, expect: 'verified', scopeIds: ['INV2-AAAA-BBBB-CCCC-DDDD']},
    {ref: 'AP-1001', email: A, expect: 'verified', scopeIds: ['INV2-AAAA-BBBB-CCCC-DDDD']},
    {ref: 'AP-1002', email: A, expect: 'mismatch'},
    {ref: 'I-AAAA1111BBBB', email: A, expect: 'verified', scopeIds: ['I-AAAA1111BBBB']},
    {ref: 'I-BBBB2222CCCC', email: A, expect: 'mismatch'},
    {ref: 'ZZZZZZZZZZZZZZZZZ', email: A, expect: 'not_found'},
    {ref: 'I-ZZZZ9999ZZZZ', email: A, expect: 'not_found'},
    {ref: 'AP-9999', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: '7AB12345CD678901E', email: A, intent: 'order_status', expect: (r) => {
      const o = one(r, (x) => x.kind === 'order', 'order');
      assert.equal(o.status, 'COMPLETED'); assert.equal(o.amountMinor, 4900); assert.equal(o.currency, 'USD');
      assert.equal(one(r, (x) => x.kind === 'payment', 'capture').status, 'PARTIALLY_REFUNDED');
    }},
    {ref: '7AB12345CD678901E', email: A, intent: 'refund_status', expect: (r) => {
      const o = one(r, (x) => x.kind === 'order', 'order');
      assert.deepEqual(o.refunds.map((f) => [f.id, f.status, f.amountMinor, f.currency]), [['1RF11111AA111111A', 'COMPLETED', 1000, 'USD']]);
    }},
    {ref: '7AB12345CD678901E', email: A, intent: 'payment_history', expect: (r) => { assert.equal(r.length, 1); assert.equal(r[0].amountMinor, 4900); assert.equal(r[0].parentRef, '7AB12345CD678901E'); }},
    {ref: '7AB12345CD678901E', email: A, intent: 'invoice', expect: (r) => assert.equal(r.length, 0)},
    {ref: '9XY98765ZW432109V', email: B, intent: 'failed_payment', expect: (r) => {
      const c = one(r, (x) => x.kind === 'payment', 'declined capture');
      assert.equal(c.status, 'DECLINED'); assert.ok(c.failure); assert.equal(c.amountMinor, 12000);
    }},
    {ref: 'AP-1001', email: A, intent: 'invoice', expect: (r) => {
      const i = one(r, (x) => x.kind === 'invoice', 'invoice');
      assert.equal(i.displayRef, 'AP-1001'); assert.equal(i.status, 'PARTIALLY_REFUNDED'); assert.equal(i.amountMinor, 7500);
      assert.equal(i.hostedUrl, 'https://www.sandbox.paypal.com/invoice/p/#INV2AAAABBBBCCCCDDDD');
    }},
    {ref: 'AP-1001', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r[0].refunds.map((f) => [f.id, f.amountMinor]), [['2RF11111AA111111A', 2500]])},
    {ref: 'AP-1001', email: A, intent: 'payment_history', expect: (r) => { assert.equal(r.length, 1); assert.equal(r[0].amountMinor, 7500); }},
    {ref: 'I-AAAA1111BBBB', email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, '2026-11-01T10:00:00.000Z')},
    {ref: 'I-AAAA1111BBBB', email: A, intent: 'failed_payment', expect: (r) => assert.deepEqual(r[0].failure, {message: 'payment denied', attemptCount: 1, nextRetryAt: '2026-10-06T00:00:00.000Z'})},
    {ref: 'I-AAAA1111BBBB', email: A, intent: 'payment_history', expect: (r) => { assert.equal(r.length, 3); assert.ok(r.every((x) => x.parentRef === 'I-AAAA1111BBBB')); }},
    {ref: 'I-AAAA1111BBBB', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r.map((x) => x.status), ['REFUNDED'])},
    {ref: 'I-AAAA1111BBBB', email: A, intent: 'order_status', expect: (r) => assert.equal(r[0].status, 'ACTIVE')},
  ],
  credentialRules: [
    {mode: 'test', cred: {clientId: 'AYfictionalClientId00000000001', clientSecret: 'EFfictionalClientSecret0000000001'}, ok: true},
    {mode: 'live', cred: {clientId: 'AYfictionalClientId00000000001', clientSecret: 'EFfictionalClientSecret0000000001'}, ok: true},
    {mode: 'test', cred: {clientId: 'short', clientSecret: 'EFfictionalClientSecret0000000001'}, ok: false, code: 'invalid_credential'},
    {mode: 'live', cred: {clientId: 'AYfictionalClientId00000000001', clientSecret: 'has spaces in it not allowed 0000'}, ok: false, code: 'invalid_credential'},
    {mode: 'test', cred: {clientId: '', clientSecret: ''}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/v2/payments/captures/3CA11111AA111111A/refund', body: '{}'},
  // Sandbox REST apps without the Invoicing feature answer 403 on invoices: the key is confirmed with a
  // subscriptions read instead and the owner is told invoice lookups will fail (seen on a real sandbox app).
  extra: async ({mock, adapter}) => {
    mock.setMode('no_invoicing');
    const before = mock.requests.length;
    const r = await adapter().testConnection();
    assert.equal(r.ok, true); assert.match(r.warning ?? '', /Invoicing/);
    assert.deepEqual(mock.requests.slice(before).filter((q) => q.method === 'GET').map((q) => [q.url.split('?')[0], q.served]), [['/v2/invoicing/invoices', 403], ['/v1/billing/plans', 200]]);
    mock.setMode('unauthorized');
    await assert.rejects(() => adapter().testConnection());
    return 2;
  },
  mixed: {ref: '7AB12345CD678901E', email: A, intent: 'order_status', forbiddenIds: ['9XY98765ZW432109V', '4DE22222BB222222B'], verifyRejected: true},
};
